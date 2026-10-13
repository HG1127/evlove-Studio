import { serverEnv } from "../runtime/env";
import { EvaluateAiResultSchema } from "../ai/schemas";
import { SourceArtifactSchema } from "@evolution/contracts";
import { getAiProviderStatus, runEvolveAi, type AiAttemptNotice } from "../ai/service";
import type { AcceptanceCriterion, EvaluationResult, TargetRunResult, TestCase } from "../schemas";
import { retrieveTextContext } from "../runtime/context-retrieval";
import {
  citesHistoricalEvidence,
  criteriaRequiringJudge,
  deriveCriterionScores,
  normalizeEvaluationScore,
} from "@evolution/core";

export { citesHistoricalEvidence, criteriaRequiringJudge, deriveCriterionScores } from "@evolution/core";

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

function evaluationScopeFromContext(context: Record<string, unknown>) {
  const source = (context.project as { sourceArtifacts?: unknown } | undefined)?.sourceArtifacts;
  const parsed = SourceArtifactSchema.array().safeParse(source);
  return parsed.success ? { sourceArtifacts: parsed.data } : undefined;
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
      accuracy: normalizeEvaluationScore(item.accuracy),
      evidence: normalizeEvaluationScore(item.evidence),
      completeness: normalizeEvaluationScore(item.completeness),
      reason: item.reason.slice(0, 200),
    }));
    const preliminaryRubric = deriveCriterionScores(rubric, args.testCases, preliminaryCaseScores, args.runs, ai.criteria, undefined, evaluationScopeFromContext(args.context));
    const unresolved = new Set(preliminaryRubric.unverifiedCriterionIds);
    const missingJudgements = evaluatorRubric.filter((criterion) => {
      if (!unresolved.has(criterion.id)) return false;
      const mapped = args.testCases.filter((testCase) => testCase.criterionIds.includes(criterion.id));
      // A Judge response cannot turn a retrieved excerpt or missing execution into full evidence.
      // Only retry a genuinely omitted judgement over complete, verified observations.
      return mapped.length > 0 && mapped.every((testCase) => args.runs.some((run) => run.testCaseId === testCase.id && run.verificationStatus === "verified"));
    });
    if (missingJudgements.length) {
      // Keep each recovery contract small. One large supplement repeats the same output truncation
      // that caused the omission and makes one bad row poison every otherwise recoverable criterion.
      const recovered: string[] = [];
      const failed: string[] = [];
      for (let offset = 0; offset < missingJudgements.length; offset += 2) {
        const batch = missingJudgements.slice(offset, offset + 2);
        const missingIds = new Set(batch.map((criterion) => criterion.id));
        const recoveryCases = evaluationPayload.testCases.filter((testCase) => testCase.criterionIds.some((id) => missingIds.has(id)));
        const recoveryCaseIds = new Set(recoveryCases.map((testCase) => testCase.id));
        const recoveryRuns = args.runs.filter((run) => recoveryCaseIds.has(run.testCaseId));
        const recoveryBudget = Math.max(1, Math.floor(36_000 / Math.max(1, recoveryRuns.length)));
        try {
          const supplementPayload = {
            ...compactEvaluationContext(args.context, batch),
            acceptanceRubric: batch,
            evaluatorInstruction: "RUBRIC SUPPLEMENT ONLY: return one criteria entry for EVERY supplied acceptance criterion using the EXACT criterionId. Judge only the supplied current-artifact runs; never cite diagnosis, patches or task assumptions. The cases array may be empty because this recovery call exists only to settle missing criterion rows. Missing evidence belongs in gaps rather than a fabricated failure.",
            recovery: { reason: "missing-rubric-judgements", criterionIds: [...missingIds] },
            testCases: recoveryCases,
            // Re-read observed output for this focused contract. A per-request budget prevents
            // many mapped cases from multiplying the prompt while bounded observations stay whole.
            runs: recoveryRuns.map((run) => {
              const review = reviewOutput(run.output, batch.map((criterion) => `${criterion.title} ${criterion.requirement} ${criterion.evidenceExpected.join(" ")}`).join(" "), recoveryBudget);
              const prior = reviewRuns.find((item) => item.testCaseId === run.testCaseId)!;
              return { ...prior, outputChunks: review.excerpts, outputMeta: {
                originalLength: review.originalLength, reviewedLength: review.reviewedLength, truncated: review.truncated,
              } };
            }),
          };
          const supplement = EvaluateAiResultSchema.parse(await runEvolveAi("evaluate", supplementPayload, undefined, onAttemptNotice, {
            forceRefresh: true,
            requireLive: true,
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
          recovered.push(...missingIds);
        } catch (error) {
          failed.push(...missingIds);
          warnings.push(`评审留痕：${[...missingIds].join("、")} 轻量补评未完成（${error instanceof Error ? error.message.slice(0, 100) : String(error).slice(0, 100)}）；保持未验证，不按 0 分失败处理`);
        }
      }
      if (recovered.length) warnings.push(`评审留痕：已按小批次补齐 ${recovered.length} 条漏返的 Rubric 判定`);
      if (failed.length) warnings.push(`评审留痕：仍缺少 ${failed.length} 条真实评审判定，可单独重试评审，无需重新生成 Candidate`);
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
        accuracy: normalizeEvaluationScore(item.accuracy),
        evidence: normalizeEvaluationScore(item.evidence),
        completeness: normalizeEvaluationScore(item.completeness),
        reason: item.reason.slice(0, 200),
      }));
    if (!caseScores.length) warnings.push(`评审留痕：评阅模型未返回逐题分数，本轮差距归因只能定位到执行失败题`);
    const rubricResult = deriveCriterionScores(rubric, args.testCases, caseScores, args.runs, ai.criteria, undefined, evaluationScopeFromContext(args.context));
    if (rubric.length && rubricResult.criterionScores.some((item) => item.testCaseIds.length === 0)) warnings.push(`评审留痕：部分 Acceptance Criterion 没有对应测试题，Rubric Coverage 不完整`);
    core = {
      accuracy: normalizeEvaluationScore(ai.accuracy), evidence: normalizeEvaluationScore(ai.evidence), riskCoverage: normalizeEvaluationScore(ai.riskCoverage), completeness: normalizeEvaluationScore(ai.completeness), safety: ai.safety, notes: ai.notes, failures: ai.failures, caseScores,
      rubricScore: rubricResult.rubricScore, verifiedRubricCoverage: rubricResult.verifiedRubricCoverage, unverifiedCriterionIds: rubricResult.unverifiedCriterionIds, criterionScores: rubricResult.criterionScores,
    };
  } else {
    core = { ...demoScore(args.runs), demoJudged: true };
    warnings.push("评审留痕：真实评阅连接本轮失败，使用演示启发式评分；该分数只作参考，不能作为夺冠或发布依据");
  }

  if (!core.criterionScores?.length) {
    const rubric = rubricFromContext(args.context);
    const caseScores = core.caseScores ?? [];
    const rubricResult = deriveCriterionScores(rubric, args.testCases, caseScores, args.runs, undefined, undefined, evaluationScopeFromContext(args.context));
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
