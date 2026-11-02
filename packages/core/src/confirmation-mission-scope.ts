import type {EvolveProject} from "@evolution/contracts";

/** Frozen input/policy only. Runtime outputs, business samples and later final-paper reservation are separate gates. */
export function confirmationMissionScopeText(p:EvolveProject){
  const {confirmationAdmission,...experimentPolicy}=p.experimentPolicy;void confirmationAdmission;
  const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==="object"
    ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,value])=>[k,canonical(value)])):v;
  return JSON.stringify(canonical({missionId:p.id,objectType:p.objectType,goal:p.goal,evolutionCommand:p.evolutionCommand,
    problemStatement:p.problemStatement,desiredOutcome:p.desiredOutcome,inputClarifications:p.inputClarifications,
    aiProfile:p.aiProfile,targetConnection:p.targetConnection,releaseTarget:p.releaseTarget,
    protectedItems:p.protectedItems,editableItems:p.editableItems,metrics:p.metrics,
    acceptanceRubric:p.acceptanceRubric,evalSuite:p.evalSuite,hiddenEvalSuite:p.hiddenEvalSuite,
    sourceArtifacts:p.sourceArtifacts.map(s=>({id:s.id,name:s.name,role:s.role,artifactKind:s.artifactKind,
      artifactDescriptor:s.artifactDescriptor,mimeType:s.mimeType,size:s.size,extension:s.extension,inputMode:s.inputMode,storageRef:s.storageRef})),
    experimentPolicy,campaign:{executionMode:p.campaign.executionMode,candidateCount:p.campaign.candidateCount,parentStrategy:p.campaign.parentStrategy,
      searchMode:p.campaign.searchMode,exploreRatio:p.campaign.exploreRatio,eliteCount:p.campaign.eliteCount,stopCriteria:p.campaign.stopCriteria},
    maxRepairAttempts:p.artifactAcceptance.maxRepairAttempts}));
}
