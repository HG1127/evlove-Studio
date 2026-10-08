import { beforeEach, describe, expect, it, vi } from "vitest";
import { artifactRepairNeedsRecovery, deriveAttentionRequest } from "@evolution/harness";
import { demoProject } from "../data/mock-project";
import { AcceptanceCriterionSchema, CandidateSchema, EvolveProjectSchema, type ValidationRun } from "../schemas";
import { acceptCandidateArtifacts, ensureAcceptanceRubric, repairCandidateArtifacts } from "./artifact-quality";
import { runValidation } from "./run-local";
import { evidenceFingerprint } from "./evidence-binding";
import { repairValidationCheckpoint, runArtifactAcceptanceLoop } from "./artifact-loop";
vi.mock("./artifact-quality", () => ({ acceptCandidateArtifacts: vi.fn(), ensureAcceptanceRubric: vi.fn(), repairCandidateArtifacts: vi.fn() }));
vi.mock("./run-local", () => ({ isSimpleLocalTextProject: () => false, runValidation: vi.fn(), runFocusedRepairValidation: vi.fn() }));

function fixture() {
  const project = EvolveProjectSchema.parse(structuredClone(demoProject));
  project.inputUnderstanding = { status: "ready", intentRestatement: "修复流程", implicitRequirements: [], assumptions: [], acceptanceFocus: [], confidence: 0.9, clarifications: [] };
  project.inputClarifications = [];
  const failed = AcceptanceCriterionSchema.parse({ id: "flow", title: "流程闭环", requirement: "闭环", validationMethod: "static-structure" });
  const pending = AcceptanceCriterionSchema.parse({ id: "visual", title: "视觉外观", requirement: "视觉", validationMethod: "visual-review" });
  project.acceptanceRubric = [failed, pending];
  const candidate = CandidateSchema.parse({ id: "current", name: "当前候选", change: "修复", artifactSnapshots: [{ id: "snapshot", sourceArtifactId: project.sourceArtifacts[0]!.id, name: "flow.txt", mimeType: "text/plain", content: "当前成果", createdAt: "now" }] });
  project.candidates = [candidate];
  project.experimentRun = { ...project.experimentRun, winnerId: candidate.id };
  const validation: ValidationRun = { ...project.validationRun, status: "completed", candidateId: candidate.id, recommendation: "hold", evidenceFingerprint: evidenceFingerprint(project, candidate),
    evaluation: { ...project.baselineRun.result!, unverifiedCriterionIds: [pending.id], criterionScores: [{ criterionId: failed.id, score: 40, pass: false, verificationStatus: "verified", evidence: ["已证实缺失"], gaps: ["缺失"], testCaseIds: [] }] } };
  project.validationRun = validation;
  vi.mocked(ensureAcceptanceRubric).mockResolvedValue(project.acceptanceRubric);
  return { project, candidate, validation, failed, pending };
}
beforeEach(() => vi.resetAllMocks());

describe("artifact repair recovery checkpoints", () => {
  it("keeps verified failure evidence on timeout and prioritizes repair recovery over pending visual evidence", async () => {
    const { project, candidate, validation } = fixture();
    vi.mocked(repairCandidateArtifacts).mockRejectedValue(new Error("repair-artifact生成未完成：模型在 180 秒内未返回完整结果"));
    const loop = await runArtifactAcceptanceLoop({ project, candidate, validation });
    expect(loop.candidate).toBe(candidate);
    expect(loop.validation).toBe(validation);
    expect(loop.acceptance).toMatchObject({ status: "failed", failurePhase: "repair" });
    expect(runValidation).not.toHaveBeenCalled();
    const checkpoint = { ...project, artifactAcceptance: loop.acceptance };
    expect(deriveAttentionRequest(checkpoint)).toMatchObject({ diagnosticCode: "artifact-repair-recovery", criterionIds: [] });
    expect(repairValidationCheckpoint(checkpoint, candidate)).toBe(validation);
    // Old persisted errors must be classified correctly after refresh, too.
    expect(artifactRepairNeedsRecovery({ ...checkpoint, artifactAcceptance: { ...loop.acceptance, failurePhase: undefined } })).toBe(true);
    expect(repairValidationCheckpoint(checkpoint, { ...candidate, artifactSnapshots: candidate.artifactSnapshots.map((item) => ({ ...item, content: "changed" })) })).toBeUndefined();
    expect(repairValidationCheckpoint({ ...checkpoint, goal: "changed contract" }, candidate)).toBeUndefined();
  });

  it("validates the new snapshot after a successful retry and clears the generation failure", async () => {
    const { project, candidate, validation } = fixture();
    const repaired = { ...candidate, artifactSnapshots: candidate.artifactSnapshots.map((item) => ({ ...item, id: "new", content: "修复后的成果" })) };
    vi.mocked(repairCandidateArtifacts).mockResolvedValue(repaired);
    vi.mocked(runValidation).mockImplementation(async (current, currentCandidate) => ({ ...validation, recommendation: "release", evidenceFingerprint: evidenceFingerprint(current, currentCandidate), evaluation: { ...validation.evaluation!, criterionScores: [], unverifiedCriterionIds: [] } }));
    vi.mocked(acceptCandidateArtifacts).mockResolvedValue({ ...project.artifactAcceptance, status: "passed", candidateId: candidate.id, hardGatePass: true });
    const loop = await runArtifactAcceptanceLoop({ project, candidate, validation });
    expect(runValidation).toHaveBeenCalledWith(expect.anything(), repaired, expect.any(Function), undefined);
    expect(loop.candidate).toBe(repaired);
    expect(loop.acceptance.status).toBe("passed");
    expect(artifactRepairNeedsRecovery({ ...project, artifactAcceptance: loop.acceptance })).toBe(false);
  });

  it("preserves a completed holdout when Gate F repair itself fails", async () => {
    const { project, candidate, validation } = fixture();
    const release = { ...validation, recommendation: "release" as const };
    vi.mocked(acceptCandidateArtifacts).mockResolvedValue({ ...project.artifactAcceptance, status: "failed", candidateId: candidate.id });
    vi.mocked(repairCandidateArtifacts).mockRejectedValue(new Error("timeout"));
    const loop = await runArtifactAcceptanceLoop({ project, candidate, validation: release });
    expect(loop.validation).toBe(release);
    expect(loop.acceptance.failurePhase).toBe("repair");
    expect(runValidation).not.toHaveBeenCalled();
  });

  it("shows real external evidence requirements after the repair failure is settled", () => {
    const { project, candidate } = fixture();
    const attention = deriveAttentionRequest({ ...project, artifactAcceptance: { ...project.artifactAcceptance, status: "unverified", candidateId: candidate.id } });
    expect(attention).toMatchObject({ type: "evidence", criterionIds: ["visual"] });
  });
});
