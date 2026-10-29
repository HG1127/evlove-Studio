import {z} from "zod";
import {UserGoalPlanningScopeSchema} from "@evolution/contracts";
import {COMPLETE_USER_GOAL_PLAN_INSTRUCTION} from "@evolution/core";

const input=z.object({
  planningGoalScope:UserGoalPlanningScopeSchema,
  winnerGoalScope:z.object({policy:z.literal("all-user-goals-v1"),requiredCriteria:UserGoalPlanningScopeSchema.shape.requiredCriteria}).passthrough(),
  project:z.object({sourceArtifacts:z.array(z.object({id:z.string(),role:z.string()}).passthrough())}).passthrough(),
}).passthrough();
const legacy="Generate a small diverse Candidate population for the selected diagnosed problem. Ground every design rationale in supplied evidence and never claim measured improvement before experiment.";

/** Use a trusted instruction only after its generation scope matches the complete supplied contract. */
export function serverAiPlanningInstruction(payload:unknown){
  if(!payload||typeof payload!=="object"||!("planningGoalScope" in payload))return legacy;
  const p=input.parse(payload),scope=p.planningGoalScope,targets=p.project.sourceArtifacts.filter(s=>s.role==="target").map(s=>s.id);
  if(JSON.stringify(scope.requiredCriteria)!==JSON.stringify(p.winnerGoalScope.requiredCriteria)
    ||targets.length!==scope.targetArtifactIds.length||new Set(targets).size!==targets.length||targets.some(id=>!scope.targetArtifactIds.includes(id)))
    throw Error("Complete planning scope differs from the original user goals or Target identities");
  return COMPLETE_USER_GOAL_PLAN_INSTRUCTION;
}
