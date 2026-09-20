import { serverEnv } from "../runtime/env";
import { EvaluateAiResultSchema } from "../ai/schemas";
import { getAiProviderStatus, runEvolveAi, type AiAttemptNotice } from "../ai/service";
import type { AcceptanceCriterion, CriterionScore, EvaluationResult, TargetRunResult, TestCase } from "../schemas";
import { retrieveTextContext } from "../runtime/context-retrieval";
import { hasDeterministicRoundtripProof } from "@evolution/core";

export function citesHistoricalEvidence(text: string) {
  return /\b(?:diagnosis|sourceUnderstanding|designRationale|appliedPatches|searchAppliedPatches)\s*[.[]/i.test(text);
}

function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function reviewOutput(text: string, query: string, maxChars = 6500) {
  if (text.length <= maxChars) return { excerpts: [text], originalLength: text.length, reviewedLength: text.length, truncated: false };
  const selected = retrieveTextContext(text, query, { maxChars, maxChunks: 5 });
  return { excerpts: selected.split("\n\n---\n\n"), originalLength: text.length, reviewedLength: selected.length, truncated: true };
}

function rubricFromContext(context: Record<string, unknown>): AcceptanceCriterion[] {
  const project = context.project as { acceptanceRubric?: AcceptanceCriterion[] } | undefined;
  return Array.isArray(project?.acceptanceRubric) ? project!.acceptanceRubric! : [];
}

/** Deterministic criteria are settled by Runtime and must not consume or invalidate Judge output. */
export function criteriaRequiringJudge(criteria: AcceptanceCriterion[], testCases: TestCase[], runs: TargetRunResult[]) {
  const mapped = new Set(testCases.flatMap((testCase) => testCase.criterionIds));
  return criteria.filter((criterion) => mapped.has(criterion.id) && !hasDeterministicRoundtripProof(criterion, testCases, runs));
}

export function deriveCriterionScores(
  criteria: AcceptanceCriterion[],
  testCases: TestCase[],
  caseScores: NonNullable<EvaluationResult["caseScores"]>,
  runs: TargetRunResult[],
  aiCriteria?: Array<{ criterionId: string; score: number; pass: boolean; evidence: string[]; gaps: string[]; testCaseIds: string[] }>,
) {
  const aiMap = new Map((aiCriteria ?? []).map((item) => [item.criterionId, item]));
  const caseMap = new Map(caseScores.map((item) => [item.testCaseId, item]));
  const runMap = new Map(runs.map((item) => [item.testCaseId, item]));
  const criterionScores: CriterionScore[] = criteria.map((criterion) => {
    const mappedCases = testCases.filter((testCase) => testCase.criterionIds.includes(criterion.id)).map((testCase) => testCase.id);
    const mappedStatuses = mappedCases.map((id) => runMap.get(id)?.verificationStatus ?? "unverified");
    // Deterministic format evidence does not need an LLM to repeat the same verdict. If the runtime
    // actually encoded/decoded the current Candidate snapshot and compared it byte-for-byte/text-for-
    // text, settle the criterion here even when the judge omitted its criteria[] row. This prevents a
    // verified TXT/MD roundtrip from getting stuck forever as "待补评审".
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
    const ai = aiMap.get(criterion.id);
    const historicalCitation = [...(ai?.evidence ?? []), ...(ai?.gaps ?? []), ...mappedCases.flatMap((id) => caseMap.get(id)?.reason ?? [])].some(citesHistoricalEvidence);
    if (historicalCitation) return {
      criterionId: criterion.id, score: 0, pass: false, verificationStatus: "unverified" as const,
      evidence: [], gaps: ["评审引用了历史诊断/方案说明，不能证明当前成果状态；需针对当前快照重新核查"], testCaseIds: mappedCases,
    };
    const related = mappedCases.flatMap((id) => { const item = caseMap.get(id); return item ? [item] : []; });
    // A successful artifact run proves that output was produced. It does not prove that an
    // acceptance criterion passed. A judge that omits both criterion and case scores formerly
    // turned this state into a verified 0/FALSE, producing the misleading 0% shown in the UI.
    const hasJudgement = Boolean(ai) || related.length > 0;
    const fullyVerified = hasJudgement && mappedCases.length > 0 && mappedStatuses.every((status) => status === "verified");
    const hasPartialEvidence = hasJudgement && mappedStatuses.some((status) => status === "verified" || status === "partial");
    const verificationStatus: CriterionScore["verificationStatus"] = fullyVerified ? "verified" : hasPartialEvidence ? "partial" : "unverified";
    if (ai && verificationStatus !== "unverified") {
      const score = normalizeScore(ai.score);
      const scorePass = ai.pass && score >= criterion.minScore;
      const pass = criterion.hardGate ? verificationStatus === "verified" && scorePass : scorePass;
      const verificationGap = verificationStatus === "partial" ? ["当前只有部分/静态证据，尚不足以证明该项已在真实运行环境完全通过"] : [];
      return {
        criterionId: criterion.id, score, pass, verificationStatus,
        evidence: ai.evidence.slice(0, 6), gaps: [...verificationGap, ...ai.gaps.slice(0, 6)],
        testCaseIds: ai.testCaseIds.filter((id) => mappedCases.includes(id)).length ? ai.testCaseIds.filter((id) => mappedCases.includes(id)) : mappedCases,
      };
    }
    const score = related.length ? Math.round(related.reduce((sum, item) => sum + (item.accuracy + item.evidence + item.completeness) / 3, 0) / related.length) : 0;
    const scorePass = score >= criterion.minScore;
    const pass = verificationStatus === "unverified" ? false : criterion.hardGate ? verificationStatus === "verified" && scorePass : scorePass;
    const mappedRunsCompleted = mappedCases.length > 0 && mappedStatuses.some((status) => status === "verified" || status === "partial");
    const gaps = verificationStatus === "unverified"
      ? [mappedRunsCompleted && !hasJudgement ? "测试已执行，但评审模型未返回逐题或逐标准判定；该项标记为待补评审，不能按 0 分判定产品失败" : mappedCases.length ? "当前运行时没有该验收项所需的真实证据能力；该项标记为未验证，不把解析器/Runner能力缺失误判为产品失败" : "该 criterion 没有映射到任何测试题"]
      : verificationStatus === "partial"
        ? ["只有部分/静态证据，需要真实 Runner / 视觉审查 / 人工验收才能完全确认", ...(scorePass ? [] : ["现有证据得分未达到最低分"]) ]
        : scorePass ? [] : ["映射测试未达到 criterion 最低分"];
    return { criterionId: criterion.id, score, pass, verificationStatus, evidence: related.map((item) => `${item.testCaseId}: ${item.reason}`).slice(0, 4), gaps, testCaseIds: mappedCases };
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
  const verifiedWeight = criteria.reduce((sum, criterion) => sum + (criterionScores.find((item) => item.criterionId === criterion.id)?.verificationStatus === "verified" ? criterion.weight : 0), 0);
  const verifiedRubricCoverage = criteria.length ? Math.round(verifiedWeight / totalWeight * 100) : 100;
  const unverifiedCriterionIds = criterionScores.filter((item) => item.verificationStatus !== "verified").map((item) => item.criterionId);
  return { criterionScores, rubricScore, verifiedRubricCoverage, unverifiedCriterionIds };
}


/**
 * 归一化 AI 评分：部分模型会把 0-100 百分制答成 0-1 比例（0.92），
 * 直接渲染会出现「准确率 1%」这种假数据；(0,1] 一律按比例放大，其余 clamp 到 0-100。
 * 真打出 1 分的场景几乎不存在，1.0 反而更常是「满分比例」，所以按比例处理。
 */
function normalizeScore(value: number): number {
  const percent = value > 0 && value <= 1 ? value * 100 : value;
  return Math.round(Math.min(100, Math.max(0, percent)));
}

function demoScore(runs: TargetRunResult[]): Omit<EvaluationResult, "averageCost" | "averageLatencyMs"> {
  const text = runs.map((r) => r.output).join("\n");
  const strongEvidence = /all claims mapped|Evidence Gate|citation validator/i.test(text);
  const partialEvidence = /most claims mapped|prompt reminds/i.test(text);
  const baseline = /some claims miss/i.test(text);
  const evidence = strongEvidence ? 91 : partialEvidence ? 83 : baseline ? 71 : 80;
  const accuracy = strongEvidence ? 92 : partialEvidence ? 90 : 88;
  const riskCoverage = /falsifiers/i.test(text) ? 88 : /risk section/i.test(text) ? 82 : 74;
  // 演示模式也给出逐题分数（按该题输出的证据特征打分），保证差距归因在演示下可用。
  const caseScores = runs.map((run) => {
    if (run.error) return { testCaseId: run.testCaseId, accuracy: 20, evidence: 10, completeness: 0, reason: `演示引擎：该题执行失败（${run.error.slice(0, 40)}），按未完成计分` };
    const strong = /all claims mapped|Evidence Gate|citation validator/i.test(run.output);
    const partial = /most claims mapped|prompt reminds/i.test(run.output);
    const weak = /some claims miss/i.test(run.output);
    return {
      testCaseId: run.testCaseId,
      accuracy: strong ? 93 : partial ? 90 : weak ? 82 : 87,
      evidence: strong ? 92 : partial ? 84 : weak ? 68 : 80,
      completeness: strong ? 92 : partial ? 88 : weak ? 80 : 85,
      reason: strong ? "演示评分：结论均已绑定来源，符合验收标准" : partial ? "演示评分：多数结论有来源，少量长引用缺失" : weak ? "演示评分：部分关键结论缺少可验证来源（与验收标准不符）" : "演示评分：未见明确证据关键词，按基础分计",
    };
  });
  return {
    accuracy,
    evidence,
    riskCoverage,
    completeness: Math.round((accuracy + evidence + riskCoverage) / 3),
    safety: "PASS",
    notes: [strongEvidence ? "证据检查机制在测试集中稳定生效" : "仍存在证据覆盖不足的案例"],
    failures: evidence < 85 ? ["部分关键 claim 缺少可验证来源"] : [],
    caseScores,
  };
}


function evaluatorReviewBudget(context: Record<string, unknown>) {
  const mode = String(context.mode ?? "");
  if (mode.includes("repair-focus")) return 4200;
  if (mode.includes("holdout")) return 7500;
  if (mode.includes("candidate")) return 5200;
  if (mode.includes("baseline")) return 6000;
  return 6000;
}

/** One shared evidence budget prevents test count from multiplying the judge prompt. */
export function evaluatorReviewAllocation(context: Record<string, unknown>, runCount: number) {
  const mode = String(context.mode ?? "");
  const total = mode.includes("repair-focus") ? 9_000 : mode.includes("holdout") ? 24_000 : 18_000;
  return { total, perRun: Math.max(1, Math.min(evaluatorReviewBudget(context), Math.floor(total / Math.max(1, runCount)))) };
}

function compactEvaluationContext(context: Record<string, unknown>, rubric: AcceptanceCriterion[]) {
  const project = (context.project ?? {}) as Record<string, unknown>;
  const sourceUnderstanding = project.sourceUnderstanding as Record<string, unknown> | undefined;
  const semanticEvolution = project.semanticEvolution as Record<string, unknown> | undefined;
  return {
    mode: context.mode,
    candidate: context.candidate ? { id: (context.candidate as { id?: string }).id } : undefined,
    project: {
      goal: project.goal,
      metrics: project.metrics,
      acceptanceRubric: rubric,
      adaptiveStrategy: project.adaptiveStrategy,
      aiProfile: project.aiProfile,
      sourceUnderstanding: sourceUnderstanding ? {

        evolutionIntent: sourceUnderstanding.evolutionIntent,
        acceptanceCriteria: sourceUnderstanding.acceptanceCriteria,
      } : undefined,
      semanticEvolution: semanticEvolution ? { semanticObject: semanticEvolution.semanticObject, intent: semanticEvolution.intent } : undefined,
    },
  };
}

export async function evaluateRuns(args: {
  testCases: TestCase[];
  runs: TargetRunResult[];
  context: Record<string, unknown>;
  forceRefresh?: boolean;
}): Promise<EvaluationResult> {
  const status = getAiProviderStatus("evaluate", args.context);
  if (args.forceRefresh && !status.live) throw new Error("补跑评审没有可用的真实模型连接，请检查当前项目评审模型配置");
  const evaluatorMode = serverEnv.EVOLVE_EVALUATOR || "auto";
  const useAi = Boolean(args.forceRefresh) || evaluatorMode === "ai" || (evaluatorMode === "auto" && status.live);

  // 审计留痕：重试、演示兜底、小数换算都写进结果备注，报表里可追溯，不让降级静默发生。
  const warnings: string[] = [];
  const onAttemptNotice = (notice: AiAttemptNotice) => {
    if (notice.kind === "retry") warnings.push(`评审留痕：连接 ${notice.model.slice(0, 40)} 未能产出有效评审（${notice.message.slice(0, 120)}），已自动切换下一个重试`);
    else warnings.push(`评审留痕：全部真实连接失败，本轮评审由内置演示引擎生成，结果仅供参考`);
  };

  let core: Omit<EvaluationResult, "averageCost" | "averageLatencyMs">;
  if (useAi) {
    const rubric = rubricFromContext(args.context);
    const evaluatorRubric = criteriaRequiringJudge(rubric, args.testCases, args.runs);
    const judgeCriterionIds = new Set(evaluatorRubric.map((criterion) => criterion.id));
    const rubricMap = new Map(rubric.map((criterion) => [criterion.id, criterion]));
    // V2.2: long output is retrieved against each test + mapped rubric requirements.
    // We sample the whole artifact (head/tail + relevant chunks) instead of sending 48k/test or only the beginning.
    const judgeCaseIds = new Set(args.testCases.filter((testCase) => testCase.criterionIds.length === 0 || testCase.criterionIds.some((id) => judgeCriterionIds.has(id))).map((testCase) => testCase.id));
    const evaluableRunIds = new Set(args.runs.filter((run) => judgeCaseIds.has(run.testCaseId) && run.verificationStatus !== "unverified" && run.verificationStatus !== "failed").map((run) => run.testCaseId));
    const reviewAllocation = evaluatorReviewAllocation(args.context, Math.max(1, evaluableRunIds.size));
    const reviewRuns = args.runs.filter((run) => evaluableRunIds.has(run.testCaseId)).map((r) => {
      const testCase = args.testCases.find((item) => item.id === r.testCaseId);
      const mapped = (testCase?.criterionIds ?? []).flatMap((id) => { const criterion = rubricMap.get(id); return criterion ? [`${criterion.title} ${criterion.requirement} ${criterion.evidenceExpected.join(" ")}`] : []; });
      const query = `${testCase?.title ?? ""} ${testCase?.input ?? ""} ${(testCase?.expected ?? []).join(" ")} ${mapped.join(" ")}`;
      const review = reviewOutput(r.output, query, reviewAllocation.perRun);
      if (review.truncated) warnings.push(`评审留痕：${r.testCaseId} 输出共 ${review.originalLength} 字符，已从全文检索 ${review.reviewedLength} 字符相关片段评审，而非只看开头`);
      return { testCaseId: r.testCaseId, verificationStatus: r.verificationStatus, outputChunks: review.excerpts, outputMeta: { originalLength: review.originalLength, reviewedLength: review.reviewedLength, truncated: review.truncated }, trace: (r.trace ?? []).slice(0, 12).map((step) => ({ stage: step.stage, status: step.status, summary: step.summary })) };
    });
    const unverifiedRuns = args.runs.filter((run) => run.verificationStatus === "unverified" || run.verificationStatus === "failed");
    if (unverifiedRuns.length) warnings.push(`证据留痕：${unverifiedRuns.length}/${args.runs.length} 个测试当前未获得真实证据，不计为产品失败；对应 Hard Gate 会保持未验证状态`);
    const evaluationPayload = {
      ...compactEvaluationContext(args.context, evaluatorRubric),
      acceptanceRubric: evaluatorRubric,
      evaluatorInstruction: "Never cite diagnosis, sourceUnderstanding.currentStateSummary, patches, plans or candidate claims as evidence of current output. Test inputs describe tasks, not observed facts. Missing content in retrieved excerpts does not prove absence from the full artifact. PRIMARY OBJECTIVE: score the project-specific Acceptance Rubric from the supplied VERIFIED/PARTIAL evidence only. Generic accuracy/evidence/risk/completeness are secondary diagnostics. Do not treat a parser/runtime capability gap as a product defect. Test cases omitted from this request were UNVERIFIED and must not be invented or scored as failure. PARTIAL evidence can support a tentative score but cannot satisfy a hard gate by itself. For each criterion, cite mapped testCaseIds and concrete evidence/gaps. Hard-gate requirements may not be hidden by a high average.",
      evidenceBudget: { ...reviewAllocation, suppliedRuns: reviewRuns.length, note: "共享预算按题分配；片段来自各题相关性检索，未提供部分不可据此判为失败。" },
      testCases: args.testCases.filter((testCase) => evaluableRunIds.has(testCase.id)).map((testCase) => ({ id: testCase.id, title: testCase.title, input: testCase.input.slice(0, 1600), expected: testCase.expected, tags: testCase.tags, criterionIds: testCase.criterionIds, executionMode: testCase.executionMode, evidenceScope: testCase.evidenceScope })),
      runs: reviewRuns,
    };
    let ai = EvaluateAiResultSchema.parse(await runEvolveAi("evaluate", evaluationPayload, undefined, onAttemptNotice, { forceRefresh: args.forceRefresh, requireLive: args.forceRefresh }));
    // Settle what the first response already proves before asking for a supplement. A valid per-case
    // score can settle its mapped semantic criterion even if the model omitted the redundant criteria[]
    // row; deterministic format criteria have already been removed from evaluatorRubric altogether.
    const preliminaryKnownIds = new Set(evaluationPayload.testCases.map((testCase) => testCase.id));
    const preliminaryCaseScores = (ai.cases ?? []).filter((item) => preliminaryKnownIds.has(item.testCaseId)).map((item) => ({
      testCaseId: item.testCaseId,
      accuracy: normalizeScore(item.accuracy),
      evidence: normalizeScore(item.evidence),
      completeness: normalizeScore(item.completeness),
      reason: item.reason.slice(0, 200),
    }));
    const preliminaryRubric = deriveCriterionScores(rubric, args.testCases, preliminaryCaseScores, args.runs, ai.criteria);
    const unresolved = new Set(preliminaryRubric.unverifiedCriterionIds);
    const missingJudgements = evaluatorRubric.filter((criterion) => unresolved.has(criterion.id)
      && args.testCases.some((testCase) => testCase.criterionIds.includes(criterion.id) && evaluableRunIds.has(testCase.id)));
    if (missingJudgements.length) {
      // One compact supplement is cheaper than repeating the full holdout and prevents models
      // that omit optional detail from silently manufacturing verified zero-score failures.
      const missingIds = new Set(missingJudgements.map((criterion) => criterion.id));
      const recoveryCases = evaluationPayload.testCases.filter((testCase) => testCase.criterionIds.some((id) => missingIds.has(id)));
      const recoveryCaseIds = new Set(recoveryCases.map((testCase) => testCase.id));
      try {
        const supplementPayload = {
          ...compactEvaluationContext(args.context, missingJudgements),
          acceptanceRubric: missingJudgements,
          evaluatorInstruction: "RUBRIC SUPPLEMENT ONLY: return one criteria entry for EVERY supplied acceptance criterion using the EXACT criterionId. Judge only the supplied current-artifact runs; never cite diagnosis, patches or task assumptions. The cases array may be empty because this recovery call exists only to settle missing criterion rows. Missing evidence belongs in gaps rather than a fabricated failure.",
          recovery: { reason: "missing-rubric-judgements", criterionIds: [...missingIds] },
          testCases: recoveryCases,
          runs: reviewRuns.filter((run) => recoveryCaseIds.has(run.testCaseId)),
        };
        const supplement = EvaluateAiResultSchema.parse(await runEvolveAi("evaluate", supplementPayload, undefined, onAttemptNotice, {
          forceRefresh: args.forceRefresh,
          requireLive: args.forceRefresh,
          validateResult: (value) => {
            const parsed = EvaluateAiResultSchema.parse(value);
            const returned = new Set(parsed.criteria.map((item) => item.criterionId));
            const absent = [...missingIds].filter((id) => !returned.has(id));
            const historical = parsed.criteria.filter((item) => missingIds.has(item.criterionId) && [...item.evidence, ...item.gaps].some(citesHistoricalEvidence)).map((item) => item.criterionId);
            if (absent.length || historical.length) throw new Error(`Evaluator omitted/invalid required criterion rows: ${[...new Set([...absent, ...historical])].join(", ")}`);
          },
        }));
        const mergeBy = <T,>(prior: T[] | undefined, next: T[] | undefined, key: (item: T) => string) => {
          const map = new Map((prior ?? []).map((item) => [key(item), item]));
          for (const item of next ?? []) map.set(key(item), item);
          return [...map.values()];
        };
        ai = {
          ...ai,
          cases: mergeBy(ai.cases, supplement.cases, (item) => item.testCaseId),
          criteria: mergeBy(ai.criteria, supplement.criteria, (item) => item.criterionId),
        };
        warnings.push(`评审留痕：首次评审漏返 ${missingJudgements.length} 条 Rubric 判定，已完成一次轻量补评`);
      } catch (error) {
        warnings.push(`评审留痕：${missingJudgements.length} 条 Rubric 判定缺失，轻量补评仍未完成（${error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100)}）；这些项目保持未验证，不按 0 分失败处理`);
      }
    }
    if ([ai.accuracy, ai.evidence, ai.riskCoverage, ai.completeness].some((score) => score > 0 && score <= 1)) {
      warnings.push(`评审留痕：评阅模型返回了 0-1 小数比例，已自动换算为 0-100 百分制`);
    }
    // 逐题分数与总分同一套归一化规则；模型漏交 cases 时不报废整轮评审，归因视图自动降级。
    const knownIds = new Set(args.testCases.filter((testCase) => evaluableRunIds.has(testCase.id)).map((testCase) => testCase.id));
    const caseScores = (ai.cases ?? [])
      .filter((item) => knownIds.has(item.testCaseId))
      .map((item) => ({
        testCaseId: item.testCaseId,
        accuracy: normalizeScore(item.accuracy),
        evidence: normalizeScore(item.evidence),
        completeness: normalizeScore(item.completeness),
        reason: item.reason.slice(0, 200),
      }));
    if (!caseScores.length) warnings.push(`评审留痕：评阅模型未返回逐题分数，本轮差距归因只能定位到执行失败题`);
    const rubricResult = deriveCriterionScores(rubric, args.testCases, caseScores, args.runs, ai.criteria);
    if (rubric.length && rubricResult.criterionScores.some((item) => item.testCaseIds.length === 0)) warnings.push(`评审留痕：部分 Acceptance Criterion 没有对应测试题，Rubric Coverage 不完整`);
    core = {
      accuracy: normalizeScore(ai.accuracy), evidence: normalizeScore(ai.evidence), riskCoverage: normalizeScore(ai.riskCoverage), completeness: normalizeScore(ai.completeness), safety: ai.safety, notes: ai.notes, failures: ai.failures, caseScores,
      rubricScore: rubricResult.rubricScore, verifiedRubricCoverage: rubricResult.verifiedRubricCoverage, unverifiedCriterionIds: rubricResult.unverifiedCriterionIds, criterionScores: rubricResult.criterionScores,
    };
  } else {
    core = { ...demoScore(args.runs), demoJudged: true };
    warnings.push("评审留痕：真实评阅连接本轮失败，使用演示启发式评分；该分数只作参考，不能作为夺冠或发布依据");
  }

  if (!core.criterionScores?.length) {
    const rubric = rubricFromContext(args.context);
    const caseScores = core.caseScores ?? [];
    const rubricResult = deriveCriterionScores(rubric, args.testCases, caseScores, args.runs);
    core = { ...core, rubricScore: rubricResult.rubricScore, verifiedRubricCoverage: rubricResult.verifiedRubricCoverage, unverifiedCriterionIds: rubricResult.unverifiedCriterionIds, criterionScores: rubricResult.criterionScores };
  }

  // 失败题没有真实成本/耗时；均值只按成功执行的题计算，避免成本与延迟被虚报偏低。
  const executed = args.runs.filter((run) => !run.error);
  const costSource = executed.length ? executed : args.runs;
  return {
    ...core,
    notes: warnings.length ? [...warnings, ...core.notes] : core.notes,
    averageCost: Number(average(costSource.map((run) => run.cost)).toFixed(4)),
    averageLatencyMs: Math.round(average(costSource.map((run) => run.latencyMs))),
  };
}
