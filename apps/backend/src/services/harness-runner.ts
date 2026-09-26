import type {ProductionRuntimePorts} from "@evolution/contracts";
import {buildExecutionContext,type EvolutionExecutionContext} from "./execution-context";
import {getServerProductionRuntime} from "./production-runtime";

export type HarnessRunResult={
  context:EvolutionExecutionContext;
  action:string;
  status:"prepared";
};

export async function prepareHarnessExecution(
  missionId:string,
  jobId?:string,
  runtime:ProductionRuntimePorts=getServerProductionRuntime(),
):Promise<HarnessRunResult>{
  const context=await buildExecutionContext(runtime,missionId,jobId);

  return {
    context,
    action:"harness-context-build",
    status:"prepared",
  };
}
