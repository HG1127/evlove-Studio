import {createEvolutionEvent} from "@evolution/contracts";
import {buildExecutionContext,type EvolutionExecutionContext} from "./execution-context";
import {getServerProductionRuntime} from "./production-runtime";

export type HarnessRunResult={
  context:EvolutionExecutionContext;
  action:string;
  status:"prepared";
};

export async function prepareHarnessExecution(missionId:string,jobId?:string):Promise<HarnessRunResult>{
  const runtime=getServerProductionRuntime();
  const context=await buildExecutionContext(runtime,missionId,jobId);

  await runtime.events.append(createEvolutionEvent({
    missionId,
    jobId,
    type:"ActionPlanned",
    source:"backend-harness-runner",
    checkpointId:context.checkpoint?`round-${context.checkpoint.round}`:undefined,
    payload:{
      action:"harness-context-build",
      eventCount:context.recentEvents.length,
    },
  }));

  return {
    context,
    action:"harness-context-build",
    status:"prepared",
  };
}
