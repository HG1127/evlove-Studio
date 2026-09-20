// 同卷差距归因：把「候选 vs 当前版本的总分差」拆回维度与题目层。
// 用户看到「准确 84% vs 88%（容差 3 分）」只知道差 4 分，不知道为什么差——
// 本模块用逐题分数 + 执行失败配对，找出主因贡献题与集中失分的维度，让结论可对症下药。
import type { EvaluationResult, EvolveProject, ExperimentRun, TargetRunResult, TestCase } from "@evolution/contracts";

/** AI 评阅本身有噪声：小于该分差的总分波动视为噪声而非回归。验证判卷与归因视图共用。 */
export const REGRESSION_TOLERANCE = 3;

export type GapDimension = {
  key: "accuracy" | "completeness";
  label: string;
  candidate: number;
  baseline: number;
  /** baseline - candidate；正数 = 候选落后。 */
  diff: number;
  exceeded: boolean;
};

export type GapCase = {
  testCaseId: string;
  title: string;
  candidateAccuracy?: number;
  baselineAccuracy?: number;
  candidateCompleteness?: number;
  baselineCompleteness?: number;
  candidateOverall?: number;
  baselineOverall?: number;
  /** candidateOverall - baselineOverall；负数 = 候选落后。 */
  delta?: number;
  candidateFailed: boolean;
  baselineFailed: boolean;
  candidateError?: string;
  baselineError?: string;
  /** 候选版该题失分的具体原因（来自逐题评审）。 */
  reason?: string;
};

export type GapAnalysis = {
  tolerance: number;
  dimensions: GapDimension[];
  hasPerCase: boolean;
  cases: GapCase[];
  /** 主因贡献题：落后超过容差、或候选单侧执行失败的题目，按落后程度排序。 */
  drivers: GapCase[];
  summary: string;
};

export function computeGapAnalysis(args: {
  candidate?: EvaluationResult;
  baseline?: EvaluationResult;
  candidateRuns: TargetRunResult[];
  baselineRuns: TargetRunResult[];
  testCases: TestCase[];
  tolerance?: number;
  /** 匿名化：文本中不出现题目标题/原因（隐藏卷归因喂给下一轮 plan 时必须开启，防过拟合）。 */
  anonymize?: boolean;
}): GapAnalysis {
  const tolerance = args.tolerance ?? REGRESSION_TOLERANCE;
  const { candidate, baseline } = args;
  const dimensions: GapDimension[] = candidate && baseline
    ? [
        { key: "accuracy", label: "准确率", candidate: candidate.accuracy, baseline: baseline.accuracy, diff: baseline.accuracy - candidate.accuracy, exceeded: candidate.accuracy < baseline.accuracy - tolerance },
        { key: "completeness", label: "完成度", candidate: candidate.completeness, baseline: baseline.completeness, diff: baseline.completeness - candidate.completeness, exceeded: candidate.completeness < baseline.completeness - tolerance },
      ]
    : [];

  const titleOf = new Map(args.testCases.map((testCase) => [testCase.id, testCase.title]));
  const errorsOf = (runs: TargetRunResult[]) => new Map(runs.filter((run) => run.error).map((run) => [run.testCaseId, run.error!]));
  const candidateErrors = errorsOf(args.candidateRuns);
  const baselineErrors = errorsOf(args.baselineRuns);
  const candidateScores = new Map((candidate?.caseScores ?? []).map((item) => [item.testCaseId, item]));
  const baselineScores = new Map((baseline?.caseScores ?? []).map((item) => [item.testCaseId, item]));
  const hasPerCase = candidateScores.size > 0 || baselineScores.size > 0;

  const ids = [...new Set([
    ...args.testCases.map((testCase) => testCase.id),
    ...args.candidateRuns.map((run) => run.testCaseId),
    ...args.baselineRuns.map((run) => run.testCaseId),
  ])];
  const overallOf = (score?: { accuracy: number; completeness: number }) => (score ? Math.round((score.accuracy + score.completeness) / 2) : undefined);

  const cases: GapCase[] = ids.map((testCaseId) => {
    const candidateScore = candidateScores.get(testCaseId);
    const baselineScore = baselineScores.get(testCaseId);
    const candidateFailed = candidateErrors.has(testCaseId);
    const baselineFailed = baselineErrors.has(testCaseId);
    const candidateOverall = overallOf(candidateScore);
    const baselineOverall = overallOf(baselineScore);
    return {
      testCaseId,
      title: titleOf.get(testCaseId) ?? testCaseId,
      candidateAccuracy: candidateScore?.accuracy,
      baselineAccuracy: baselineScore?.accuracy,
      candidateCompleteness: candidateScore?.completeness,
      baselineCompleteness: baselineScore?.completeness,
      candidateOverall,
      baselineOverall,
      delta: candidateOverall !== undefined && baselineOverall !== undefined ? candidateOverall - baselineOverall : undefined,
      candidateFailed,
      baselineFailed,
      candidateError: candidateErrors.get(testCaseId),
      baselineError: baselineErrors.get(testCaseId),
      reason: candidateScore?.reason || undefined,
    };
  });

  const drivers = cases
    .filter((item) => (item.delta !== undefined && item.delta <= -tolerance) || (item.candidateFailed && !item.baselineFailed) || (item.delta === undefined && (item.candidateFailed || item.baselineFailed)))
    .sort((a, b) => (a.delta ?? -101) - (b.delta ?? -101));

  const parts: string[] = [];
  const exceededDimensions = dimensions.filter((dimension) => dimension.exceeded);
  if (exceededDimensions.length) parts.push(`超出容差的维度：${exceededDimensions.map((dimension) => `${dimension.label}落后 ${Math.round(dimension.diff)} 分`).join("、")}（容差 ${tolerance} 分）`);
  else if (dimensions.length) parts.push(`候选与当前版本在各维度的差距均在容差 ${tolerance} 分以内`);
  if (drivers.length) {
    const labelOf = (item: GapCase) => (args.anonymize ? `隐藏题#${cases.indexOf(item) + 1}` : `「${item.title}」`);
    parts.push(`${drivers.length} 道主因贡献题：${drivers.slice(0, 3).map((driver) => {
      if (driver.candidateFailed && !driver.baselineFailed) return `${labelOf(driver)}候选执行失败（当前版本该题正常完成）`;
      if (driver.baselineFailed && !driver.candidateFailed) return `${labelOf(driver)}当前版本该题执行失败（对比失真，实际是候选更好）`;
      if (driver.delta !== undefined) return `${labelOf(driver)}落后 ${Math.round(-driver.delta)} 分`;
      return `${labelOf(driver)}无逐题分数且存在执行失败`;
    }).join("、")}${drivers.length > 3 ? ` 等 ${drivers.length} 题` : ""}`);
  } else if (hasPerCase && exceededDimensions.length) {
    parts.push("没有单题落后超过容差，总分差来自多道题的小幅普遍回落，应对照下方逐题表找集中失分模式");
  }
  if (!hasPerCase) parts.push("本轮评审未返回逐题分数，归因只能定位到执行失败题；重跑盲测可获得完整逐题归因");
  return { tolerance, dimensions, hasPerCase, cases, drivers, summary: parts.join("；") };
}

/** 归因结论压成一行，供发布检查项 detail 直接带出主因。 */
export function gapHeadline(analysis: GapAnalysis): string {
  if (!analysis.drivers.length) return "";
  return analysis.drivers.slice(0, 3).map((driver) => {
    if (driver.candidateFailed && !driver.baselineFailed) return `「${driver.title}」候选执行失败`;
    if (driver.baselineFailed && !driver.candidateFailed) return `「${driver.title}」当前版本该题失败（对比失真）`;
    if (driver.delta !== undefined) return `「${driver.title}」落后 ${Math.round(-driver.delta)} 分`;
    return `「${driver.title}」`;
  }).join("、");
}

/** 把本轮盲测的分数、检查项与差距归因打包成 AI 建议的输入：让建议落在具体数字上，而不是泛泛而谈。 */
export function buildGapAdvicePayload(args: {
  project: EvolveProject;
  checks: Array<{ label: string; status: string; detail: string }>;
  evaluation?: EvaluationResult;
  baselineEvaluation?: EvaluationResult;
  runs: TargetRunResult[];
  baselineRuns: TargetRunResult[];
}) {
  // 隐藏卷归因会喂给下一轮 plan：只给维度与聚合统计，不给逐题标题/原因，防止候选对隐藏题过拟合。
  const analysis = computeGapAnalysis({ candidate: args.evaluation, baseline: args.baselineEvaluation, candidateRuns: args.runs, baselineRuns: args.baselineRuns, testCases: args.project.hiddenEvalSuite, anonymize: true });
  const belowTolerance = analysis.cases.filter((item) => item.delta !== undefined && item.delta <= -analysis.tolerance).length;
  const candidateFailed = analysis.cases.filter((item) => item.candidateFailed && !item.baselineFailed).length;
  const slimEval = (evaluation?: EvaluationResult) => evaluation
    ? { accuracy: evaluation.accuracy, evidence: evaluation.evidence, riskCoverage: evaluation.riskCoverage, completeness: evaluation.completeness, averageCost: evaluation.averageCost, failures: evaluation.failures }
    : undefined;
  return {
    projectName: args.project.name,
    objectType: args.project.objectType,
    goal: args.project.goal,
    evolutionCommand: args.project.evolutionCommand,
    checks: args.checks,
    holdout: slimEval(args.evaluation),
    baselineHoldout: slimEval(args.baselineEvaluation),
    gap: {
      dimensions: analysis.dimensions.map((dimension) => ({ label: dimension.label, candidate: dimension.candidate, baseline: dimension.baseline, diff: Math.round(dimension.diff), exceeded: dimension.exceeded })),
      hasPerCase: analysis.hasPerCase,
      summary: analysis.summary,
      worstCaseStats: { belowToleranceCount: belowTolerance, candidateFailedCount: candidateFailed, totalCases: analysis.cases.length },
    },
    experimentHistory: {
      failedExperimentCases: args.project.experimentRun.candidateResults.flatMap((result) => result.runs).filter((run) => run.error).length,
      experimentSummary: args.project.experimentRun.summary,
    },
  };
}

function experimentResultScore(result: ExperimentRun["candidateResults"][number]) {
  const evaluation = result.evaluation;
  const quality = evaluation.rubricScore ?? (evaluation.accuracy + evaluation.completeness) / 2;
  return quality - (evaluation.safety === "FAIL" ? 100 : 0) - (result.experimentStage === "screened" ? 20 : 0);
}

/** Select the closest challenger so no-Winner advice is grounded in the most promising artifact. */
export function closestExperimentResult(experiment: ExperimentRun) {
  return [...experiment.candidateResults].sort((a, b) => experimentResultScore(b) - experimentResultScore(a))[0];
}

/** Visible-experiment counterpart of buildGapAdvicePayload. It may cite visible case names. */
export function buildExperimentGapAdvicePayload(project: EvolveProject, experiment: ExperimentRun) {
  const closest = closestExperimentResult(experiment);
  const analysis = computeGapAnalysis({
    candidate: closest?.evaluation,
    baseline: project.baselineRun.result,
    candidateRuns: closest?.runs ?? [],
    baselineRuns: project.baselineRun.runs,
    testCases: project.evalSuite,
  });
  const failedRuns = closest?.runs.filter((run) => run.error) ?? [];
  // “没有真实证据”与“有证据且产品失败”必须分开。旧逻辑把 unverified 的
  // score=0 也塞进 failedCriteria，建议模型便会误判成 7 个产品缺陷。
  const failedCriteria = closest?.evaluation.criterionScores?.filter((item) => item.verificationStatus === "verified" && !item.pass) ?? [];
  const unverifiedCriteria = closest?.evaluation.criterionScores?.filter((item) => item.verificationStatus !== "verified") ?? [];
  return {
    phase: "visible-experiment-no-winner",
    projectName: project.name,
    objectType: project.objectType,
    goal: project.goal,
    evolutionCommand: project.evolutionCommand,
    experimentSummary: experiment.summary,
    closestCandidate: closest ? {
      candidateId: closest.candidateId,
      experimentStage: closest.experimentStage,
      evaluation: {
        accuracy: closest.evaluation.accuracy,
        evidence: closest.evaluation.evidence,
        riskCoverage: closest.evaluation.riskCoverage,
        completeness: closest.evaluation.completeness,
        rubricScore: closest.evaluation.rubricScore,
        safety: closest.evaluation.safety,
        failures: closest.evaluation.failures,
      },
    } : undefined,
    baseline: project.baselineRun.result ? {
      accuracy: project.baselineRun.result.accuracy,
      evidence: project.baselineRun.result.evidence,
      riskCoverage: project.baselineRun.result.riskCoverage,
      completeness: project.baselineRun.result.completeness,
      rubricScore: project.baselineRun.result.rubricScore,
      safety: project.baselineRun.result.safety,
    } : undefined,
    gap: analysis,
    failedRuns: failedRuns.map((run) => ({ testCaseId: run.testCaseId, error: run.error })),
    failedCriteria: failedCriteria.map((item) => ({ criterionId: item.criterionId, score: item.score, gaps: item.gaps })),
    unverifiedCriteria: unverifiedCriteria.map((item) => ({ criterionId: item.criterionId, verificationStatus: item.verificationStatus, gaps: item.gaps })),
    instruction: "解释最接近 Winner 的候选为什么仍失败，并给出按影响排序、可直接用于下一轮 Candidate 的 2-4 条修改动作。failedCriteria 才是已有真实证据的产品失败；unverifiedCriteria 是待补证据，严禁按 0 分产品失败描述。每条动作必须对应一个分数差距、失败题、Hard Gate、执行错误或证据缺口。",
  };
}

/** Always provide actionable next steps even when the advisor model is unavailable. */
export function fallbackExperimentAdvice(project: EvolveProject, experiment: ExperimentRun) {
  const closest = closestExperimentResult(experiment);
  if (experimentNeedsEvidenceRepair(experiment)) return {
    overall: "当前阻塞来自验收证据未完成，尚无已验证的标准失败。保留候选文件，先补齐同卷测试和评审。",
    actions: [{ title: "补齐同卷证据并重新比较", target: "Eval / Runner", detail: "自动补齐实验卷中缺失的标准，复用已有原版作答并补跑缺失题，再对原版和当前候选按同一标准评审。外部运行、视觉或人工证据仍需对应能力；不把这些缺口写成改文案或 CSS 的指令。" }],
  };
  const analysis = computeGapAnalysis({ candidate: closest?.evaluation, baseline: project.baselineRun.result, candidateRuns: closest?.runs ?? [], baselineRuns: project.baselineRun.runs, testCases: project.evalSuite });
  const actions: Array<{ title: string; detail: string; target: string }> = [];
  const failedRuns = closest?.runs.filter((run) => run.error) ?? [];
  const criterionById = new Map(project.acceptanceRubric.map((criterion) => [criterion.id, criterion]));
  const unverifiedHard = closest?.evaluation.criterionScores?.filter((item) => item.verificationStatus !== "verified" && criterionById.get(item.criterionId)?.hardGate) ?? [];
  if (closest?.evaluation.safety === "FAIL") actions.push({ title: "先消除安全门槛失败", target: "Safety / Hard Gate", detail: `候选触发 Safety FAIL。下一版先针对 ${closest.evaluation.failures.slice(0, 2).join("；") || "安全检查项"} 做最小修复，并增加对应回归检查，未通过前不扩大改动范围。` });
  if (failedRuns.length) actions.push({ title: "修复未完成的实验题", target: "Workflow / Runtime", detail: `${failedRuns.length} 道题未完成执行：${failedRuns.slice(0, 2).map((run) => run.error || run.testCaseId).join("；")}。先修复运行或输出格式，再复用已成功题只补考失败项。` });
  if (unverifiedHard.length) actions.push({ title: "补齐 Hard Gate 的真实证据", target: "Eval / Runner", detail: `${unverifiedHard.map((item) => criterionById.get(item.criterionId)?.title ?? item.criterionId).slice(0, 3).join("、")} 当前是待验证，不是产品 0 分。先增加匹配其 validationMethod 的测试或连接 Runner / 视觉 / 人工证据，再重评这些标准；不要为证据能力缺失反复改成果。` });
  if (analysis.drivers.length) actions.push({ title: "优先补强最大失分点", target: "Candidate", detail: `${gapHeadline(analysis)}。下一版只围绕这些主因题对应的能力调整，保留当前候选已领先或持平的部分。` });
  const exceeded = analysis.dimensions.filter((item) => item.exceeded);
  if (exceeded.length) actions.push({ title: "追回超过容差的指标", target: "Eval targets", detail: `${exceeded.map((item) => `${item.label}落后 ${Math.round(item.diff)} 分`).join("、")}。将这些指标设为下一轮首要验收目标，至少追回到 ${analysis.tolerance} 分容差以内。` });
  if (!actions.length) actions.push({ title: "缩小改动并建立可证伪假设", target: "Plan", detail: "当前差距没有集中到单一题目。下一轮拆成更小的局部改动，每个 Candidate 只验证一个机制，并明确保持项和失败即回退条件。" });
  return {
    overall: `最接近的候选 ${closest?.candidateId ?? "尚未识别"} 仍未同时满足优于基线、完整执行和安全门槛。${analysis.summary || experiment.summary || "需要收敛改动范围后再验证。"}`,
    actions: actions.slice(0, 4),
  };
}

/** An evidence outage is repaired by testing the saved artifact, not generating a new one. */
export function experimentNeedsEvidenceRepair(experiment: ExperimentRun) {
  const results = experiment.candidateResults.filter((item) => item.experimentStage !== "screened");
  return !experiment.winnerId && results.length > 0 && results.every(({ evaluation }) =>
    evaluation.safety !== "FAIL" && (evaluation.criterionScores ?? []).some((item) => item.verificationStatus !== "verified")
    && !(evaluation.criterionScores ?? []).some((item) => item.verificationStatus === "verified" && !item.pass));
}
