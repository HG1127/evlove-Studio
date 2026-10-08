import { TestCaseSchema } from "@evolution/contracts";
import { acceptedPackageFixture } from "./accepted-package-fixture";
export const experimentRecoveryAt = "2026-10-09T02:00:00.000Z";
/** Synthetic Mission/physical files for recovery composition; no real model or execution proof. */
export function experimentRecoveryFixture(count = 1) {
  const at = experimentRecoveryAt;
  const x = acceptedPackageFixture(false);
  const project = x.project;
  const test = TestCaseSchema.parse({ id: "V1", title: "Content", input: "inspect exact file", expected: ["improved"], criterionIds: ["CONTENT"], executionMode: "external-runner" });
  project.stage = "plan";
  project.acceptanceRubric = [{ id: "CONTENT", title: "Content", requirement: "improved content", source: "user-command", weight: 100, hardGate: true, judgeType: "llm", validationMethod: "executable-test", minScore: 80, evidenceExpected: ["improved"], protectedConstraint: false, artifactIds: ["source"], category: "outcome" }];
  project.evalSuite = [test];
  project.candidates = [x.current, ...(count > 1 ? [x.prior] : [])].map(c => ({ ...c, status: "draft" as const, artifactSnapshots: [], artifactBuildStatus: "idle" as const }));
  project.selectedCandidateIds = project.candidates.map(c => c.id);
  project.experimentRun = { id: "experiment-r1-server", status: "idle", candidateResults: [] };
  project.gates = [{ id: "experiment-ready", status: "approved", approvedAt: at }];
  project.campaign = { ...project.campaign, status: "running", currentRound: 0, checkpoint: { round: 1, completedPhase: "plan", at } };
  project.baselineRun = { ...project.baselineRun, runs: [{ testCaseId: test.id, output: "original content", latencyMs: 1, cost: 0, verificationStatus: "verified", trace: [] }], result: { ...project.baselineRun.result!, accuracy: 60, evidence: 60, completeness: 60, rubricScore: 60, criterionScores: [{ criterionId: "CONTENT", score: 60, pass: false, verificationStatus: "verified", evidence: ["original content"], gaps: ["improved"], testCaseIds: [test.id] }], caseScores: [{ testCaseId: test.id, accuracy: 60, evidence: 60, completeness: 60, reason: "original" }] } };
  project.validationRun = { id: "validation", status: "idle", checks: [], runs: [], baselineRuns: [] };
  project.artifactAcceptance = { ...project.artifactAcceptance, status: "idle", candidateId: undefined, evidenceFingerprint: undefined, frozenArtifacts: undefined, acceptedAt: undefined };
  x.blobs.set(project.sourceArtifacts[0]!.id, new Blob([project.sourceArtifacts[0]!.textContent!], { type: "text/html" }));
  return x;
}
