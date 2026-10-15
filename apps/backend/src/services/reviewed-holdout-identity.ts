import {createHash} from "node:crypto";
import {ReviewedHoldoutBindingSchema,ReviewedHoldoutRunInputSchema,type EvolveProject,type ReviewedHoldoutBinding,type EvolutionActor} from "@evolution/contracts";
import {serverMainFlowRecoveryDigest} from "./server-main-flow-recovery";

function ordered(value:unknown):unknown{
  if(Array.isArray(value))return value.map(ordered);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,ordered(v)]));
  return value;
}
export const reviewedSha=(value:unknown)=>createHash("sha256").update(JSON.stringify(ordered(JSON.parse(JSON.stringify(value)??"null")))).digest("hex");
export function requireReviewedHuman(actor:EvolutionActor){
  if(!["operator","admin"].includes(actor.role)||!["browser-session","trusted-header","internal-dev"].includes(actor.source))
    throw new Error("需要已认证人工操作员确认；服务身份不能确认 Safety REVIEW。");
}
export function reviewedBinding(project:EvolveProject,physicalSha256:string,originalSha256:string,route:string):ReviewedHoldoutBinding{
  const candidate=project.candidates.find(c=>c.id===project.experimentRun.winnerId)!;
  return ReviewedHoldoutBindingSchema.parse({
    schemaVersion:"reviewed-holdout-binding-v1",missionId:project.id,sourceUpdatedAt:project.updatedAt,
    baselineId:project.baselineRun.id,baselineSha256:reviewedSha(project.baselineRun),candidateId:candidate.id,
    snapshotSha256:reviewedSha(candidate.artifactSnapshots),frozenSha256:candidate.artifactSnapshots[0]!.frozenArtifact!.sha256,
    originalSha256,hiddenSha256:reviewedSha(project.hiddenEvalSuite),inputSha256:serverMainFlowRecoveryDigest(project),
    physicalSha256,scoringRouteFingerprint:route,
  });
}
/** Immutable scope across actual Hidden output; mutable validation/acceptance are separately generation-bound. */
export function reviewedScope(project:EvolveProject){
  const candidate=project.candidates.find(c=>c.id===project.experimentRun.winnerId);
  return reviewedSha({
    id:project.id,sources:project.sourceArtifacts,target:project.targetConnection,goal:project.goal,command:project.evolutionCommand,
    protected:project.protectedItems,editable:project.editableItems,clarifications:project.inputClarifications,understanding:project.inputUnderstanding,
    metrics:project.metrics,rubric:project.acceptanceRubric,rubricState:project.acceptanceRubricState,visible:project.evalSuite,hidden:project.hiddenEvalSuite,
    baseline:project.baselineRun,rootBaseline:project.campaign.rootBaseline,experiment:project.experimentRun,
    snapshots:candidate?.artifactSnapshots,profile:project.aiProfile,policy:project.experimentPolicy,stopCriteria:project.campaign.stopCriteria,
    scoringInput:project.campaign.scoringInputFingerprint,scoringRoute:project.campaign.scoringRouteFingerprint,
  });
}
export function reviewedFrozenBindingsMatch(project:EvolveProject,binding:ReviewedHoldoutBinding){
  const candidate=project.candidates.find(c=>c.id===binding.candidateId);
  return project.id===binding.missionId&&project.baselineRun.id===binding.baselineId
    &&reviewedSha(project.baselineRun)===binding.baselineSha256&&reviewedSha(project.hiddenEvalSuite)===binding.hiddenSha256
    &&!!candidate&&reviewedSha(candidate.artifactSnapshots)===binding.snapshotSha256;
}

/** A lost result save cannot grant a new verdict attempt under a fresh request key. */
export function sameReviewedHoldoutScope(raw:unknown,binding:ReviewedHoldoutBinding){
  const parsed=ReviewedHoldoutRunInputSchema.shape.approval.safeParse(raw);
  if(!parsed.success)return false;
  const prior=parsed.data.request.binding;
  return prior.missionId===binding.missionId&&prior.baselineSha256===binding.baselineSha256
    &&prior.candidateId===binding.candidateId&&prior.frozenSha256===binding.frozenSha256
    &&prior.originalSha256===binding.originalSha256&&prior.hiddenSha256===binding.hiddenSha256;
}
