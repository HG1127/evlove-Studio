import {getRun} from "workflow/api";
import {EvolutionWorkflowResultSchema,JobReconcileRequestSchema,type EvolutionJob} from "@evolution/contracts";
import {transitionJob} from "./job-lifecycle";
import {getServerProductionRuntime,listServerActiveJobs} from "./production-runtime";
import {workflowRunIdForJob} from "./workflow-run-control";

type RunStatus="pending"|"running"|"completed"|"failed"|"cancelled";
type RunInspection={exists:boolean;status?:RunStatus;result?:unknown;resultError?:string};
export type JobReconcileIssue="unbound"|"missing-run"|"workflow-failed"|"workflow-cancelled"
  |"workflow-result-completed"|"workflow-result-failed"|"workflow-completed"|"heartbeat-stale"|"healthy";

export type JobReconcileDependencies={
  list:(limit:number,missionId?:string)=>Promise<EvolutionJob[]>;
  inspect:(runId:string)=>Promise<RunInspection>;
  transition:(id:string,status:"completed"|"failed"|"cancelled",detail:string)=>Promise<EvolutionJob>;
};

const defaultDependencies:JobReconcileDependencies={
  list:listServerActiveJobs,
  inspect:async(runId)=>{
    const run=getRun(runId);
    const exists=await run.exists;
    if(!exists)return {exists};
    const status=await run.status as RunStatus;
    if(status!=="completed")return {exists,status};
    try{return {exists,status,result:await run.returnValue};}
    catch{return {exists,status,resultError:"Workflow return value unavailable"};}
  },
  transition:(id,status,detail)=>transitionJob(getServerProductionRuntime(),id,status,detail),
};

function workflowBacked(job:EvolutionJob){
  return job.type==="parse"||(job.type==="campaign"&&job.idempotencyKey.startsWith("workflow-control:"));
}

export async function reconcileWorkflowJobs(raw:unknown,deps:JobReconcileDependencies=defaultDependencies,now=new Date()){
  const input=JobReconcileRequestSchema.parse(raw);
  const jobs=await deps.list(input.limit,input.missionId);
  const results:Array<{
    jobId:string;generation:number;runId?:string;issue:JobReconcileIssue;
    runStatus?:RunStatus;resultStatus?:string;repaired:boolean;detail?:string;
  }>=[];
  for(const job of jobs){
    if(!workflowBacked(job))continue;
    const ageMs=now.getTime()-Date.parse(job.updatedAt);
    if(!Number.isFinite(ageMs)||ageMs<input.minAgeSeconds*1000)continue;
    const runId=workflowRunIdForJob(job);
    let issue:JobReconcileIssue;
    let runStatus:RunStatus|undefined;
    let resultStatus:string|undefined;
    let resultError:string|undefined;
    if(!runId){
      issue="unbound";
    }else{
      const run=await deps.inspect(runId);
      runStatus=run.status;
      resultError=run.resultError;
      if(run.status==="completed"&&job.type==="campaign"){
        const parsed=EvolutionWorkflowResultSchema.safeParse(run.result);
        if(parsed.success&&parsed.data.missionId===job.missionId&&parsed.data.controlJobId===job.id){
          resultStatus=parsed.data.status;
        }
      }
      issue=!run.exists?"missing-run":run.status==="failed"?"workflow-failed"
        :run.status==="cancelled"?"workflow-cancelled":run.status==="completed"
          ?resultStatus==="completed"?"workflow-result-completed"
            :resultStatus==="failed"?"workflow-result-failed":"workflow-completed"
          :job.status==="running"?"heartbeat-stale":"healthy";
    }
    let repaired=false;
    let detail:string|undefined;
    const repairable=["unbound","missing-run","workflow-failed","workflow-cancelled","workflow-result-failed"].includes(issue)
      ||(issue==="workflow-result-completed"&&job.status==="running");
    if(input.repair&&repairable){
      const status=issue==="workflow-cancelled"?"cancelled":issue==="workflow-result-completed"?"completed":"failed";
      detail=`Workflow reconciliation: ${issue}${runId?` (${runId})`:""}`;
      try{
        const settled=await deps.transition(job.id,status,detail);
        repaired=settled.status===status;
        if(!repaired)detail=`Workflow reconciliation did not settle Job to ${status}`;
      }catch(error){
        detail=error instanceof Error?error.message:String(error);
      }
    }
    results.push({jobId:job.id,generation:job.generation,runId,issue,runStatus,resultStatus,repaired,
      detail:detail??resultError});
  }
  return {checkedAt:now.toISOString(),inspected:jobs.length,issues:results.filter((item)=>item.issue!=="healthy"),
    repaired:results.filter((item)=>item.repaired).length};
}
