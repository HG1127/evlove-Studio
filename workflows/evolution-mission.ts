import {sleep} from "workflow";
import { EvolutionWorkflowRunInputSchema, type EvolutionWorkflowResult } from "@evolution/contracts";
import {
  executeServerControlStep,
  failLoopGuardStep,
  initializeWorkflowControlStep,
  planMissionStep,
} from "./evolution-mission/steps";

const MAX_CONTROL_STEPS=32;

export async function evolutionMissionWorkflow(rawInput:unknown):Promise<EvolutionWorkflowResult>{
  "use workflow";
  const input=EvolutionWorkflowRunInputSchema.parse(rawInput);
  await initializeWorkflowControlStep(input);
  for(let iteration=0;iteration<MAX_CONTROL_STEPS;iteration+=1){
    const plan=await planMissionStep(input,iteration);
    const execution=await executeServerControlStep(input,plan,iteration);
    if(execution.control==="stop"&&execution.result)return execution.result;
    if(execution.control==="continue"&&execution.sleepMs)await sleep(execution.sleepMs);
  }
  return failLoopGuardStep(input,MAX_CONTROL_STEPS);
}
