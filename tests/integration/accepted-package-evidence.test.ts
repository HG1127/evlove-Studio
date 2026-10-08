// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AcceptanceCriterionSchema } from "@evolution/contracts";
import type { ArtifactAcceptance, EvaluationResult, EvolveProject, FrozenArtifact, SearchChampion } from "@evolution/contracts";
import { acceptanceArtifacts, assertDeliverablePackageIdentity, materializeAcceptedCandidatePackage, materializeAcceptedChampionPackage } from "@evolution/core";
import { acceptedPackageFixture } from "@evolution/testkit";
import { renderAcceptedProjectArtifacts } from "../../apps/backend/src/services/server-artifact-renderer";

type Manifest = { projectId: string; candidateId?: string; validationId?: string; acceptanceId?: string; evidenceFingerprint?: string; frozenArtifacts?: FrozenArtifact[]; searchChampion?: SearchChampion };
const corruptions = ["manifest-project", "manifest-validation", "manifest-acceptance", "manifest-fingerprint", "manifest-bytes", "report-id", "report-candidate", "report-status", "report-results", "report-bytes", "scorecard", "patches", "missing-report", "duplicate-report", "missing-matrix", "changed-matrix", "missing-scorecard", "duplicate-scorecard", "missing-patches", "malformed-manifest", "malformed-report", "malformed-scorecard"] as const;
type Corruption = typeof corruptions[number];
function corrupt(project: EvolveProject, kind: Corruption) {
  const byKind = (name: string) => project.outputArtifacts.find((item) => item.kind === name)!;
  const remove = (name: string) => { project.outputArtifacts = project.outputArtifacts.filter((item) => item.kind !== name); };
  const duplicate = (name: string) => { const item = byKind(name); project.outputArtifacts.push({ ...item, id: item.id + "-duplicate" }); };
  if (kind === "missing-report") return remove("acceptance-report");
  if (kind === "duplicate-report") return duplicate("acceptance-report");
  if (kind === "missing-matrix") return remove("requirement-matrix");
  if (kind === "missing-scorecard") return remove("scorecard");
  if (kind === "duplicate-scorecard") return duplicate("scorecard");
  if (kind === "missing-patches") return remove("patch-bundle");
  if (kind === "changed-matrix") { byKind("requirement-matrix").content += "\nUnobserved requirement marked PASS"; return; }
  if (kind.startsWith("malformed-")) { byKind(kind === "malformed-manifest" ? "manifest" : kind === "malformed-report" ? "acceptance-report" : "scorecard").content = "{"; return; }
  if (kind.startsWith("manifest-")) {
    const item = byKind("manifest"), data = JSON.parse(item.content) as Manifest;
    if (kind === "manifest-project") data.projectId = "another-mission";
    if (kind === "manifest-validation") { if (data.searchChampion) data.searchChampion.validation!.id = "old-validation"; else data.validationId = "old-validation"; }
    if (kind === "manifest-acceptance") { if (data.searchChampion) data.searchChampion.artifactAcceptance!.id = "old-acceptance"; else data.acceptanceId = "old-acceptance"; }
    if (kind === "manifest-fingerprint") { if (data.searchChampion) data.searchChampion.validation!.evidenceFingerprint = "old-binding"; else data.evidenceFingerprint = "old-binding"; }
    if (kind === "manifest-bytes") (data.searchChampion?.artifactAcceptance?.frozenArtifacts ?? data.frozenArtifacts)![0]!.sha256 = "f".repeat(64);
    item.content = JSON.stringify(data); return;
  }
  if (kind.startsWith("report-")) {
    const item = byKind("acceptance-report"), data = JSON.parse(item.content) as ArtifactAcceptance;
    if (kind === "report-id") data.id = "old-acceptance";
    if (kind === "report-candidate") data.candidateId = "another-candidate";
    if (kind === "report-status") data.status = "failed";
    if (kind === "report-results") data.results = [{ criterionId: "invented", pass: true, score: 100, evidence: ["not observed"], gaps: [], note: "" }];
    if (kind === "report-bytes") data.frozenArtifacts![0]!.sha256 = "f".repeat(64);
    item.content = JSON.stringify(data); return;
  }
  if (kind === "scorecard") {
    const item = byKind("scorecard"), data = JSON.parse(item.content) as EvaluationResult;
    data.accuracy = 1; item.content = JSON.stringify(data); return;
  }
  byKind("patch-bundle").content = JSON.stringify([{ id: "unobserved", component: "code", operation: "add", target: "another.html", content: "different change", rationale: "not tested" }]);
}
function ready(champion: boolean) {
  const args = acceptedPackageFixture();
  args.project.outputArtifacts = champion ? materializeAcceptedChampionPackage(args.project) : materializeAcceptedCandidatePackage(args.project, args.current, args.project.artifactAcceptance);
  return args;
}
describe.each([false, true])("package evidence contents before frozen delivery (Champion=%s)", (champion) => {
  it("retains a complete canonical package and exact physical bytes", async () => {
    const args = ready(champion);
    expect(assertDeliverablePackageIdentity(args.project)).toBe(champion ? args.prior.id : args.current.id);
    expect((await renderAcceptedProjectArtifacts(args.project, args.project.outputArtifacts, args.store)).receipts).toHaveLength(1);
  });
  it("accepts semantically identical JSON with reordered keys/whitespace", () => {
    const args = ready(champion);
    const reverse = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverse);
      if (value === null || typeof value !== "object") return value;
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([key, data]) => [key, reverse(data)]));
    };
    for (const item of args.project.outputArtifacts) if (["manifest", "acceptance-report", "scorecard", "patch-bundle"].includes(item.kind)) item.content = JSON.stringify(reverse(JSON.parse(item.content)), null, 4);
    expect(assertDeliverablePackageIdentity(args.project)).toBe(champion ? args.prior.id : args.current.id);
  });
  it.each(corruptions)("rejects %s even when all outer Candidate fields and primary bytes remain valid", async (kind) => {
    const args = ready(champion);
    const get = vi.fn(args.store.get), primaryBefore = structuredClone(args.project.outputArtifacts.find((item) => item.kind === "primary"));
    corrupt(args.project, kind);
    expect(args.project.outputArtifacts.find((item) => item.kind === "primary")).toEqual(primaryBefore);
    expect(() => assertDeliverablePackageIdentity(args.project)).toThrow();
    await expect(renderAcceptedProjectArtifacts(args.project, args.project.outputArtifacts, { ...args.store, get })).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
});

it("preserves the established requirement coverage text and missing evidence markers", () => {
  const args = acceptedPackageFixture(false);
  args.project.acceptanceRubric = [
    AcceptanceCriterionSchema.parse({ id: "R1", title: "Required change", requirement: "Show the actual changed content", hardGate: true }),
    AcceptanceCriterionSchema.parse({ id: "R2", title: "Missing check", requirement: "Needs independent evidence" }),
  ];
  args.project.artifactAcceptance.results = [{ criterionId: "R1", pass: true, score: 94, evidence: ["actual bytes", "executed assertion"], gaps: [], note: "" }];
  const matrix = acceptanceArtifacts(args.project, args.current, args.project.artifactAcceptance).find((item) => item.kind === "requirement-matrix")!;
  expect(matrix.content).toBe("# Requirement Coverage\n\n- ✅ **R1 · Required change** — 94/100 · HARD GATE\n  - Requirement: Show the actual changed content\n  - Evidence: actual bytes；executed assertion\n  - Gaps: 无\n- ❌ **R2 · Missing check** — 0/100\n  - Requirement: Needs independent evidence\n  - Evidence: 无\n  - Gaps: 无");
});
