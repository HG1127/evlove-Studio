import type {
  AcceptanceCriterion,
  CaseScore,
  CriterionScore,
  EvaluateAiResult,
  EvaluationResult,
  TargetRunResult,
  TestCase,
} from "@evolution/contracts";
import { hasDeterministicRoundtripProof } from "./deterministic-criterion-evidence";
import { indexUniqueById } from "./identity-index";
import {inspectHtmlNativeEvidence} from "./html-native-evidence";

export function citesHistoricalEvidence(text: string) {
  return /\b(?:diagnosis|sourceUnderstanding|designRationale|appliedPatches|searchAppliedPatches)\s*[.[]/i.test(text);
}

/** Normalize providers that answer a 0-100 score as a 0-1 fraction. */
export function normalizeEvaluationScore(value: number): number {
  const percent = value > 0 && value <= 1 ? value * 100 : value;
  return Math.round(Math.min(100, Math.max(0, percent)));
}

/** Deterministic criteria are settled by Runtime and must not consume or invalidate Judge output. */
function verifiedOriginalDefectRuns(
  criterion:AcceptanceCriterion,testCases:TestCase[],runs:TargetRunResult[],
) {
  if(!criterion.hardGate||criterion.source!=="user-command")return [];
  const mappedIds=new Set(testCases.filter(item=>item.criterionIds.includes(criterion.id)).map(item=>item.id));
  const {byId,duplicateIds}=indexUniqueById(runs,run=>run.testCaseId);
  if(!mappedIds.size||[...mappedIds].some(id=>duplicateIds.has(id)))return [];
  return [...mappedIds].flatMap(id=>{
    const observed=byId.get(id);
    if(observed?.verificationStatus!=="verified"
      ||typeof observed.output!=="string"
      ||!observed.output.startsWith("VERIFIED DOCUMENTED BASELINE DEFECT (not product success)")
      ||!Array.isArray(observed.trace))return [];
    const sourceProof=observed.trace.some(step=>step.stage==="baseline-exact-source-negative-evidence"&&step.status==="pass");
    const browserProof=!observed.error
      &&typeof observed.artifactHash==="string"&&/^[a-f0-9]{64}$/i.test(observed.artifactHash)
      &&observed.output.includes("Exact Original HTML SHA-256: "+observed.artifactHash)
      &&observed.trace.some(step=>step.stage==="sandbox-artifact"&&step.status==="pass")
      &&observed.trace.some(step=>step.stage==="browser-preview"&&step.status==="pass")
      &&observed.trace.some(step=>step.stage==="browser-step"&&step.status==="fail")
      &&observed.trace.some(step=>step.stage==="baseline-exact-browser-negative-evidence"&&step.status==="pass");
    if(!sourceProof&&!browserProof)return [];
    return [observed];
  });
}

export function criteriaRequiringJudge(
  criteria: AcceptanceCriterion[],
  testCases: TestCase[],
  runs: TargetRunResult[],
) {
  const mapped = new Set(testCases.flatMap((testCase) => testCase.criterionIds));
  return criteria.filter(criterion=>mapped.has(criterion.id)
    &&!hasDeterministicRoundtripProof(criterion,testCases,runs)
    &&!verifiedOriginalDefectRuns(criterion,testCases,runs).length);
}

export function deriveCriterionScores(
  criteria: AcceptanceCriterion[],
  testCases: TestCase[],
  caseScores: CaseScore[],
  runs: TargetRunResult[],
  aiCriteria?: Array<{ criterionId: string; score: number; pass: boolean; evidence: string[]; gaps: string[]; testCaseIds: string[] }>,
  ambiguousCaseIds: ReadonlySet<string> = new Set(),
) {
  const { byId: aiMap, duplicateIds: repeatedCriteria } = indexUniqueById(aiCriteria ?? [], (item) => item.criterionId);
  const { byId: caseMap, duplicateIds: repeatedCases } = indexUniqueById(caseScores, (item) => item.testCaseId);
  const { byId: runMap, duplicateIds: repeatedRuns } = indexUniqueById(runs, (item) => item.testCaseId);
  const criterionScores: CriterionScore[] = criteria.map((criterion) => {
    const mappedTests = testCases.filter((testCase) => testCase.criterionIds.includes(criterion.id));
    const mappedCases = mappedTests.map((testCase) => testCase.id);
    // Generated search smoke covers one interaction, not the complete protection contract.
    // Preserve the Runner's truthful assertion result while limiting criterion-level claims.
    const nativeFor=(testCase:TestCase)=>{
      const run=runMap.get(testCase.id);
      return run&&inspectHtmlNativeEvidence(run,testCase.id,criterion.artifactIds.length===1?criterion.artifactIds[0]:undefined,undefined,testCase.browserSteps);
    };
    const limitedCoverage = mappedTests.some((testCase) => testCase.tags?.includes("source-grounded-html-assertions")&&!nativeFor(testCase)?.complete);
    const coverageGaps = limitedCoverage ? ["自动生成的 HTML 检查仅覆盖搜索交互，尚未覆盖该保护标准的全部要求；需补齐对应的执行、视觉或人工证据"] : [];
    const mappedStatuses = mappedTests.map((testCase) => {
      const observed = runMap.get(testCase.id);
      // A claimed VERIFIED status without actual Run output/trace cannot establish evidence.
      if (observed?.verificationStatus === "verified"
        && (typeof observed.output !== "string" || !Array.isArray(observed.trace))) return "unverified" as const;
      const status = observed?.verificationStatus ?? "unverified";
      return status === "verified" && testCase.tags?.includes("source-grounded-html-assertions")&&!nativeFor(testCase)?.complete ? "partial" : status;
    });
    if (mappedCases.some((id) => repeatedRuns.has(id))) return {
      criterionId: criterion.id,
      score: 0,
      pass: false,
      verificationStatus: "unverified" as const,
      evidence: [],
      gaps: ["同一 Test Case 出现重复执行结果，证据身份不明确；需重新执行"],
      testCaseIds: mappedCases,
    };
    const deterministicRoundtrip = hasDeterministicRoundtripProof(criterion, testCases, runs);
    if (deterministicRoundtrip) return {
      criterionId: criterion.id,
      score: 100,
      pass: true,
      verificationStatus: "verified" as const,
      evidence: mappedCases.map((id) => `${id}: 当前 Candidate 已完成原格式 Roundtrip 并逐字一致`),
      gaps: [],
      testCaseIds: mappedCases,
    };
    if (repeatedCriteria.has(criterion.id) || mappedCases.some((id) => repeatedCases.has(id) || ambiguousCaseIds.has(id))) return {
      criterionId: criterion.id,
      score: 0,
      pass: false,
      verificationStatus: "unverified" as const,
      evidence: [],
      gaps: ["评审对同一 Criterion 或 Test Case 返回了重复判定，不能选择其中一项作为验收结果"],
      testCaseIds: mappedCases,
    };
    // A fully documented original defect is a VERIFIED failure, never a
    // success even if an independent Judge later assigns it a high score.
    // Duplicated/ambiguous runs and Judge rows have already failed closed above.
    const sourceDefectRuns=verifiedOriginalDefectRuns(criterion,testCases,runs);
    const nativeDefects=criterion.id==="PROTECT-ALL"?mappedTests.flatMap(test=>{
      const proof=nativeFor(test);
      return proof?.complete&&!proof.pass?[{id:test.id,failures:proof.failures}]:[];
    }):[];
    if(nativeDefects.length)return{
      criterionId:criterion.id,score:0,pass:false,verificationStatus:"verified" as const,
      evidence:nativeDefects.map(item=>`${item.id}: ${item.failures.join(", ")}`),
      gaps:["同一冻结 HTML 在原版健康的隔离浏览器中出现可复现保护断言失败；独立 Judge 不得覆盖实际失败。"],testCaseIds:mappedCases,
    };
    if(criterion.hardGate&&criterion.source==="user-command"&&sourceDefectRuns.length){
      return {
        criterionId:criterion.id,score:0,pass:false,verificationStatus:"verified" as const,
        evidence:sourceDefectRuns.map(run=>run.output.slice(0,700)).slice(0,4),
        gaps:["原版具有可核验的原文或云端 Chromium 断言缺陷证据；属于 VERIFIED FAIL，独立 Judge 不得把失败判为成功"],
        testCaseIds:mappedCases,
      };
    }
    const ai = aiMap.get(criterion.id);
    const historicalCitation = [
      ...(ai?.evidence ?? []),
      ...(ai?.gaps ?? []),
      ...mappedCases.flatMap((id) => caseMap.get(id)?.reason ?? []),
    ].some(citesHistoricalEvidence);
    if (historicalCitation) return {
      criterionId: criterion.id,
      score: 0,
      pass: false,
      verificationStatus: "unverified" as const,
      evidence: [],
      gaps: ["评审引用了历史诊断/方案说明，不能证明当前成果状态；需针对当前快照重新核查"],
      testCaseIds: mappedCases,
    };
    const related = mappedCases.flatMap((id) => {
      const item = caseMap.get(id);
      return item ? [item] : [];
    });
    const hasJudgement = Boolean(ai) || related.length > 0;
    const fullyVerified = hasJudgement && mappedCases.length > 0 && mappedStatuses.every((status) => status === "verified");
    const hasPartialEvidence = hasJudgement && mappedStatuses.some((status) => status === "verified" || status === "partial");
    const verificationStatus: CriterionScore["verificationStatus"] = fullyVerified ? "verified" : hasPartialEvidence ? "partial" : "unverified";
    if (ai && verificationStatus !== "unverified") {
      const score = normalizeEvaluationScore(ai.score);
      const scorePass = ai.pass && score >= criterion.minScore;
      const pass = !limitedCoverage && (criterion.hardGate ? verificationStatus === "verified" && scorePass : scorePass);
      const verificationGap = verificationStatus === "partial"
        ? ["当前只有部分/静态证据，尚不足以证明该项已在真实运行环境完全通过"]
        : [];
      return {
        criterionId: criterion.id,
        score,
        pass,
        verificationStatus,
        evidence: ai.evidence.slice(0, 6),
        gaps: [...coverageGaps, ...verificationGap, ...ai.gaps.slice(0, 6)],
        testCaseIds: ai.testCaseIds.filter((id) => mappedCases.includes(id)).length
          ? ai.testCaseIds.filter((id) => mappedCases.includes(id))
          : mappedCases,
      };
    }
    const score = related.length
      ? Math.round(related.reduce((sum, item) => sum + (item.accuracy + item.evidence + item.completeness) / 3, 0) / related.length)
      : 0;
    const scorePass = score >= criterion.minScore;
    const pass = limitedCoverage || verificationStatus === "unverified"
      ? false
      : criterion.hardGate
        ? verificationStatus === "verified" && scorePass
        : scorePass;
    const mappedRunsCompleted = mappedCases.length > 0 && mappedStatuses.some((status) => status === "verified" || status === "partial");
    const gaps = verificationStatus === "unverified"
      ? [mappedRunsCompleted && !hasJudgement
          ? "测试已执行，但评审模型未返回逐题或逐标准判定；该项标记为待补评审，不能按 0 分判定产品失败"
          : mappedCases.length
            ? "当前运行时没有该验收项所需的真实证据能力；该项标记为未验证，不把解析器/Runner能力缺失误判为产品失败"
            : "该 criterion 没有映射到任何测试题"]
      : verificationStatus === "partial"
        ? ["只有部分/静态证据，需要真实 Runner / 视觉审查 / 人工验收才能完全确认", ...(scorePass ? [] : ["现有证据得分未达到最低分"])]
        : scorePass ? [] : ["映射测试未达到 criterion 最低分"];
    return {
      criterionId: criterion.id,
      score,
      pass,
      verificationStatus,
      evidence: related.map((item) => `${item.testCaseId}: ${item.reason}`).slice(0, 4),
      gaps: [...coverageGaps, ...gaps],
      testCaseIds: mappedCases,
    };
  });

  const totalWeight = criteria.reduce((sum, item) => sum + item.weight, 0) || 1;
  const effectiveWeight = (criterion: AcceptanceCriterion) => {
    const status = criterionScores.find((item) => item.criterionId === criterion.id)?.verificationStatus;
    return status === "verified" ? criterion.weight : status === "partial" ? criterion.weight * 0.5 : 0;
  };
  const scoredWeight = criteria.reduce((sum, criterion) => sum + effectiveWeight(criterion), 0);
  const rubricScore = criteria.length && scoredWeight > 0
    ? Math.round(criteria.reduce((sum, criterion) => sum + (criterionScores.find((item) => item.criterionId === criterion.id)?.score ?? 0) * effectiveWeight(criterion), 0) / scoredWeight)
    : undefined;
  const verifiedWeight = criteria.reduce(
    (sum, criterion) => sum + (criterionScores.find((item) => item.criterionId === criterion.id)?.verificationStatus === "verified" ? criterion.weight : 0),
    0,
  );
  const verifiedRubricCoverage = criteria.length ? Math.round(verifiedWeight / totalWeight * 100) : 100;
  const unverifiedCriterionIds = criterionScores.filter((item) => item.verificationStatus !== "verified").map((item) => item.criterionId);
  return { criterionScores, rubricScore, verifiedRubricCoverage, unverifiedCriterionIds };
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/** Settle actual deterministic proof without inventing semantic Judge scores. */
export function settleDeterministicEvaluation(args: {
  criteria: AcceptanceCriterion[];
  testCases: TestCase[];
  runs: TargetRunResult[];
  notes?: string[];
}): EvaluationResult {
  const rubric = deriveCriterionScores(args.criteria, args.testCases, [], args.runs);
  const executed = args.runs.filter((run) => !run.error);
  const source = executed.length ? executed : args.runs;
  return {
    accuracy: 0, evidence: 0, riskCoverage: 0, completeness: 0, safety: "PASS",
    notes: args.notes ?? ["仅结算确定性证据；通用质量维度未测量，保持 0，不代表产品失败。"],
    failures: [], caseScores: [], ...rubric,
    averageCost: Number(average(source.map((run) => run.cost)).toFixed(4)),
    averageLatencyMs: Math.round(average(source.map((run) => run.latencyMs))),
  };
}

/** Convert a structured independent Judge result into the canonical EvaluationResult. */
export function settleAiEvaluation(args: {
  criteria: AcceptanceCriterion[];
  testCases: TestCase[];
  runs: TargetRunResult[];
  ai: EvaluateAiResult;
  notes?: string[];
}): EvaluationResult {
  const knownIds = new Set(args.testCases.map((testCase) => testCase.id));
  const normalizedCaseScores: CaseScore[] = args.ai.cases
    .filter((item) => knownIds.has(item.testCaseId))
    .map((item) => ({
      testCaseId: item.testCaseId,
      accuracy: normalizeEvaluationScore(item.accuracy),
      evidence: normalizeEvaluationScore(item.evidence),
      completeness: normalizeEvaluationScore(item.completeness),
      reason: item.reason.slice(0, 200),
    }));
  const { duplicateIds: ambiguousCaseIds } = indexUniqueById(normalizedCaseScores, (item) => item.testCaseId);
  const caseScores = normalizedCaseScores.filter((item) => !ambiguousCaseIds.has(item.testCaseId));
  const rubric = deriveCriterionScores(args.criteria, args.testCases, caseScores, args.runs, args.ai.criteria, ambiguousCaseIds);
  const executed = args.runs.filter((run) => !run.error);
  const costSource = executed.length ? executed : args.runs;
  return {
    accuracy: normalizeEvaluationScore(args.ai.accuracy),
    evidence: normalizeEvaluationScore(args.ai.evidence),
    riskCoverage: normalizeEvaluationScore(args.ai.riskCoverage),
    completeness: normalizeEvaluationScore(args.ai.completeness),
    safety: args.ai.safety,
    notes: [...(args.notes ?? []), ...args.ai.notes],
    failures: args.ai.failures,
    caseScores,
    rubricScore: rubric.rubricScore,
    verifiedRubricCoverage: rubric.verifiedRubricCoverage,
    unverifiedCriterionIds: rubric.unverifiedCriterionIds,
    criterionScores: rubric.criterionScores,
    averageCost: Number(average(costSource.map((run) => run.cost)).toFixed(4)),
    averageLatencyMs: Math.round(average(costSource.map((run) => run.latencyMs))),
  };
}
