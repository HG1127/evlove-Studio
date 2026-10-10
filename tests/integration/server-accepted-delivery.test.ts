// @vitest-environment node
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { H3 } from "nitro/h3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvolveProject } from "@evolution/contracts";
import render from "../../apps/backend/server/api/evolution/render-accepted.post";
import download from "../../apps/backend/server/api/evolution/artifacts/[id].get";
import { acceptedPackageFixture, acceptedLegacyHtmlPaperFixture } from "@evolution/testkit";
import { buildDeliverableZip } from "../../src/features/evolve/runtime/artifact-output-builders";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), append: vi.fn(), getBlob: vi.fn(), putBlob: vi.fn(), deleteBlob: vi.fn() }));
vi.mock("../../apps/backend/src/services/production-runtime", () => ({ getServerProductionRuntime: () => ({ missions: { get: mocks.get, save: mocks.save }, events: { append: mocks.append } }) }));
vi.mock("../../apps/backend/src/services/artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: mocks.getBlob, put: mocks.putBlob, delete: mocks.deleteBlob }) }));
vi.mock("../../apps/backend/src/services/security-policy", () => ({ requireGovernedEvolutionPermission: vi.fn(async () => undefined) }));
vi.mock("../../src/features/evolve/runtime/artifact-blob-store", () => ({ getArtifactBlob: async (id: string) => {
  const response = await app.fetch(new Request("http://localhost/artifacts/" + encodeURIComponent(id)));
  if (!response.ok) throw new Error("HTTP Artifact read failed");
  return new Blob([await response.arrayBuffer()], { type: response.headers.get("content-type") ?? "application/octet-stream" });
} }));
const app = new H3().post("/render-accepted", render).get("/artifacts/:id", download);
beforeEach(() => vi.resetAllMocks());
describe("frontend ZIP delivery of explicitly accepted server Candidate", () => {
  it.each([false, true])("reopens exact accepted HTTP bytes without rebuilding or changing Champion (%s)", async (withChampion) => {
    const args = acceptedPackageFixture(withChampion);
    mocks.get.mockResolvedValue(args.project);
    mocks.getBlob.mockImplementation(async (id: string) => args.blobs.get(id));
    const response = await app.fetch(new Request("http://localhost/render-accepted", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ missionId: args.project.id, candidateId: args.current.id }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ candidateId: args.current.id });
    const project = mocks.save.mock.calls[0]![0] as EvolveProject;
    const frozen = args.current.artifactSnapshots[0]!.frozenArtifact!;
    const zip = await JSZip.loadAsync(await (await buildDeliverableZip(project)).arrayBuffer(), { checkCRC32: true });
    const reopened = await zip.file(frozen.name)!.async("uint8array");
    expect(createHash("sha256").update(reopened).digest("hex")).toBe(frozen.sha256);
    expect(await zip.file(frozen.name)!.async("string")).toBe(args.current.artifactSnapshots[0]!.content);
    const manifest = JSON.parse(await zip.file("candidate-manifest.json")!.async("string"));
    expect(manifest).toMatchObject({ candidateId: args.current.id, validationId: args.project.validationRun.id, acceptanceId: args.project.artifactAcceptance.id });
    expect(project.searchChampion).toEqual(args.project.searchChampion);
    expect(mocks.getBlob).toHaveBeenCalledWith(frozen.blobId);
    expect(mocks.putBlob).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });
  it.each(["manifest", "acceptance-report", "scorecard"] as const)("blocks changed %s JSON contents before any frontend download read", async (kind) => {
    const args = acceptedPackageFixture(true);
    mocks.get.mockResolvedValue(args.project);
    mocks.getBlob.mockImplementation(async (id: string) => args.blobs.get(id));
    const response = await app.fetch(new Request("http://localhost/render-accepted", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ missionId: args.project.id, candidateId: args.current.id }) }));
    expect(response.status).toBe(200);
    const project = mocks.save.mock.calls[0]![0] as EvolveProject;
    const primary = structuredClone(project.outputArtifacts.find((item) => item.kind === "primary"));
    const item = project.outputArtifacts.find((artifact) => artifact.kind === kind)!;
    const data = JSON.parse(item.content) as Record<string, unknown>;
    if (kind === "manifest") data.acceptanceId = "old-acceptance";
    if (kind === "acceptance-report") data.candidateId = "old-candidate";
    if (kind === "scorecard") data.accuracy = 1;
    item.content = JSON.stringify(data);
    mocks.getBlob.mockClear();
    await expect(buildDeliverableZip(project)).rejects.toThrow();
    expect(project.outputArtifacts.find((artifact) => artifact.kind === "primary")).toEqual(primary);
    expect(mocks.getBlob).not.toHaveBeenCalled();
    expect(mocks.putBlob).not.toHaveBeenCalled();
    expect(mocks.deleteBlob).not.toHaveBeenCalled();
  });

  it.each([false,true])("refuses prior generated paper at render and ZIP boundaries before I/O (%s)",async withChampion=>{
    const args=acceptedLegacyHtmlPaperFixture(withChampion);mocks.get.mockResolvedValue(args.project);
    const candidateId=withChampion?args.prior.id:args.current.id;
    const response=await app.fetch(new Request("http://localhost/render-accepted",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({missionId:args.project.id,candidateId})}));
    expect(response.status).toBe(409);
    await expect(buildDeliverableZip(args.project)).rejects.toThrow("html-protection-contract-pending");
    for(const operation of [mocks.getBlob,mocks.putBlob,mocks.deleteBlob,mocks.save,mocks.append])expect(operation).not.toHaveBeenCalled();
  });

});
