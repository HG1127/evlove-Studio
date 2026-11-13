import {getRun} from "workflow/api";
import {z} from "zod";
import {EvolutionWorkflowResultSchema,JobReconcileRequestSchema,type EvolutionJob} from "@evolution/contracts";
import {transitionJob} from "./job-lifecycle";
import {getServerProductionRuntime,listServerActiveJobs} from "./production-runtime";
import {workflowRunIdForJob} from "./workflow-run-control";

const RunStatusSchema=z.enum(["pending","running","completed","failed","cancelled"]);
type RunStatus=z.infer<typeof RunStatusSchema>;
type RunInspection={exists:boolean;status?:RunStatus;result?:unknown;resultError?:string};
export type JobReconcileIssue="unbound"|"missing-run"|"workflow-failed"|"workflow-cancelled"
  |"workflow-result-completed"|"workflow-result-failed"|"workflow-completed"|"heartbeat-stale"|"healthy"
  |"inspection-failed"|"mission-missing"|"mission-inspection-failed";

export type JobReconcileDependencies={
  list:(limit:number,missionId?:string)=>Promise<EvolutionJob[]>;
  inspect:(runId:string)=>Promise<RunInspection>;
  readMission:(missionId:string)=>Promise<boolean>;
  transition:(id:string,status:"completed"|"failed"|"cancelled",detail:string,
    expected:{generation:number;updatedAt:string;runId?:string})=>Promise<EvolutionJob>;
};

type WorkflowRunHandle={exists:Promise<unknown>;status:Promise<unknown>;returnValue:Promise<unknown>};

export async function inspectWorkflowRun(
  runId:string,resolve:(id:string)=>WorkflowRunHandle=(id)=>getRun(id) as WorkflowRunHandle,
):Promise<RunInspection>{
  const run=resolve(runId);
  const exists=z.boolean().parse(await run.exists);
  if(!exists)return {exists};
  const status=RunStatusSchema.parse(await run.status);
  if(status!=="completed")return {exists,status};
  try{return {exists,status,result:await run.returnValue};}
  catch{return {exists,status,resultError:"Workflow return value unavailable"};}
}

const defaultDependencies:JobReconcileDependencies={
  list:listServerActiveJobs,
  inspect:inspectWorkflowRun,
  readMission:async id=>Boolean(await getServerProductionRuntime().missions.get(id)),
  transition:(id,status,detail,expected)=>transitionJob(getServerProductionRuntime(),id,status,detail,expected),
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
  let repairFailures=0;
  const missionPresence=new Map<string,boolean>();
  for(const job of jobs){
    if(!workflowBacked(job))continue;
    const ageMs=now.getTime()-Date.parse(job.updatedAt);
    if(!Number.isFinite(ageMs)||ageMs<input.minAgeSeconds*1000)continue;
    if(job.missionId){
      // A missing Mission is never an implicit authorization to repair a stale Job.
      // Keep the historical Job/Event intact for explicit operator reconciliation.
      let exists:boolean;
      try{
        const cached=missionPresence.get(job.missionId);
        exists=cached===undefined?await deps.readMission(job.missionId):cached;
        missionPresence.set(job.missionId,exists);
      }catch{
        results.push({jobId:job.id,generation:job.generation,issue:"mission-inspection-failed",
          repaired:false,detail:"Mission identity lookup unavailable"});
        continue;
      }
      if(!exists){
        results.push({jobId:job.id,generation:job.generation,issue:"mission-missing",
          repaired:false,detail:"Referenced Mission missing; manual ownership review required"});
        continue;
      }
    }
    const runId=workflowRunIdForJob(job);
    let issue:JobReconcileIssue;
    let runStatus:RunStatus|undefined;
    let resultStatus:string|undefined;
    let resultError:string|undefined;
    if(!runId){
      issue="unbound";
    }else{
      let run:RunInspection;
      try{run=await deps.inspect(runId);}
      catch{
        results.push({jobId:job.id,generation:job.generation,runId,issue:"inspection-failed",
          repaired:false,detail:"Workflow run inspection unavailable"});
        continue;
      }
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
        const settled=await deps.transition(job.id,status,detail,{
          generation:job.generation,updatedAt:job.updatedAt,runId,
        });
        repaired=settled.status===status;
        if(!repaired)detail=`Workflow reconciliation did not settle Job to ${status}`;
      }catch{
        detail="Workflow Job transition unavailable";
      }
      if(!repaired)repairFailures++;
    }
    results.push({jobId:job.id,generation:job.generation,runId,issue,runStatus,resultStatus,repaired,
      detail:detail??resultError});
  }
  return {checkedAt:now.toISOString(),inspected:jobs.length,
    inspectionFailures:results.filter((item)=>item.issue==="inspection-failed"||item.issue==="mission-inspection-failed").length,
    orphaned:results.filter((item)=>item.issue==="mission-missing").length,
    repairFailures,
    issues:results.filter((item)=>item.issue!=="healthy"),
    repaired:results.filter((item)=>item.repaired).length};
}
