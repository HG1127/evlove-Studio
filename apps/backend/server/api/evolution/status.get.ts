import { defineEventHandler, getQuery, setResponseStatus } from "nitro/h3";
import {EvolutionWorkflowStatusQuerySchema,EvolutionWorkflowStatusResponseSchema} from "@evolution/contracts";
import { getServerProductionRuntime } from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {readServerWorkflowStatus} from "../../../src/services/workflow-status-read";

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
  const workflowObservation=runId?await readServerWorkflowStatus(runId):{};
  const events=job?.missionId?await runtime.events.list(job.missionId,25):[];
  return EvolutionWorkflowStatusResponseSchema.parse({...workflowObservation,job,events});
});
