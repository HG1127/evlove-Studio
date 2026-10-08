import type { EvolveProject } from "../schemas";

type Baseline = EvolveProject["baselineRun"];
type Input = {
  project: Record<string, unknown>;
  baseline?: Baseline;
  previousRounds?: EvolveProject["roundHistory"];
  archive?: EvolveProject["evolutionArchive"];
};

type Budget = { sourceChars: number; sourceCount: number; runCount: number; runOutputChars: number; historyCount: number };

const BUDGET_TIERS: Budget[] = [
  { sourceChars: 8000, sourceCount: 4, runCount: 8, runOutputChars: 500, historyCount: 4 },
  { sourceChars: 4800, sourceCount: 3, runCount: 5, runOutputChars: 300, historyCount: 2 },
  { sourceChars: 2400, sourceCount: 2, runCount: 3, runOutputChars: 180, historyCount: 1 },
];

function excerpt(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : "";
  if (text.length <= limit) return text;
  const head = Math.ceil((limit - 24) * 0.65);
  return `${text.slice(0, head)}\n[中间内容省略]\n${text.slice(-(limit - head - 12))}`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compactBaseline(baseline: Baseline | undefined, budget: Budget) {
  if (!baseline) return undefined;
  const runs = [...baseline.runs].sort((a, b) => {
    const priority = (run: Baseline["runs"][number]) => Number(run.verificationStatus !== "verified" || Boolean(run.error) || run.trace.some((item) => item.status === "fail"));
    return priority(b) - priority(a);
  });
  const selected = runs.slice(0, budget.runCount);
  const result = baseline.result;
  return {
    id: baseline.id, status: baseline.status, suiteName: baseline.suiteName, totalCases: baseline.totalCases,
    result: result ? {
      accuracy: result.accuracy, evidence: result.evidence, riskCoverage: result.riskCoverage,
      safety: result.safety, completeness: result.completeness, rubricScore: result.rubricScore,
      averageCost: result.averageCost, averageLatencyMs: result.averageLatencyMs,
      verifiedRubricCoverage: result.verifiedRubricCoverage, demoJudged: result.demoJudged,
      unverifiedCriterionIds: result.unverifiedCriterionIds?.slice(0, 12),
      failures: result.failures.slice(0, 10).map((item) => excerpt(item, 260)),
      notes: result.notes.slice(0, 6).map((item) => excerpt(item, 180)),
      criterionScores: result.criterionScores?.slice(0, 12).map((item) => ({
        criterionId: item.criterionId, score: item.score, pass: item.pass, verificationStatus: item.verificationStatus,
        gaps: item.gaps.slice(0, 2).map((gap) => excerpt(gap, 180)),
        evidence: item.evidence.slice(0, 2).map((evidence) => excerpt(evidence, 180)),
        testCaseIds: item.testCaseIds.slice(0, 4),
      })),
      caseScores: result.caseScores?.slice(0, 12).map((item) => ({
        testCaseId: item.testCaseId, accuracy: item.accuracy, evidence: item.evidence,
        completeness: item.completeness, reason: excerpt(item.reason, 160),
      })),
    } : undefined,
    runs: selected.map((run) => ({
      testCaseId: run.testCaseId, artifactHash: run.artifactHash, verificationStatus: run.verificationStatus,
      output: excerpt(run.output, budget.runOutputChars), error: excerpt(run.error, 180),
      trace: run.trace.slice(0, 2).map((item) => ({ stage: item.stage, status: item.status,
        summary: excerpt(item.summary, 140), detail: excerpt(item.detail, 140) })),
      screenshotCount: run.screenshots?.length ?? 0,
      visualEvidenceRefs: run.visualEvidenceRefs?.slice(0, 2).map((item) => ({ name: item.name, artifactHash: item.artifactHash })),
    })),
    contextCoverage: {
      totalRuns: baseline.runs.length, selectedRuns: selected.length,
      omittedScreenshotBytes: true,
      limitation: "仅传递失败优先的运行摘要和截图引用；未选中的题、截图像素及截断内容不能作为缺陷或通过证据。",
    },
  };
}

function compactProject(value: Record<string, unknown>, budget: Budget) {
  const sourceArtifacts = list(value.sourceArtifacts).map(record);
  const ranked = [...sourceArtifacts.filter((source) => source.role === "target"), ...sourceArtifacts.filter((source) => source.role !== "target")];
  const selected = ranked.slice(0, budget.sourceCount);
  let remaining = budget.sourceChars;
  const sources = selected.map((source, index) => {
    const allowance = Math.floor(remaining / (selected.length - index));
    const textContent = excerpt(source.textContent, allowance);
    remaining -= textContent.length;
    const descriptor = record(source.artifactDescriptor);
    return {
      id: source.id, name: source.name, role: source.role, artifactKind: source.artifactKind,
      parseStatus: source.parseStatus, originalChars: source.originalChars,
      coverage: source.coverage, structure: list(source.structure).slice(0, 18).map((item) => excerpt(item, 100)),
      textContent,
      artifactDescriptor: { adapterId: descriptor.adapterId, family: descriptor.family,
        subtype: descriptor.subtype, preservationMode: descriptor.preservationMode,
        limitations: list(descriptor.limitations).slice(0, 3).map((item) => excerpt(item, 120)) },
    };
  });
  const understanding = record(value.sourceUnderstanding);
  const inputUnderstanding = record(value.inputUnderstanding);
  return {
    aiProfile: value.aiProfile,
    goal: excerpt(value.goal, 1000), evolutionCommand: excerpt(value.evolutionCommand, 1200),
    protectedItems: list(value.protectedItems).slice(0, 10).map((item) => excerpt(item, 160)),
    editableItems: list(value.editableItems).slice(0, 10).map((item) => excerpt(item, 160)),
    metrics: list(value.metrics).slice(0, 12).map((item) => { const metric = record(item); return {
      key: metric.key, label: excerpt(metric.label, 80), value: metric.value, target: metric.target, unit: metric.unit,
    }; }),
    sourceUnderstanding: {
      currentStateSummary: excerpt(understanding.currentStateSummary, 500),
      evolutionIntent: excerpt(understanding.evolutionIntent, 400),
      acceptanceCriteria: list(understanding.acceptanceCriteria).slice(0, 8).map((item) => excerpt(item, 160)),
    },
    inputUnderstanding: { intentRestatement: excerpt(inputUnderstanding.intentRestatement, 400),
      acceptanceFocus: list(inputUnderstanding.acceptanceFocus).slice(0, 6).map((item) => excerpt(item, 140)) },
    searchBaseVersion: value.searchBaseVersion,
    sourceArtifacts: sources,
    contextCoverage: { totalArtifacts: record(value.contextCoverage).totalArtifacts ?? sourceArtifacts.length,
      selectedArtifacts: sources.length, sourceChars: budget.sourceChars,
      limitation: "仅传递相关原文摘录；未传递完整结构化文件或未选中的成果，不能据此推断内容缺失。" },
  };
}

/** Bound the entire problem-discovery request, not just the source-file excerpt. */
export function compactProblemAnalysisInput(input: Input, maxChars = 24_000) {
  const baseline = input.baseline ?? input.project.baselineRun as Baseline | undefined;
  for (const budget of BUDGET_TIERS) {
    const payload = {
      project: compactProject(input.project, budget),
      baseline: compactBaseline(baseline, budget),
      previousRounds: input.previousRounds?.slice(-budget.historyCount).map((round) => ({
        round: round.round, status: round.status, selectedProblemTitle: excerpt(round.selectedProblemTitle, 100),
        championChanged: round.championChanged, summary: excerpt(round.summary, 300),
      })),
      archive: input.archive?.slice(-budget.historyCount).map((entry) => ({
        round: entry.round, kind: entry.kind, niche: excerpt(entry.niche, 100), score: entry.score,
        candidateTitle: excerpt(entry.candidate.title || entry.candidate.name, 120),
        change: excerpt(entry.candidate.change, 250), reason: excerpt(entry.reason, 200),
      })),
    };
    if (JSON.stringify(payload).length <= maxChars) return payload;
  }
  throw new Error("问题分析的证据摘要仍超过输入预算；请缩短任务说明或拆分材料，系统不会将超限请求反复发送给模型。");
}
/** Diagnosis needs the selected problem, but must not resend the full Source and Baseline. */
export function compactDiagnosisInput(input: Input & { problem: EvolveProject["problems"][number] }, maxChars = 16_000) {
  const problem = {
    id: input.problem.id,
    title: excerpt(input.problem.title, 180),
    summary: excerpt(input.problem.summary, 500),
    impact: input.problem.impact,
    severity: input.problem.severity,
    confidence: input.problem.confidence,
    affectedComponent: input.problem.affectedComponent,
    evidence: input.problem.evidence.slice(0, 8).map((item) => excerpt(item, 240)),
    evidenceRefs: input.problem.evidenceRefs.slice(0, 8).map((ref) => ({
      id: ref.id, kind: ref.kind, verified: ref.verified, artifactId: ref.artifactId,
      path: ref.path, testCaseId: ref.testCaseId, traceId: ref.traceId,
      excerpt: excerpt(ref.excerpt, 180),
    })),
  };
  const problemChars = JSON.stringify({ problem }).length;
  const evidence = compactProblemAnalysisInput(input, maxChars - problemChars);
  const payload = { ...evidence, problem };
  if (JSON.stringify(payload).length > maxChars) throw new Error("根因诊断输入超过证据预算");
  return payload;
}
