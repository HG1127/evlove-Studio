import { createHash } from "node:crypto";
import { CandidateSchema, EvolveProjectSchema, SourceArtifactSchema, type ArtifactStorePort } from "@evolution/contracts";
import { evidenceFingerprint } from "@evolution/core";

export const acceptedAt = "2026-10-08T16:00:00.000Z";
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
/** Canonical synthetic acceptance records for API/physical delivery tests, not production observations. */
export function acceptedPackageFixture(withChampion = true) {
  const source = SourceArtifactSchema.parse({ id: "source", name: "original.html", extension: "html", mimeType: "text/html", role: "target", artifactKind: "document", inputMode: "upload", size: 44, textContent: "<html><body>original input</body></html>", createdAt: acceptedAt });
  source.size = new TextEncoder().encode(source.textContent!).byteLength;
  const blobs = new Map<string, Blob>();
  const make = (id: string, text: string) => {
    const content = "<html><body><p>" + text + "</p></body></html>";
    const sha = hash(content), blob = new Blob([content], { type: "text/html" });
    const frozen = { sourceArtifactId: source.id, snapshotHash: sha, blobId: "server-candidate:" + sha, name: id + "-evolved.html", mimeType: blob.type, sha256: sha, size: blob.size, verifiedAt: acceptedAt, checks: ["synthetic fixture"], limitations: [] };
    blobs.set(frozen.blobId, blob);
    return CandidateSchema.parse({ id, name: id, change: text, status: "passed", artifactBuildStatus: "ready", artifactSnapshots: [{ id: "snapshot-" + id, sourceArtifactId: source.id, name: frozen.name, mimeType: frozen.mimeType, content, contentHash: sha, frozenArtifact: frozen, createdAt: acceptedAt }] });
  };
  const current = make("current", "newly accepted actual content");
  const prior = make("prior", "different historical Champion content");
  const evaluation = { accuracy: 92, evidence: 92, riskCoverage: 92, completeness: 92, safety: "PASS", averageCost: 0, averageLatencyMs: 1, rubricScore: 92, verifiedRubricCoverage: 100, unverifiedCriterionIds: [] };
  const runs = [{ testCaseId: "H1", output: "synthetic observed answer", verificationStatus: "verified", latencyMs: 1, cost: 0, trace: [] }];
  const project = EvolveProjectSchema.parse({
    id: "mission", name: "Delivery fixture", objectType: "document", department: "test", version: "V1", stage: "validation", goal: "deliver current accepted file", evolutionCommand: "improve content", protectedItems: [], editableItems: [], metrics: [], gates: [], problems: [],
    sourceArtifacts: [source], candidates: [current, prior], experimentPolicy: {}, lessons: [], targetConnection: { adapter: "artifact" }, release: { status: "idle", history: [] }, updatedAt: acceptedAt,
    hiddenEvalSuite: [{ id: "H1", title: "Hidden", input: "check current file", expected: ["improved"], hidden: true }],
    baselineRun: { id: "baseline", status: "completed", suiteName: "Core", totalCases: 1, result: evaluation },
    experimentRun: { id: "experiment", status: "completed", winnerId: current.id },
    validationRun: { id: "validation-current", status: "completed", validationMode: "full", candidateId: current.id, recommendation: "release", evaluation, runs, baselineRuns: runs, baselineEvaluation: evaluation, baselineSuiteIds: ["H1"], baselineContextFingerprint: "synthetic-same-paper", baselineObservedAt: Date.parse(acceptedAt) },
    artifactAcceptance: { id: "acceptance-current", status: "passed", candidateId: current.id, hardGatePass: true, overallScore: 92, frozenArtifacts: [current.artifactSnapshots[0]!.frozenArtifact], acceptedAt },
  });
  const binding = evidenceFingerprint(project, current);
  project.validationRun.evidenceFingerprint = binding;
  project.artifactAcceptance.evidenceFingerprint = binding;
  if (withChampion) {
    const priorBinding = evidenceFingerprint(project, prior);
    project.searchChampion = {
      id: "historical-champion", versionLabel: "S1", round: 1, score: 98, reason: "historical best", patches: [], selectedAt: acceptedAt, candidate: project.candidates.find((item) => item.id === prior.id)!, evaluation: project.validationRun.evaluation,
      validation: { ...structuredClone(project.validationRun), id: "validation-prior", candidateId: prior.id, evidenceFingerprint: priorBinding },
      artifactAcceptance: { ...project.artifactAcceptance, id: "acceptance-prior", candidateId: prior.id, evidenceFingerprint: priorBinding, frozenArtifacts: [prior.artifactSnapshots[0]!.frozenArtifact!] },
    };
  }
  const store: ArtifactStorePort = { get: async (id) => blobs.get(id), put: async () => { throw new Error("delivery must not regenerate bytes"); }, delete: async () => { throw new Error("delivery must not delete bytes"); } };
  return { project, current: project.candidates.find((item) => item.id === current.id)!, prior: project.candidates.find((item) => item.id === prior.id)!, blobs, store };
}
