import type {Candidate,EvolveProject} from "@evolution/contracts";
import {campaignRepairLimitStopReason} from "./campaign-control";
import {evidenceFingerprint} from "./evidence-binding";
import {hasFullHiddenMeasurement} from "./hidden-validation-evidence";
import {finalHoldoutContractFingerprint,finalHoldoutPaperHash} from "./independent-final-holdout";
import {verifiedValidationFailures} from "./artifact-acceptance-settlement";

/** Ordinary Hidden feedback can drive a mutation only before the independent final is consumed. */
export function artifactRepairStopReason(project:EvolveProject,candidate:Candidate):string|undefined{
  if(!["idle","running"].includes(project.campaign.status))return "Campaign 未运行或明确恢复，不能发起修复。";
  const limit=campaignRepairLimitStopReason(project);
  if(limit)return limit;
  if(project.artifactRepairAttempts?.some(attempt=>attempt.status==="running"))return "此前修复调用已开始但结果未确认；保留已消耗次数，禁止自动重发。";
  const round=project.campaign.currentRound+1,paper=project.finalHoldout;
  if(project.campaign.checkpoint?.round!==round||project.campaign.checkpoint.completedPhase!=="validation"
    ||project.candidates.filter(item=>item.id===candidate.id).length!==1
    ||project.validationRun.evidenceFingerprint!==evidenceFingerprint(project,candidate)
    ||!hasFullHiddenMeasurement(project.validationRun,candidate.id,project.hiddenEvalSuite)
    ||!verifiedValidationFailures(project,project.validationRun).length)return "缺少当前冻结候选已证实的同卷 Hidden 失败。";
  if(project.validationRun.independentFinal)return "独立终验已进入执行记录，禁止再使用反馈生成修复候选。";
  if(!paper||paper.round!==round||candidate.finalHoldoutPaperHash!==paper.paperHash
    ||paper.paperHash!==finalHoldoutPaperHash(paper.suite)||paper.contractFingerprint!==finalHoldoutContractFingerprint(project))return "反馈修复缺少规划前预留的原独立终验绑定；不得现在补题或换题。";
  if(project.artifactAcceptance.attempts>=project.artifactAcceptance.maxRepairAttempts)return "共享修复预算已耗尽。";
  return undefined;
}
