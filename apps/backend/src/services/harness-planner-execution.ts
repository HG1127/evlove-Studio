import {createEvolutionEvent} from "@evolution/contracts";
import {deriveAttentionRequest} from "@evolution/harness";
import {buildExecutionContext} from "./execution-context";
import {getServerProductionRuntime} from "./production-runtime";

export async function runHarnessPlannerExecution(missionId:string,jobId?:string){
  const runtime=getServerProductionRuntime();
  const context=await buildExecutionContext(runtime,missionId,jobId);

  const attention=deriveAttentionRequest(context.mission);
  const action=attention?"wait-human":"run-campaign";

  await runtime.events.append(createEvolutionEvent({
    missionId,
    jobId,
    type:"ActionPlanned",
    source:"harness-planner-execution",
    payload:{action,hasAttention:Boolean(attention),reason:attention?.reason??"planner selected autonomous execution"},
  }));

  return {
    action,
    attention,
    context,
  };
}
