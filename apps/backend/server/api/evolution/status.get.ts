import { defineEventHandler, getQuery, setResponseStatus } from "nitro/h3";
import { getRun } from "workflow/api";
import {EvolutionWorkflowStatusQuerySchema,EvolutionWorkflowStatusResponseSchema} from "@evolution/contracts";
import { getServerProductionRuntime } from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"data.read");
  const query=getQuery(event);
  const parsed=EvolutionWorkflowStatusQuerySchema.safeParse(query);
  if(!parsed.success){
    setResponseStatus(event,400);
    return {error:"需要 runId 或 jobId"};
  }
  const {runId,jobId}=parsed.data;

  const runtime=getServerProductionRuntime();
  const job=jobId?await runtime.jobs.get(jobId):undefined;
  let workflow:{exists:boolean;status?:unknown}|undefined;
  if(runId){
    const run=getRun(runId);
    const exists=await run.exists;
    workflow=exists?{exists:true,status:await run.status}:{exists:false};
  }
  const events=job?.missionId?await runtime.events.list(job.missionId,25):[];
  return EvolutionWorkflowStatusResponseSchema.parse({workflow,job,events});
});
