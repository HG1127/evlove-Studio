import {IndependentFinalEvidenceSchema,type Candidate,type EvolveProject,type TestCase,type ValidationRun} from "@evolution/contracts";
import {fastHash} from "./stable-hash";
import {evidenceFingerprint} from "./evidence-binding";
import {hasAuthoritativeHiddenRelease} from "./hidden-validation-evidence";
import {validationDecision} from "./validation-decision";
import {rubricSuiteCoverage} from "./rubric-readiness";

export const finalHoldoutPaperHash=(suite:readonly TestCase[])=>fastHash(JSON.stringify(suite));
export const finalHoldoutContractFingerprint=(project:EvolveProject)=>fastHash(JSON.stringify([
  project.goal,project.evolutionCommand,project.metrics,project.protectedItems,project.editableItems,project.acceptanceRubric,
  project.sourceArtifacts.map(source=>[source.id,source.role,source.textContent,source.structuredContent]),
]));
function caseKey(test:TestCase){
  const text=(value:string)=>value.trim().replace(/\s+/g," ").toLowerCase();
  return JSON.stringify([text(test.input),test.expected.map(text).sort(),test.criterionIds.slice().sort(),test.executionMode,test.evidenceScope,test.browserSteps]);
}
export function assertIndependentFinalPaper(project:EvolveProject,suite:TestCase[]){
  const exposed=new Set([...project.evalSuite,...project.hiddenEvalSuite].map(caseKey));
  const ids=new Set<string>(),keys=new Set<string>();
  const known=new Set(project.acceptanceRubric.map(criterion=>criterion.id));
  if(!suite.length||suite.some(test=>{
    const key=caseKey(test);
    if(!test.hidden||ids.has(test.id)||keys.has(key)||exposed.has(key)
      ||[...project.evalSuite,...project.hiddenEvalSuite].some(old=>old.id===test.id)
      ||!test.criterionIds.length||test.criterionIds.some(id=>!known.has(id)))return true;
    ids.add(test.id);keys.add(key);return false;
  })||!rubricSuiteCoverage(project.acceptanceRubric,project.evalSuite,suite).ready){
    throw Error("独立终验题集必须覆盖当前契约，且不能复制已公开或已用于修复的题目。");
  }
}
export function independentFinalReadiness(project:EvolveProject,candidate:Candidate,validation=project.validationRun){
  const pending=(reason:string)=>({ready:false,failed:false,reason});
  const required=Boolean(candidate.finalHoldoutPaperHash||(project.artifactAcceptance?.candidateId===candidate.id&&project.artifactAcceptance.attempts>0));
  if(!required)return {ready:true,failed:false,reason:"首轮未暴露反馈的历史 Hidden 契约。"};
  const parsed=IndependentFinalEvidenceSchema.safeParse(validation.independentFinal);
  if(!parsed.success||!candidate.finalHoldoutPaperHash)return pending("缺少候选生成前预留的独立终验凭证；修复反馈后的同卷复验不能替代终验。");
  const proof=parsed.data;
  if(proof.candidateId!==candidate.id||proof.inputFingerprint!==evidenceFingerprint(project,candidate)
    ||proof.paperHash!==candidate.finalHoldoutPaperHash||finalHoldoutPaperHash(proof.suite)!==proof.paperHash)return pending("独立终验的题集、候选或输入指纹不一致。");
  try{assertIndependentFinalPaper(project,proof.suite);}catch(error){return pending((error as Error).message);}
  const measured:ValidationRun={...proof,id:"independent-final",checks:[],validationMode:"full",plannedCases:proof.suite.length,executedCases:proof.runs.length};
  if(!proof.evaluation||!proof.baselineEvaluation)return pending("独立终验尚未完成双侧评审。");
  const decision=validationDecision(project,proof.evaluation,proof.baselineEvaluation);
  const belowHardMinimum=project.acceptanceRubric.some(criterion=>criterion.hardGate&&proof.evaluation!.criterionScores?.some(score=>score.criterionId===criterion.id&&score.verificationStatus==="verified"&&score.score<criterion.minScore));
  if(!decision.evidenceIncomplete&&(decision.hardFail||belowHardMinimum||proof.recommendation==="reject"))return {ready:false,failed:true,reason:"独立终验未通过；禁止使用终验反馈继续定向修复。"};
  if(!hasAuthoritativeHiddenRelease(measured,candidate.id,proof.suite,project.acceptanceRubric)||decision.evidenceIncomplete)return pending("独立终验缺少完整同卷证据或 Release Review。");
  return {ready:true,failed:false,reason:"预留独立终验已对冻结候选完成同卷验证。"};
}
