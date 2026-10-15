import {sleep} from "workflow";
import { EvolutionWorkflowRunInputSchema, type EvolutionWorkflowResult } from "@evolution/contracts";
import {
  executeServerControlStep,
  failLoopGuardStep,
  finalizeWorkflowResultStep,
  initializeWorkflowControlStep,
  planMissionStep,
  prepareScheduledTriggerStep,
  settleScheduledManualRoundStep,
} from "./evolution-mission/steps";

import type { ServerDiagnosticContinuation } from "../apps/backend/src/services/server-diagnostic-continuation";

import type { ServerExperimentContinuation } from "@evolution/harness";

const MAX_CONTROL_STEPS=32;
// At most eight selected Candidates, each build / execute / judge once per bounded experiment phase.
const MAX_EXPERIMENT_OPERATIONS=24;

export async function evolutionMissionWorkflow(rawInput:unknown):Promise<EvolutionWorkflowResult>{
  "use workflow";
  const input=EvolutionWorkflowRunInputSchema.parse(rawInput);
  await initializeWorkflowControlStep(input);

  let scheduledFor=input.scheduledFor;
  let scheduledSleepMs=scheduledFor
    ?Math.max(0,Date.parse(scheduledFor)-Date.parse(input.requestedAt))
    :0;
  let cycle=0;
  let iteration=0;

  while(true){
    let targetRound:number|undefined;
    if(scheduledFor){
      if(scheduledSleepMs>0)await sleep(scheduledSleepMs);
      const trigger=await prepareScheduledTriggerStep(input,scheduledFor,cycle);
      if(trigger.control==="stop")return finalizeWorkflowResultStep(input,trigger.result);
      targetRound=trigger.targetRound;
    }

    // Internal SDK step output only: never initialized from public Workflow input or Mission events.
    let diagnosticContinuation:ServerDiagnosticContinuation|undefined;
    let experimentContinuation:ServerExperimentContinuation|undefined;
    let rearmed=false;
    for(let localIteration=0;localIteration<MAX_CONTROL_STEPS;localIteration+=1){
      let execution:Awaited<ReturnType<typeof executeServerControlStep>>;
      let experimentOperations=0;
      do {
        const stepIteration=iteration++;
        const plan=await planMissionStep(input,stepIteration);
        execution=await executeServerControlStep(input,plan,stepIteration,diagnosticContinuation,experimentContinuation);
        diagnosticContinuation=execution.control==="continue" ? execution.diagnosticContinuation : undefined;
        experimentContinuation=execution.control==="continue" ? execution.experimentContinuation : undefined;
        if(execution.control==="stop"&&execution.result)return execution.result;
        if(experimentContinuation&&++experimentOperations>=MAX_EXPERIMENT_OPERATIONS)
          return finalizeWorkflowResultStep(input,await failLoopGuardStep(input,iteration));
        if(experimentContinuation&&execution.sleepMs)await sleep(execution.sleepMs);
      } while(experimentContinuation);

      if(targetRound!==undefined){
        const settlement=await settleScheduledManualRoundStep(input,targetRound,iteration-1);
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
    return finalizeWorkflowResultStep(input,await failLoopGuardStep(input,iteration));
  }
}
