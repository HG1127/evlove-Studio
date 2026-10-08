import { evidenceFingerprint } from "./evidence-binding";
import type { ArtifactAcceptance, Candidate, EvolveProject, ValidationRun } from "../schemas";
import { acceptCandidateArtifacts, ensureAcceptanceRubric, repairCandidateArtifacts } from "./artifact-quality";
import { isSimpleLocalTextProject, runFocusedRepairValidation, runValidation } from "./run-local";

import { artifactRepairNeedsRecovery } from "@evolution/harness";

/** Existing failure evidence is reusable only while the current artifact/contract is unchanged. */
export function repairValidationCheckpoint(project: EvolveProject, candidate: Candidate): ValidationRun | undefined {
  const validation = project.validationRun;
  return artifactRepairNeedsRecovery(project) && validation.status === "completed" && validation.candidateId === candidate.id
    && validation.evidenceFingerprint === evidenceFingerprint(project, candidate) ? validation : undefined;
}

export type ArtifactLoopResult = {
  candidate: Candidate;
  validation: ValidationRun;
  acceptance: ArtifactAcceptance;
  rubric: EvolveProject["acceptanceRubric"];
  repaired: boolean;
};

export function validationAfterRepair(previous: ValidationRun, candidate: Candidate): ValidationRun {
  return { id: `validation-pending-${Date.now()}`, candidateId: candidate.id, status: "idle", runs: [], baselineRuns: [], checks: [], recommendation: "hold", previousEvaluation: previous.evaluation,
    summary: "成果已修复，等待对新快照重新验收；旧评分仅作为历史对照。" };
}

/** Only evidence-backed failures may drive an automatic content repair. */
export function validationRepairCriteria(project: EvolveProject, validation: ValidationRun) {
  const scores = new Map((validation.evaluation?.criterionScores ?? []).map((item) => [item.criterionId, item]));
  return project.acceptanceRubric.filter((criterion) => {
    const score = scores.get(criterion.id);
    return score?.verificationStatus === "verified" && score.pass !== true;
  });
}

/** Repeating the same text repair three times is usually lower-value than letting the next search round change mechanism. */
export function behaviorRepairAttemptLimit(project: EvolveProject, configuredMax: number) {
  return isSimpleLocalTextProject(project) ? Math.min(configuredMax, 2) : configuredMax;
}

export async function runArtifactAcceptanceLoop(args: {
  project: EvolveProject;
  candidate: Candidate;
  validation: ValidationRun;
  onProgress?: (label: string) => void;
}): Promise<ArtifactLoopResult> {
  let project = args.project;
  let candidate = args.candidate;
  let validation = args.validation;
  const rubric = await ensureAcceptanceRubric(project);
  const maxAttempts = Math.max(0, project.artifactAcceptance.maxRepairAttempts ?? 3);
  const behaviorMaxAttempts = behaviorRepairAttemptLimit(project, maxAttempts);
  let repaired = false;
  let behaviorRepairAttempts = 0;

  const blockedAcceptance = (summary: string): ArtifactAcceptance => ({
    id: `artifact-acceptance-${Date.now()}`,
    status: validation.recommendation === "reject" || validationRepairCriteria({ ...project, acceptanceRubric: rubric }, validation).length > 0 ? "failed" : "unverified",
    candidateId: candidate.id,
    overallScore: 0,
    coverageScore: 0,
    integrityScore: 0,
    pairwiseScore: 0,
    hardGatePass: false,
    results: [],
    attempts: behaviorRepairAttempts,
    maxRepairAttempts: maxAttempts,
    summary,
    lastCheckedAt: new Date().toISOString(),
  });

  if (validation.status !== "completed") {
    return { candidate, validation, acceptance: blockedAcceptance("Hidden Validation 尚未完成，不能进入 Artifact Ready Gate。"), rubric, repaired };
  }

  project = { ...project, acceptanceRubric: rubric };
  if (validation.evidenceFingerprint !== evidenceFingerprint(project, candidate)) {
    args.onProgress?.("文件或验收条件已变化，重新验证当前成果");
    validation = validationAfterRepair(validation, candidate);
    try {
      validation = await runValidation(project, candidate, (done, total, phase) => args.onProgress?.(`${phase ?? "复验"} ${done}/${total}`));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      validation = { ...validation, status: "failed", error: reason };
      return { candidate, validation, acceptance: blockedAcceptance(`当前成果复验未完成：${reason}`), rubric, repaired };
    }
  }
  // Gate F must consume the exact Hidden Validation result for this same artifact fingerprint; this
  // also lets it reuse already-verified rubric evidence instead of asking another LLM to re-grade it.
  project = { ...project, validationRun: validation };

  // Close the behavioral loop before Gate F: repair only criteria that have verified failure
  // evidence, preserve every unverified criterion, then test the same repaired snapshot again.
  // This fixes the former dead end where Fast Gate returned hold and the workflow simply stopped.
  let failedBehaviorCriteria = validationRepairCriteria({ ...project, acceptanceRubric: rubric }, validation);
  while (validation.recommendation !== "release" && failedBehaviorCriteria.length && behaviorRepairAttempts < behaviorMaxAttempts) {
    behaviorRepairAttempts += 1;
    const scoreById = new Map((validation.evaluation?.criterionScores ?? []).map((item) => [item.criterionId, item]));
    const diagnosticAcceptance: ArtifactAcceptance = {
      id: `behavior-repair-${Date.now()}`,
      status: "failed",
      candidateId: candidate.id,
      overallScore: validation.evaluation?.rubricScore ?? 0,
      coverageScore: validation.evaluation?.verifiedRubricCoverage ?? 0,
      integrityScore: 100,
      pairwiseScore: 0,
      hardGatePass: false,
      results: failedBehaviorCriteria.map((criterion) => {
        const score = scoreById.get(criterion.id);
        return { criterionId: criterion.id, score: score?.score ?? 0, pass: false, evidence: score?.evidence ?? [], gaps: score?.gaps ?? [criterion.requirement], note: "Hidden Validation 已证实失败" };
      }),
      attempts: behaviorRepairAttempts - 1,
      maxRepairAttempts: maxAttempts,
      summary: `Hidden Validation 已证实 ${failedBehaviorCriteria.length} 个验收项失败；只修复这些失败项。`,
      lastCheckedAt: new Date().toISOString(),
    };
    args.onProgress?.(`Behavior Repair ${behaviorRepairAttempts}/${behaviorMaxAttempts} · 修复 ${failedBehaviorCriteria.length} 个已证实失败项`);
    try {
      candidate = await repairCandidateArtifacts({ ...project, acceptanceRubric: rubric }, candidate, diagnosticAcceptance, failedBehaviorCriteria);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const acceptance = blockedAcceptance(`已保留本轮 Hidden Validation 证据；自动修复第 ${behaviorRepairAttempts} 次未完成：${reason}`);
      return { candidate, validation, acceptance: { ...acceptance, error: reason, failurePhase: "repair" }, rubric, repaired };
    }
    repaired = true;
    validation = validationAfterRepair(validation, candidate);
    project = {
      ...project,
      acceptanceRubric: rubric,
      candidates: project.candidates.map((item) => item.id === candidate.id ? candidate : item),
      experimentRun: { ...project.experimentRun, winnerId: candidate.id },
    };
    try {
      const simpleText = isSimpleLocalTextProject(project);
      if (simpleText) {
        const targetIds = failedBehaviorCriteria.map((criterion) => criterion.id);
        args.onProgress?.(`Behavior Repair ${behaviorRepairAttempts}/${behaviorMaxAttempts} · 定向复核 ${targetIds.length} 项`);
        const focused = await runFocusedRepairValidation(project, candidate, targetIds, (done,total,phase)=>args.onProgress?.(`Behavior Repair ${behaviorRepairAttempts}/${behaviorMaxAttempts} · ${phase ?? "定向复核"} ${done}/${total}`));
        if (focused.failedCriterionIds.length && focused.evaluation) {
          const failedSet = new Set(focused.failedCriterionIds);
          validation = {
            id: `validation-repair-focus-${Date.now()}`, status: "completed", validationMode: "fast-gate", candidateId: candidate.id,
            plannedCases: focused.runs.length, executedCases: focused.runs.length, evaluation: focused.evaluation, runs: focused.runs, baselineRuns: [],
            checks: focused.failedCriterionIds.map((id)=>({ label:`Hard Gate · ${rubric.find((criterion)=>criterion.id===id)?.title ?? id}`, status:"fail" as const, detail:"定向复核确认该修复项仍未达到验收门槛" })),
            recommendation: "hold", summary: `定向复核：${focused.failedCriterionIds.length} 个已修复标准仍未通过。`, evidenceFingerprint: evidenceFingerprint(project,candidate),
          };
          project = { ...project, validationRun: validation };
          failedBehaviorCriteria = rubric.filter((criterion)=>failedSet.has(criterion.id));
          continue;
        }
        args.onProgress?.(`Behavior Repair ${behaviorRepairAttempts}/${behaviorMaxAttempts} · 定向复核通过，执行一次完整 Hidden Validation`);
      } else {
        args.onProgress?.(`Behavior Repair ${behaviorRepairAttempts}/${behaviorMaxAttempts} · 重新运行 Hidden Validation`);
      }
      validation = await runValidation(project, candidate, (done, total, phase) => args.onProgress?.(`Behavior Repair ${behaviorRepairAttempts}/${behaviorMaxAttempts} · ${phase ?? "复验"} ${done}/${total}`), simpleText ? { skipFastGate: true } : undefined);
      project = { ...project, validationRun: validation };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      validation = { ...validation, status: "failed", error: reason };
      const acceptance = blockedAcceptance(`修复成果已保留，但第 ${behaviorRepairAttempts} 次复验未完成：${reason}`);
      return { candidate, validation, acceptance: { ...acceptance, error: reason, failurePhase: "validation" }, rubric, repaired };
    }
    failedBehaviorCriteria = validationRepairCriteria(project, validation);
  }

  if (validation.recommendation !== "release") {
    const reason = failedBehaviorCriteria.length
      ? `已自动局部修复并定向复验 ${behaviorRepairAttempts} 次，仍有 ${failedBehaviorCriteria.length} 个已证实失败项。`
      : "当前只剩缺少与各验收项验证方式匹配的证据，不能用内容改写替代真实验证。请在最终验收页按项补证。";
    return { candidate, validation, acceptance: blockedAcceptance(`${reason} Hidden Validation 尚未通过，Artifact Ready Gate 保持锁定。`), rubric, repaired };
  }

  project = { ...project, validationRun: validation };
  let acceptance = await acceptCandidateArtifacts({ ...project, acceptanceRubric: rubric }, candidate, rubric);
  acceptance = { ...acceptance, attempts: 0, maxRepairAttempts: maxAttempts };
  args.onProgress?.(`Artifact Acceptance · ${acceptance.overallScore}/100`);
  if (acceptance.status === "passed" || acceptance.status === "unverified") return { candidate, validation, acceptance, rubric, repaired };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    args.onProgress?.(`Artifact Repair ${attempt}/${maxAttempts}`);
    try {
      candidate = await repairCandidateArtifacts({ ...project, acceptanceRubric: rubric, artifactAcceptance: acceptance }, candidate, { ...acceptance, attempts: attempt - 1 }, rubric);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { candidate, validation, rubric, repaired, acceptance: { ...acceptance, status: "failed", hardGatePass: false,
        attempts: attempt, failurePhase: "repair", error: reason,
        summary: `已保留本轮 Hidden Validation 证据；自动修复第 ${attempt} 次未完成：${reason}` } };
    }
    repaired = true;
    validation = validationAfterRepair(validation, candidate);
    project = {
      ...project,
      acceptanceRubric: rubric,
      artifactAcceptance: { ...acceptance, status: "repairing", attempts: attempt },
      candidates: project.candidates.map((item) => item.id === candidate.id ? candidate : item),
      experimentRun: { ...project.experimentRun, winnerId: candidate.id },
    };

    // Fast Gate-F precheck first. Hidden Validation is much more expensive (N target runs +
    // evaluator). If the repaired full artifact still misses explicit requirements/integrity,
    // there is no value paying for the entire holdout again yet.
    args.onProgress?.(`Repair ${attempt} · 先做 Artifact Acceptance`);
    acceptance = await acceptCandidateArtifacts({ ...project, acceptanceRubric: rubric }, candidate, rubric);
    acceptance = { ...acceptance, attempts: attempt, maxRepairAttempts: maxAttempts };
    if (acceptance.status === "unverified") break;
    args.onProgress?.(`Repair ${attempt} · Acceptance ${acceptance.overallScore}/100`);
    if (acceptance.status !== "passed") continue;

    args.onProgress?.(`Repair ${attempt} · Acceptance 已通过，重跑 Hidden Validation`);
    validation = await runValidation(project, candidate, undefined);
    if (validation.status !== "completed" || validation.recommendation !== "release") {
      acceptance = {
        ...acceptance,
        id: `artifact-acceptance-${Date.now()}`,
        status: "failed",
        hardGatePass: false,
        attempts: attempt,
        summary: `Repair ${attempt} 的 Artifact Acceptance 已通过，但 Hidden Validation 未通过：${validation.summary || validation.recommendation || "unknown"}`,
        lastCheckedAt: new Date().toISOString(),
      };
      break;
    }

    // The exact same repaired snapshot passed both Gate F and Hidden Holdout. No second
    // materialization/acceptance call is needed; the tested artifact is the deliverable.
    break;
  }

  return { candidate, validation, acceptance, rubric, repaired };
}
