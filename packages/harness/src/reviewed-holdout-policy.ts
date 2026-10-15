import type {EvolveProject} from "@evolution/contracts";
import {campaignPreflightStopReason,goalReadiness} from "@evolution/core";

/** Permission to collect fresh isolated evidence only; never acceptance or a Safety override. */
export function reviewedHoldoutBoundary(project:EvolveProject,phase:"admission"|"acceptance"="admission"):string|undefined{
  if(project.targetConnection.adapter!=="artifact"||project.searchChampion||project.campaign.currentRound!==0||project.campaign.checkpoint?.round!==1)
    return "original-file-only";
  const sources=project.sourceArtifacts;
  if(sources.length!==1||sources[0]?.role!=="target"||sources[0].mimeType!=="text/html"||sources[0].inputMode!=="upload")
    return "single-uploaded-html-required";
  if(project.baselineRun.status!=="completed"||!project.baselineRun.completedAt||project.baselineRun.result?.safety!=="REVIEW"
    ||!project.baselineRun.result.notes.length)return "exact-original-review-required";
  if(project.campaign.schedule.enabled||project.release.status!=="idle"||project.artifactAcceptance.status!=="idle")
    return "isolated-evidence-only";
  if(phase==="admission"&&(project.campaign.status!=="paused"||project.campaign.checkpoint?.completedPhase!=="experiment"))
    return "paused-experiment-checkpoint-required";
  const winner=project.experimentRun.winnerId;
  const candidates=project.candidates.filter(c=>c.id===winner);
  const result=project.experimentRun.candidateResults.filter(r=>r.candidateId===winner);
  if(project.experimentRun.status!=="completed"||!winner||candidates.length!==1||result.length!==1
    ||result[0]!.experimentStage!=="finalist"||result[0]!.evaluation.safety!=="PASS"||!result[0]!.runs.length)
    return "independently-evaluated-winner-required";
  const candidate=candidates[0]!;
  if(candidate.artifactBuildStatus!=="ready"||candidate.artifactSnapshots.length!==1
    ||candidate.artifactSnapshots[0]?.sourceArtifactId!==sources[0]!.id
    ||!candidate.artifactSnapshots[0].frozenArtifact?.sha256.match(/^[0-9a-f]{64}$/))
    return "exact-frozen-candidate-required";
  // A valid downstream REVIEW/FAIL cannot be retried through this Original-only approval.
  if([project.validationRun.evaluation,project.validationRun.baselineEvaluation].some(e=>e&&e.safety!=="PASS")
    ||project.experimentRun.candidateResults.some(r=>r.experimentStage==="finalist"&&r.evaluation.safety==="FAIL"))
    return "downstream-safety-boundary";
  if(!goalReadiness(project).ready||project.gates.find(g=>g.id==="target-ready")?.status!=="approved"
    ||project.attentionRequests?.some(r=>r.status==="pending"&&r.blocking))return "approval-or-goal-boundary";
  return campaignPreflightStopReason(project)?"campaign-stop-boundary":undefined;
}
