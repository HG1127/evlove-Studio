import type { EvolveProject } from "@evolution/contracts";

/** Baseline is usable for diagnosis only when real, sufficiently complete evidence exists. */
export function baselineReadiness(project: EvolveProject) {
  const baseline = project.baselineRun;
  const supportedModes = project.targetConnection.adapter === "http"
    ? new Set(project.evalSuite.map((testCase) => testCase.executionMode))
    : new Set(["artifact-runtime", "static-evidence", "roundtrip"]);
  const comparisonOnly = new Set(project.acceptanceRubric.filter((criterion) => criterion.id === "SYS-PAIRWISE").map((criterion) => criterion.id));
  const requiredCases = project.evalSuite.filter((testCase) => supportedModes.has(testCase.executionMode)
    && !(testCase.criterionIds.length > 0 && testCase.criterionIds.every((id) => comparisonOnly.has(id))));
  const requiredIds = new Set(requiredCases.map((testCase) => testCase.id));
  const runs = baseline.runs;
  const requiredRuns = runs.filter((run) => requiredIds.has(run.testCaseId));
  const planned = requiredCases.length;
  const failed = requiredRuns.filter((run) => run.error || run.verificationStatus === "failed").length;
  const verified = requiredRuns.filter((run) => run.verificationStatus === "verified").length;
  const partial = requiredRuns.filter((run) => run.verificationStatus === "partial").length;
  const unverified = runs.filter((run) => run.verificationStatus === "unverified").length;
  const executedCoverage = planned ? Math.round(requiredRuns.length / planned * 100) : 0;
  const evidenceCoverage = planned ? Math.round((verified + partial * 0.5) / planned * 100) : 0;
  const blockers: string[] = [];

  if (baseline.status !== "completed" || !baseline.result) blockers.push("当前版本体检尚未完成");
  if (!planned) blockers.push("尚未生成项目专属验收题");
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
  return retry && project.baselineRun.measurementFingerprint === fingerprint
    ? project.baselineRun.runs.filter((run) => !run.error
      && run.verificationStatus === "verified"
      && project.evalSuite.some((testCase) => testCase.id === run.testCaseId
        && testCase.criterionIds.every((id) => project.baselineRun.result?.criterionScores?.some((score) => score.criterionId === id && score.verificationStatus === "verified"))))
    : [];
}
