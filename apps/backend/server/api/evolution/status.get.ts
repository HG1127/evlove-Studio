import { defineEventHandler, getQuery, setResponseStatus } from "nitro/h3";
import {readWorkflowRunMetadata} from "../../../src/services/workflow-run-metadata";
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
    try{workflow=await readWorkflowRunMetadata(runId);}
    catch{setResponseStatus(event,503);return {error:"当前无法核验 Workflow 元数据，请稍后重试"};}
  }
  const events=job?.missionId?await runtime.events.list(job.missionId,25):[];
  return EvolutionWorkflowStatusResponseSchema.parse({workflow,job,events});
});
