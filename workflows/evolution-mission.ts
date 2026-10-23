import {sleep} from "workflow";
import { EvolutionWorkflowRunInputSchema, type EvolutionWorkflowResult } from "@evolution/contracts";
import {
  executeServerControlStep,
  failLoopGuardStep,
  finalizeUnexpectedWorkflowFailureStep,
  finalizeWorkflowResultStep,
  initializeWorkflowControlStep,
  planMissionStep,
  prepareScheduledTriggerStep,
  settleScheduledManualRoundStep,
} from "./evolution-mission/steps";

const MAX_CONTROL_STEPS=32;

export async function evolutionMissionWorkflow(rawInput:unknown):Promise<EvolutionWorkflowResult>{
  "use workflow";
  const input=EvolutionWorkflowRunInputSchema.parse(rawInput);
  let lastIteration=0;
  try{
  await initializeWorkflowControlStep(input);

  let scheduledFor=input.scheduledFor;
  let scheduledSleepMs=scheduledFor
    ?Math.max(0,Date.parse(scheduledFor)-Date.parse(input.requestedAt))
    :0;
  let cycle=0;

  while(true){
    let targetRound:number|undefined;
    if(scheduledFor){
      if(scheduledSleepMs>0)await sleep(scheduledSleepMs);
      const trigger=await prepareScheduledTriggerStep(input,scheduledFor,cycle);
      if(trigger.control==="stop")return finalizeWorkflowResultStep(input,trigger.result);
      targetRound=trigger.targetRound;
    }

    let rearmed=false;
    for(let localIteration=0;localIteration<MAX_CONTROL_STEPS;localIteration+=1){
      const iteration=cycle*MAX_CONTROL_STEPS+localIteration;
      lastIteration=iteration;
      const plan=await planMissionStep(input,iteration);
      const execution=await executeServerControlStep(input,plan,iteration);
      if(execution.control==="stop"&&execution.result)return execution.result;

      if(targetRound!==undefined){
        const settlement=await settleScheduledManualRoundStep(input,targetRound,iteration);
        if(settlement.settled){
          if("result" in settlement)return finalizeWorkflowResultStep(input,settlement.result);
          scheduledFor=settlement.nextScheduledFor;
          scheduledSleepMs=settlement.sleepMs;
          cycle+=1;
          rearmed=true;
          break;
        }
      }
      if(execution.control==="continue"&&execution.sleepMs)await sleep(execution.sleepMs);
    }
    if(rearmed)continue;
    return finalizeWorkflowResultStep(input,await failLoopGuardStep(input,(cycle+1)*MAX_CONTROL_STEPS));
  }
  }catch{
    // Runtime retry budget exhausted: close this Job, preserve Mission evidence, never
    // let one uncaught provider/schema error leave a permanently 'running' Control Job.
    return finalizeUnexpectedWorkflowFailureStep(input,lastIteration+1);
  }
}
