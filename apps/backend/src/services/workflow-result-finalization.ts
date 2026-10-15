import {
  EvolutionJobSchema,
  type EvolutionEventType,
  type EvolutionJob,
  type EvolutionWorkflowResult,
} from "@evolution/contracts";

const terminalStatuses=new Set<EvolutionJob["status"]>(["completed","partial","failed","cancelled"]);

export function planWorkflowResultFinalization(
  current:EvolutionJob|undefined,
  result:EvolutionWorkflowResult,
  at:string,
):{job?:EvolutionJob;write:boolean;eventType:EvolutionEventType}{
  if(!current)return {write:false,eventType:"JobProgress"};
  if(terminalStatuses.has(current.status)){
    return {job:current,write:false,eventType:current.status==="completed"?"JobCompleted"
      :current.status==="failed"?"JobFailed":"JobProgress"};
  }
  // This SDK control has returned; human/action handoffs must not retain an active Job status.
  const waiting=result.status==="waiting-human"||result.status==="waiting-action";
  const status=result.status==="failed"?"failed":result.status==="completed"?"completed":waiting?"waiting":current.status;
  const terminal=terminalStatuses.has(status);
  const job=EvolutionJobSchema.parse({
    ...current,status,
    finishedAt:terminal?at:current.finishedAt,
    progress:{percent:terminal?100:current.progress?.percent,detail:result.reason??`Workflow finished: ${result.status}`},
    error:status==="failed"?result.reason:undefined,
    updatedAt:at,
  });
  return {job,write:true,eventType:status==="completed"?"JobCompleted":status==="failed"?"JobFailed":"JobProgress"};
}
