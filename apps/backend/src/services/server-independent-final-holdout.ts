import {IndependentFinalEvidenceSchema,type Candidate,type EvolveProject} from "@evolution/contracts";
import {evidenceFingerprint,finalHoldoutPaperHash} from "@evolution/core";
import {runServerMissionHoldout} from "./server-holdout";

export async function verifyServerIndependentFinalHoldout(
  {project,candidate}:{project:EvolveProject;candidate:Candidate},execute=runServerMissionHoldout,
){
  const reservation=project.finalHoldout;
  if(!reservation||reservation.paperHash!==candidate.finalHoldoutPaperHash||finalHoldoutPaperHash(reservation.suite)!==reservation.paperHash){
    throw Error("缺少候选生成前冻结的独立终验题集；禁止在看到修复结果后补造题集。");
  }
  const round=project.campaign.checkpoint?.round??project.campaign.currentRound+1;
  const final=await execute({...project,hiddenEvalSuite:reservation.suite,
    validationRun:{id:"independent-final-pending",status:"idle",runs:[],baselineRuns:[],checks:[]},
    campaign:{...project.campaign,checkpoint:{round,completedPhase:"experiment",at:new Date().toISOString()}}});
  return IndependentFinalEvidenceSchema.parse({...final.validation,candidateId:candidate.id,inputFingerprint:evidenceFingerprint(project,candidate),
    paperHash:reservation.paperHash,suite:reservation.suite});
}
