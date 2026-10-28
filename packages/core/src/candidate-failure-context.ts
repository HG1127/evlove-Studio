import type {Candidate,EvolveProject} from "@evolution/contracts";

/** Memory is a generation treatment. It must not change the scoring contract. */
export function candidateFailureContextBlocker(project:EvolveProject,candidate:Candidate){
  const sources=project.failureObservationSources??[],use=candidate.planningFailureObservationUse;
  if(!sources.length&&!use)return undefined;
  if(!sources.length||!use||use.missionId!==project.id||use.grade!=="provided-to-plan"
    ||project.campaign.checkpoint&&use.round!==project.campaign.checkpoint.round
    ||JSON.stringify(use.sources)!==JSON.stringify(sources))return "[failure-context-binding-mismatch] Candidate 的历史失败规划记录与当前登记不一致；必须保留原记录并重新规划。";
  return undefined;
}
