// @vitest-environment node
import { createHash } from "node:crypto";
import { H3 } from "nitro/h3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcceptedArtifactRenderRequestSchema, type EvolveProject } from "@evolution/contracts";
import { assertDeliverablePackageIdentity, evidenceFingerprint, mapTestsToRubric, normalizeAcceptanceRubric, settleArtifactAcceptanceFromValidation } from "@evolution/core";
import render from "../../server/api/evolution/render-accepted.post";
import download from "../../server/api/evolution/artifacts/[id].get";
import { acceptedPackageFixture } from "@evolution/testkit";
import { parseServerSource } from "./server-source-parser";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), append: vi.fn(), getBlob: vi.fn(), putBlob: vi.fn(), deleteBlob: vi.fn() }));
vi.mock("./production-runtime", () => ({ getServerProductionRuntime: () => ({ missions: { get: mocks.get, save: mocks.save }, events: { append: mocks.append } }) }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: mocks.getBlob, put: mocks.putBlob, delete: mocks.deleteBlob }) }));
vi.mock("./security-policy", () => ({ requireGovernedEvolutionPermission: vi.fn(async () => undefined) }));
const app = new H3().post("/render-accepted", render).get("/artifacts/:id", download);
const request = (candidateId?: string) => app.fetch(new Request("http://localhost/render-accepted", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ missionId: "mission", ...(candidateId ? { candidateId } : {}) }) }));
function setup(withChampion = true) {
  const args = acceptedPackageFixture(withChampion);
  mocks.get.mockResolvedValue(args.project);
  mocks.getBlob.mockImplementation(async (id: string) => args.blobs.get(id));
  return args;
}
beforeEach(() => vi.resetAllMocks());
describe("accepted current Candidate server package and physical download", () => {
  it("requires fresh paired evidence after correcting an SOP contract, then downloads and reopens the frozen HTML", async () => {
    const args = setup(false), project = args.project, snapshot = args.current.artifactSnapshots[0]!;
    const frozen = snapshot.frozenArtifact!;
    project.evolutionCommand = "补充完整流程与异常处理说明";
    project.acceptanceRubric = normalizeAcceptanceRubric(project.acceptanceRubric, project);
    project.hiddenEvalSuite = mapTestsToRubric(project.acceptanceRubric, [], []).hiddenCases;
    const binding = evidenceFingerprint(project, args.current);
    const originalSnapshots = structuredClone(args.current.artifactSnapshots);
    expect((await request(args.current.id)).status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();

    // Synthetic paired receipts exercise composition; they are not a real Mission execution.
    const runs = project.hiddenEvalSuite.map((test) => ({ ...project.validationRun.runs[0]!, testCaseId: test.id }));
    project.validationRun = { ...project.validationRun, evidenceFingerprint: binding, runs, baselineRuns: structuredClone(runs),
      baselineSuiteIds: project.hiddenEvalSuite.map((test) => test.id),
      evaluation: { ...project.validationRun.evaluation!, rubricScore: 100, criterionScores: project.acceptanceRubric.map((criterion) => ({
        criterionId: criterion.id, score: 100, pass: true, verificationStatus: "verified", evidence: ["synthetic paired receipt"], gaps: [],
        testCaseIds: project.hiddenEvalSuite.filter((test) => test.criterionIds.includes(criterion.id)).map((test) => test.id),
      })) },
    };
    for (let retry = 0; retry < 3; retry++) {
      project.acceptanceRubric = normalizeAcceptanceRubric(project.acceptanceRubric, project);
      project.hiddenEvalSuite = mapTestsToRubric(project.acceptanceRubric, [], project.hiddenEvalSuite).hiddenCases;
      expect(evidenceFingerprint(project, args.current)).toBe(binding);
    }
    project.artifactAcceptance = settleArtifactAcceptanceFromValidation({ project, candidate: args.current,
      validation: project.validationRun, frozenArtifacts: [frozen] });
    expect(project.artifactAcceptance.status).toBe("passed");
    expect(args.current.artifactSnapshots).toEqual(originalSnapshots);
    expect((await request(args.current.id)).status).toBe(200);
    const response = await app.fetch(new Request("http://localhost/artifacts/" + encodeURIComponent(frozen.blobId)));
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(frozen.sha256);
    const reopened = await parseServerSource({ artifactId: "reopened", name: frozen.name, mimeType: frozen.mimeType,
      size: bytes.byteLength, role: "target", storageRef: frozen.blobId, blob: new Blob([bytes], { type: frozen.mimeType }) });
    expect(reopened.textContent).toBe(snapshot.content);
    expect(mocks.putBlob).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });
  it("preserves an optional explicit Candidate identity across the request boundary", () => {
    expect(AcceptedArtifactRenderRequestSchema.parse({ missionId: "mission", candidateId: "current" })).toEqual({ missionId: "mission", candidateId: "current" });
    expect(AcceptedArtifactRenderRequestSchema.parse({ missionId: "mission" })).toEqual({ missionId: "mission" });
    expect(AcceptedArtifactRenderRequestSchema.safeParse({ missionId: "mission", candidateId: "" }).success).toBe(false);
  });
  it("rejects malformed explicit identity instead of silently selecting the Champion", async () => {
    setup();
    const response = await app.fetch(new Request("http://localhost/render-accepted", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ missionId: "mission", candidateId: "" }) }));
    expect(response.status).toBe(400);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it.each([false, true])("serves current accepted bytes without changing Champion (%s)", async (withChampion) => {
    const args = setup(withChampion);
    const priorState = structuredClone(args.project);
    const response = await request(args.current.id);
    expect(response.status).toBe(200);
    const body = await response.json();
    const frozen = args.current.artifactSnapshots[0]!.frozenArtifact!;
    expect(body).toMatchObject({ missionId: "mission", candidateId: args.current.id, renderedCount: 1, receipts: [{ artifactRef: frozen.blobId, sha256: frozen.sha256, size: frozen.size }] });
    const saved = mocks.save.mock.calls[0]![0] as EvolveProject;
    expect(saved.searchChampion).toEqual(priorState.searchChampion);
    expect(saved.artifactAcceptance).toEqual(priorState.artifactAcceptance);
    expect(saved.validationRun).toEqual(priorState.validationRun);
    expect(saved.experimentRun).toEqual(priorState.experimentRun);
    expect(assertDeliverablePackageIdentity(saved)).toBe(args.current.id);
    expect(new Set(saved.outputArtifacts.map((item) => item.candidateId))).toEqual(new Set([args.current.id]));
    expect(saved.outputArtifacts.every((item) => item.accepted && !item.isChampion)).toBe(true);
    expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ candidateId: args.current.id, artifactHashes: [frozen.sha256] }) }));
    const read = await app.fetch(new Request("http://localhost/artifacts/" + encodeURIComponent(frozen.blobId)));
    expect(read.status).toBe(200);
    const bytes = new Uint8Array(await read.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(frozen.sha256);
    expect(mocks.putBlob).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });
  it("retains the Champion default while preserving a different current Candidate's evidence", async () => {
    const args = setup();
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ candidateId: args.prior.id });
    const saved = mocks.save.mock.calls[0]![0] as EvolveProject;
    expect(assertDeliverablePackageIdentity(saved)).toBe(args.prior.id);
    expect(saved.artifactAcceptance).toEqual(args.project.artifactAcceptance);
    expect(saved.validationRun).toEqual(args.project.validationRun);
  });
  it.each(["unknown", "stale", "demo", "partial", "missing-paired"])("rejects %s explicit delivery without falling back to the historical Champion", async (kind) => {
    const args = setup();
    if (kind === "stale") args.project.validationRun.evidenceFingerprint = "stale";
    if (kind === "demo") args.project.validationRun.evaluation!.demoJudged = true;
    if (kind === "partial") args.project.validationRun.runs[0]!.verificationStatus = "partial";
    if (kind === "missing-paired") args.project.validationRun.baselineRuns = [];
    const response = await request(kind === "unknown" ? "unknown" : args.current.id);
    expect(response.status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.putBlob).not.toHaveBeenCalled();
  });
  it.each(["candidate.zip", "candidate.md", "candidate"])("blocks an accepted HTML with jointly wrong download name %s", async (name) => {
    const args = setup(false), snapshot = args.current.artifactSnapshots[0]!;
    snapshot.name = name;
    snapshot.frozenArtifact!.name = name;
    args.project.artifactAcceptance.frozenArtifacts![0]!.name = name;
    // Keep otherwise valid synthetic acceptance bindings; rejection must be about file format.
    const binding = evidenceFingerprint(args.project,args.current);
    args.project.validationRun.evidenceFingerprint = binding;
    args.project.artifactAcceptance.evidenceFingerprint = binding;
    const response = await request(args.current.id);
    expect(response.status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.putBlob).not.toHaveBeenCalled();
  });
  it("blocks a historical accepted HTML with a jointly wrong name and MIME", async () => {
    const args = setup(false), snapshot = args.current.artifactSnapshots[0]!;
    snapshot.name = snapshot.frozenArtifact!.name = "candidate.zip";
    snapshot.mimeType = snapshot.frozenArtifact!.mimeType = "application/zip";
    Object.assign(args.project.artifactAcceptance.frozenArtifacts![0]!,{name:snapshot.name,mimeType:snapshot.mimeType});
    const binding = evidenceFingerprint(args.project,args.current);
    args.project.validationRun.evidenceFingerprint = binding;
    args.project.artifactAcceptance.evidenceFingerprint = binding;
    expect((await request(args.current.id)).status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.putBlob).not.toHaveBeenCalled();
  });
  it.each(["renamed.HTML", "renamed.htm"])("delivers and reopens same-format renamed %s without changing bytes", async (name) => {
    const args = setup(false), snapshot = args.current.artifactSnapshots[0]!, frozen = snapshot.frozenArtifact!;
    snapshot.name = frozen.name = name;
    args.project.artifactAcceptance.frozenArtifacts![0]!.name = name;
    const binding = evidenceFingerprint(args.project,args.current);
    args.project.validationRun.evidenceFingerprint = binding;
    args.project.artifactAcceptance.evidenceFingerprint = binding;
    expect((await request(args.current.id)).status).toBe(200);
    const response = await app.fetch(new Request("http://localhost/artifacts/" + encodeURIComponent(frozen.blobId)));
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(frozen.sha256);
    const saved = mocks.save.mock.calls[0]![0] as EvolveProject;
    expect(saved.outputArtifacts.find(item=>item.kind==="primary")!.frozenArtifact!.name).toBe(name);
    const reopened = await parseServerSource({artifactId:"reopened",name,mimeType:frozen.mimeType,
      size:bytes.byteLength,role:"target",storageRef:frozen.blobId,blob:new Blob([bytes],{type:frozen.mimeType})});
    expect(reopened.textContent).toBe(snapshot.content);
    expect(mocks.putBlob).not.toHaveBeenCalled();
  });
  it.each(["missing", "changed-bytes", "changed-snapshot", "changed-snapshot-rebound"])("blocks %s after acceptance instead of recreating a download", async (kind) => {
    const args = setup(false), snapshot = args.current.artifactSnapshots[0]!, frozen = snapshot.frozenArtifact!;
    if (kind === "missing") args.blobs.delete(frozen.blobId);
    if (kind === "changed-bytes") args.blobs.set(frozen.blobId, new Blob(["x".repeat(frozen.size)], { type: frozen.mimeType }));
    if (kind.startsWith("changed-snapshot")) snapshot.content += "untested";
    if (kind === "changed-snapshot-rebound") {
      const binding = evidenceFingerprint(args.project, args.current);
      args.project.validationRun.evidenceFingerprint = binding;
      args.project.artifactAcceptance.evidenceFingerprint = binding;
    }
    const response = await request(args.current.id);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.putBlob).not.toHaveBeenCalled();
  });
});
