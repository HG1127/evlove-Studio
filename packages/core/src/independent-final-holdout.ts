import {IndependentFinalEvidenceSchema,IndependentFinalExecutionContractSchema,type IndependentFinalExecutionContract,type Candidate,type EvolveProject,type TestCase,type ValidationRun} from "@evolution/contracts";
import {fastHash} from "./stable-hash";
import {evidenceFingerprint} from "./evidence-binding";
import {hasAuthoritativeHiddenRelease,hasFullHiddenMeasurement} from "./hidden-validation-evidence";
import {indexScopedAcceptanceResults} from "./acceptance-result-identity";
import {validationDecision} from "./validation-decision";
import {rubricSuiteCoverage} from "./rubric-readiness";

export const finalHoldoutPaperHash=(suite:readonly TestCase[])=>fastHash(JSON.stringify(suite));
export const finalHoldoutExecutionFingerprint=(contract:IndependentFinalExecutionContract)=>fastHash(JSON.stringify(IndependentFinalExecutionContractSchema.parse(contract)));
export function assertIndependentFinalExecution(suite:TestCase[],contract:IndependentFinalExecutionContract){
  const checked=IndependentFinalExecutionContractSchema.parse(contract);
  const unavailable=suite.filter(test=>!checked.supportedModes.includes(test.executionMode)
    ||test.browserSteps?.length&&checked.browserAssertionModes&&!checked.browserAssertionModes.includes(test.executionMode)
    ||(checked.requireBrowserStepsForExternal&&["external-runner","visual-review"].includes(test.executionMode)
      &&(!test.browserSteps?.some(step=>["visible","text","count"].includes(step.action))
        ||test.browserSteps.some(step=>step.action==="text"&&!step.value?.trim())
        ||test.browserSteps.some(step=>step.action==="count"&&step.count===undefined))));
  if(unavailable.length)throw Object.assign(Error("独立终验缺少已绑定执行能力或浏览器断言："+unavailable.map(t=>`${t.id.slice(0,120)} (${t.executionMode})`).join("、")),{code:"INDEPENDENT_FINAL_EXECUTION_UNAVAILABLE"});
}
/** An independently bound hard failure survives unrelated missing evidence. */
function hasBoundFinalHardFailure(project:EvolveProject,candidate:Candidate,measured:ValidationRun,suite:TestCase[]){
  if(!hasFullHiddenMeasurement(measured,candidate.id,suite))return false;
  const scores=indexScopedAcceptanceResults([{requestedCriterionIds:project.acceptanceRubric.map(c=>c.id),results:measured.evaluation?.criterionScores??[]}]).byId;
  return project.acceptanceRubric.some(criterion=>{
    const score=scores.get(criterion.id),mapped=suite.filter(test=>test.criterionIds.includes(criterion.id));
    if(!criterion.hardGate||project.acceptanceRubric.filter(item=>item.id===criterion.id).length!==1
      ||measured.evaluation?.unverifiedCriterionIds?.includes(criterion.id)
      ||score?.verificationStatus!=="verified"||score.pass&&score.score>=criterion.minScore
      ||!mapped.length||score.testCaseIds.length!==mapped.length||new Set(score.testCaseIds).size!==score.testCaseIds.length)return false;
    return mapped.every(test=>{
      const run=measured.runs.find(item=>item.testCaseId===test.id);
      if(!score.testCaseIds.includes(test.id)||run?.verificationStatus!=="verified"||run.error||!run.output.trim())return false;
      // A declared browser predicate cannot be proven by an unbound semantic summary.
      if(test.browserSteps?.length){
        if(!["external-runner","visual-review"].includes(test.executionMode))return false;
        const sources=project.sourceArtifacts.filter(source=>source.role==="target"&&(!criterion.artifactIds.length||criterion.artifactIds.includes(source.id)));
        const snapshots=candidate.artifactSnapshots.filter(snapshot=>sources.some(source=>source.id===snapshot.sourceArtifactId));
        return sources.length===1&&snapshots.length===1&&Boolean(run.artifactHash
          &&snapshots[0]!.frozenArtifact?.sourceArtifactId===sources[0]!.id&&snapshots[0]!.frozenArtifact.sha256===run.artifactHash);
      }
      return true;
    });
  });
}
export function independentFinalReplacementBlocker(project:EvolveProject,round:number){
  if(project.finalHoldout?.round!==round)return undefined;
  if(project.candidates.length||project.experimentRun.candidateResults.length||project.validationRun.candidateId
    ||project.validationRun.independentFinal||project.artifactAcceptance.candidateId||project.artifactAcceptance.attempts>0
    ||project.roundHistory.some(item=>item.round===round&&item.candidateCount>0)){
    return "本轮已存在候选或候选反馈，不能替换独立终验题集。";
  }
  return undefined;
}
export const finalHoldoutContractFingerprint=(project:EvolveProject)=>fastHash(JSON.stringify([
  ...(project.failureObservationSources?.length?[{failureObservationSources:project.failureObservationSources}]:[]),
  project.goal,project.evolutionCommand,project.metrics,project.protectedItems,project.editableItems,project.acceptanceRubric,
  project.sourceArtifacts.map(source=>[source.id,source.role,source.textContent,source.structuredContent]),
  ...(project.experimentPolicy?.winnerGoalScope?[{winnerGoalScope:project.experimentPolicy.winnerGoalScope}]:[]),
  ...(project.experimentPolicy?.judgeComparison?[{judgeComparison:project.experimentPolicy.judgeComparison}]:[]),
  ...(project.experimentPolicy?.judgeFileMetadata?[{judgeFileMetadata:project.experimentPolicy.judgeFileMetadata,
    sourceMetadata:project.sourceArtifacts.filter(s=>s.role==="target").map(s=>[s.id,s.name,s.mimeType]),
    originalReferences:project.baselineRun.originalReferences,
  }]:[]),
  ...(project.experimentPolicy?.hiddenFailureRepair==="artifact-targeted-repair-v2"?[{hiddenFailureRepair:project.experimentPolicy.hiddenFailureRepair}]:[]),
]));
function caseKey(test:TestCase){
  const text=(value:string)=>value.trim().replace(/\s+/g," ").toLowerCase();
  const steps=test.browserSteps?.map(step=>({action:step.action,selector:step.selector.trim(),
    ...(["fill","text"].includes(step.action)?{value:step.value??""}:{}),...(step.action==="count"?{count:step.count}:{}),
  }));
  // Relabeling an execution mode/scope or filling unused browser operands does
  // not create a new independent scenario.
  return JSON.stringify([text(test.input),test.expected.map(text).sort(),test.criterionIds.slice().sort(),steps?.length?steps:undefined]);
}
export function assertIndependentFinalPaper(project:EvolveProject,suite:TestCase[]){
  const exposed=new Set([...project.evalSuite,...project.hiddenEvalSuite,...(project.supersededFinalHoldouts??[]).flatMap(paper=>paper.suite)].map(caseKey));
  const ids=new Set<string>(),keys=new Set<string>();
  const known=new Set(project.acceptanceRubric.map(criterion=>criterion.id));
  const reasons:string[]=[];
  if(!suite.length)reasons.push("题集为空");
  for(const test of suite){
    const key=caseKey(test);
    const id=test.id.slice(0,120);
    if(!test.hidden)reasons.push(`${id}: 必须标记为隐藏题`);
    if(ids.has(test.id)||[...project.evalSuite,...project.hiddenEvalSuite].some(old=>old.id===test.id))reasons.push(`${id}: 题目 ID 重复`);
    if(keys.has(key)||exposed.has(key))reasons.push(`${id}: 复制了已有场景；改名、改模式或无关浏览器参数不构成独立题目`);
    if(!test.criterionIds.length||test.criterionIds.some(id=>!known.has(id)))reasons.push(`${id}: 未准确绑定当前 Rubric Criterion ID`);
    ids.add(test.id);keys.add(key);
  }
  const coverage=rubricSuiteCoverage(project.acceptanceRubric,[],suite);
  if(coverage.uncovered.length)reasons.push("缺少标准覆盖："+coverage.uncovered.join("、"));
  if(coverage.hiddenHardGateMissing.length)reasons.push("缺少隐藏题 Hard Gate 覆盖："+coverage.hiddenHardGateMissing.map(c=>c.id).join("、"));
  if(reasons.length){
    throw Object.assign(Error("独立终验题集不符合固定契约："+reasons.slice(0,16).join("；")),{code:"INDEPENDENT_FINAL_PAPER_INVALID"});
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
  if(hasBoundFinalHardFailure(project,candidate,measured,proof.suite))return {ready:false,failed:true,reason:"独立终验存在已绑定同卷执行证据的硬指标失败；禁止使用终验反馈继续定向修复。"};
  if(proof.suite.some(test=>test.browserSteps?.length&&!["external-runner","visual-review"].includes(test.executionMode)))return pending("独立终验声明了浏览器断言，但未使用已绑定的浏览器执行通道；语义评审不能替代这些断言。");
  if(!proof.evaluation||!proof.baselineEvaluation)return pending("独立终验尚未完成双侧评审。");
  const decision=validationDecision(project,proof.evaluation,proof.baselineEvaluation,proof.suite);
  const belowHardMinimum=project.acceptanceRubric.some(criterion=>criterion.hardGate&&proof.evaluation!.criterionScores?.some(score=>score.criterionId===criterion.id&&score.verificationStatus==="verified"&&score.score<criterion.minScore));
  if(!decision.evidenceIncomplete&&(decision.hardFail||belowHardMinimum||proof.recommendation==="reject"))return {ready:false,failed:true,reason:"独立终验未通过；禁止使用终验反馈继续定向修复。"};
  if(!hasAuthoritativeHiddenRelease(measured,candidate.id,proof.suite,project.acceptanceRubric)||decision.evidenceIncomplete)return pending("独立终验缺少完整同卷证据或 Release Review。");
  return {ready:true,failed:false,reason:"预留独立终验已对冻结候选完成同卷验证。"};
}
