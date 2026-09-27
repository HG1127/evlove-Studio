import type { EvaluationResult, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { indexUniqueById } from "./identity-index";

/** Baseline is usable for diagnosis only when real, sufficiently complete evidence exists. */
export function baselineReadiness(project: EvolveProject) {
  const baseline = project.baselineRun;
  const supportedModes = project.targetConnection.adapter === "http"
    ? new Set(project.evalSuite.map((testCase) => testCase.executionMode))
    : new Set(["artifact-runtime", "static-evidence", "roundtrip"]);
  const comparisonOnly = new Set(project.acceptanceRubric.filter((criterion) => criterion.id === "SYS-PAIRWISE").map((criterion) => criterion.id));
  const requiredCases = project.evalSuite.filter((testCase) => supportedModes.has(testCase.executionMode)
    && !(testCase.criterionIds.length > 0 && testCase.criterionIds.every((id) => comparisonOnly.has(id))));
  const requiredCaseIndex = indexUniqueById(requiredCases, (testCase) => testCase.id);
  const runs = baseline.runs;
  const runIndex = indexUniqueById(runs, (run) => run.testCaseId);
  const requiredRuns = [...requiredCaseIndex.byId.keys()].flatMap((id) => {
    const run = runIndex.byId.get(id);
    return run ? [run] : [];
  });
  const repeatedRunIds = [...runIndex.duplicateIds].filter((id) => requiredCases.some((testCase) => testCase.id === id));
  const planned = requiredCases.length;
  const failed = requiredRuns.filter((run) => run.error || run.verificationStatus === "failed").length;
  const verified = requiredRuns.filter((run) => run.verificationStatus === "verified").length;
  const partial = requiredRuns.filter((run) => run.verificationStatus === "partial").length;
  const unverified = new Set([...runs.filter((run) => run.verificationStatus === "unverified").map((run) => run.testCaseId), ...repeatedRunIds]).size;
  const executedCoverage = planned ? Math.round(requiredRuns.length / planned * 100) : 0;
  const evidenceCoverage = planned ? Math.round((verified + partial * 0.5) / planned * 100) : 0;
  const blockers: string[] = [];

  if (baseline.status !== "completed" || !baseline.result) blockers.push("当前版本体检尚未完成");
  if (!planned) blockers.push("尚未生成项目专属验收题");
  if (requiredCaseIndex.duplicateIds.size) blockers.push(`验收题 ID 重复：${[...requiredCaseIndex.duplicateIds].join("、")}；需修正题目身份`);
  if (repeatedRunIds.length) blockers.push(`执行结果 ID 重复：${repeatedRunIds.join("、")}；需重新执行`);
  if (requiredRuns.length < planned) blockers.push(`当前 Runner 可执行题只返回 ${requiredRuns.length}/${planned} 道`);
  if (failed) blockers.push(`${failed} 道题执行失败，请先修复连接或补考`);
  if (baseline.result?.demoJudged) blockers.push("评审使用了演示兜底，不能作为问题诊断依据");
  if (planned && evidenceCoverage < 60) blockers.push(`可用证据覆盖仅 ${evidenceCoverage}%，至少需要 60%`);
  if (planned && verified === 0 && partial === 0) blockers.push("没有获得可用于诊断的执行、文件或语义证据");

  return {
    ready: blockers.length === 0,
    blockers,
    planned,
    returned: requiredRuns.length,
    deferred: Math.max(0, project.evalSuite.length - requiredCases.length),
    failed,
    verified,
    partial,
    unverified,
    executedCoverage: Math.min(100, executedCoverage),
    evidenceCoverage: Math.min(100, evidenceCoverage),
  };
}

/** Reuse only measured successes from the exact same inputs and test contract. */
export function reusableBaselineRuns(project: EvolveProject, fingerprint: string, retry: boolean) {
  if (!retry || project.baselineRun.measurementFingerprint !== fingerprint) return [];
  const cases = indexUniqueById(project.evalSuite, (testCase) => testCase.id);
  const runs = indexUniqueById(project.baselineRun.runs, (run) => run.testCaseId);
  const scores = indexUniqueById(project.baselineRun.result?.criterionScores ?? [], (score) => score.criterionId);
  return project.baselineRun.runs.filter((run) => {
    if (cases.duplicateIds.has(run.testCaseId) || runs.duplicateIds.has(run.testCaseId)) return false;
    const testCase = cases.byId.get(run.testCaseId);
    return Boolean(testCase && !run.error && run.verificationStatus === "verified"
      && testCase.criterionIds.every((id) => scores.byId.get(id)?.verificationStatus === "verified"));
  });
}
/** An incomplete holdout observation must be measured again when execution or judging recovers. */
export function reusableHoldoutBaseline(suite: TestCase[], runs: TargetRunResult[], evaluation: EvaluationResult | undefined): boolean {
  if (!evaluation || evaluation.demoJudged || runs.length !== suite.length) return false;
  const cases = indexUniqueById(suite, (testCase) => testCase.id);
  const results = indexUniqueById(runs, (run) => run.testCaseId);
  if (cases.duplicateIds.size || results.duplicateIds.size || results.byId.size !== cases.byId.size) return false;
  if ([...cases.byId.keys()].some((id) => {
    const run = results.byId.get(id);
    return !run || Boolean(run.error) || run.verificationStatus !== "verified";
  })) return false;
  const requiredCriteria = new Set(suite.flatMap((testCase) => testCase.criterionIds).filter((id) => id !== "SYS-PAIRWISE"));
  const scores = indexUniqueById(evaluation.criterionScores ?? [], (score) => score.criterionId);
  return !scores.duplicateIds.size && [...requiredCriteria].every((id) => scores.byId.get(id)?.verificationStatus === "verified");
}
