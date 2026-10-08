import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvolveProject, TestCase } from "@evolution/contracts";
import { serverArtifactSha256 } from "./server-experiment-artifacts";
import { runServerCurrentStoredEvidence } from "./server-current-stored-evidence";
import { buildServerCurrentSemanticArtifactContext } from "./server-current-semantic-context";
import { minimalTextPdf } from "./pdf-test-fixture";

const blobs = vi.hoisted(() => new Map<string, Blob>());
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => blobs.get(id) }) }));

function project(extension = "md"): EvolveProject {
  return {
    id: "mission", version: "V1", sourceArtifacts: [{ id: "guide", role: "target", name: `guide.${extension}`, extension, artifactKind: "document", storageRef: "raw-guide", size: 0, textContent: "STALE PARSED INDEX" }],
    acceptanceRubric: [{ id: "STRUCT", artifactIds: ["guide"] }],
  } as unknown as EvolveProject;
}
function testCase(executionMode: "static-evidence" | "roundtrip"): TestCase {
  return { id: "T1", title: "Guide check", input: "Inspect actual file", expected: [], tags: [], hidden: true, criterionIds: ["STRUCT"], executionMode, evidenceScope: "implementation" };
}
async function storeSource(project: EvolveProject, bytes: string | Uint8Array) {
  const blob = new NodeBlob([bytes], { type: "application/octet-stream" }) as Blob;
  project.sourceArtifacts[0]!.size = blob.size;
  blobs.set("raw-guide", blob);
  return blob;
}
async function codebaseZip(label: string) {
  const zip = new JSZip();
  zip.file("package.json", JSON.stringify({ name: "source-or-champion" }));
  zip.file("src/config.ts", `export const configuration = "configuration setup ${label}";`);
  zip.file("src/setup.ts", `export const setup = "setup configuration ${label}";`);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
async function acceptChampion(project: EvolveProject, content: string) {
  const blob = new NodeBlob([content], { type: "text/markdown" }) as Blob;
  const sha256 = await serverArtifactSha256(await blob.arrayBuffer());
  const contentHash = await serverArtifactSha256(new TextEncoder().encode(content));
  blobs.set("champion-guide", blob);
  const candidate = { id: "C1", artifactSnapshots: [{ id: "S1", sourceArtifactId: "guide", name: "guide.md", mimeType: "text/markdown", content, contentHash, frozenArtifact: { sourceArtifactId: "guide", snapshotHash: contentHash, blobId: "champion-guide", name: "guide.md", mimeType: "text/markdown", sha256, size: blob.size } }] };
  project.searchChampion = { id: "champion", versionLabel: "S1", candidate, validation: { status: "completed", recommendation: "release" }, artifactAcceptance: { status: "passed", candidateId: "C1" } } as unknown as EvolveProject["searchChampion"];
}

beforeEach(() => { blobs.clear(); vi.stubGlobal("crypto", webcrypto); });

describe("Server current-version stored evidence", () => {
  it("reads a renamed accepted Champion's static evidence in the next current-version cycle", async () => {
    const current = project();
    await storeSource(current, "ORIGINAL SOURCE GUIDE");
    await acceptChampion(current, "ACTUAL RENAMED CHAMPION GUIDE");
    const snapshot = current.searchChampion!.candidate!.artifactSnapshots[0]!;
    snapshot.name = snapshot.frozenArtifact!.name = "guide-evolved.md";
    const run = await runServerCurrentStoredEvidence({ project: current, testCase: testCase("static-evidence") });
    expect(run.verificationStatus, run.output).toBe("verified");
    expect(run.output).toContain("guide-evolved.md");
    expect(run.output).toContain("ACTUAL RENAMED CHAMPION GUIDE");
    expect(run.output).not.toContain("ORIGINAL SOURCE GUIDE");
    expect(run.artifactHash).toBe(snapshot.frozenArtifact!.sha256);
    const context = await buildServerCurrentSemanticArtifactContext({ project: current });
    expect(context[0]?.artifactSha256).toBe(run.artifactHash);
  });

  it("builds semantic context from actual Source and Champion bytes", async () => {
    const current = project();
    await storeSource(current, "ACTUAL SOURCE GUIDE");
    const sourceContext = await buildServerCurrentSemanticArtifactContext({ project: current });
    expect(sourceContext[0]?.content).toBe("ACTUAL SOURCE GUIDE");
    expect(JSON.stringify(sourceContext)).not.toContain("STALE PARSED INDEX");
    await acceptChampion(current, "ACTUAL CHAMPION GUIDE");
    const championContext = await buildServerCurrentSemanticArtifactContext({ project: current });
    expect(championContext[0]?.content).toBe("ACTUAL CHAMPION GUIDE");
    blobs.set("champion-guide", new NodeBlob(["TAMPERED CHAMPION TEXT"]) as Blob);
    await expect(buildServerCurrentSemanticArtifactContext({ project: current })).rejects.toThrow();
    blobs.delete("champion-guide");
    await expect(buildServerCurrentSemanticArtifactContext({ project: current })).rejects.toThrow();
  });

  it("reads an accepted DOCX Champion instead of its modification blueprint", async () => {
    const current = project("docx");
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:t>ACTUAL CURRENT DOCX</w:t>");
    const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
    const blob = new NodeBlob([bytes]) as Blob;
    const sha256 = await serverArtifactSha256(bytes);
    const content = "BLUEPRINT ONLY";
    const contentHash = await serverArtifactSha256(new TextEncoder().encode(content));
    blobs.set("champion-guide", blob);
    current.searchChampion = {
      id: "champion", versionLabel: "S1", validation: { status: "completed", recommendation: "release" }, artifactAcceptance: { status: "passed", candidateId: "C1" },
      candidate: { id: "C1", artifactSnapshots: [{ id: "S1", sourceArtifactId: "guide", name: "guide.docx", content, contentHash, frozenArtifact: { sourceArtifactId: "guide", snapshotHash: contentHash, blobId: "champion-guide", name: "guide.docx", sha256, size: blob.size } }] },
    } as unknown as EvolveProject["searchChampion"];
    const context = await buildServerCurrentSemanticArtifactContext({ project: current });
    expect(context[0]?.content).toContain("ACTUAL CURRENT DOCX");
    expect(JSON.stringify(context)).not.toContain("BLUEPRINT ONLY");
  });
  it("refuses missing uploaded bytes rather than sending a stale parsed index to AI", async () => {
    const current = project();
    current.sourceArtifacts[0]!.size = 12;
    await expect(buildServerCurrentSemanticArtifactContext({ project: current })).rejects.toThrow();
  });
  it("uses uploaded Source bytes for static text and roundtrip, ignoring stale parsed text", async () => {
    const current = project();
    await storeSource(current, "ACTUAL SOURCE GUIDE");
    const staticRun = await runServerCurrentStoredEvidence({ project: current, testCase: testCase("static-evidence") });
    expect(staticRun.verificationStatus, staticRun.output).toBe("verified");
    expect(staticRun.output).toContain("ACTUAL SOURCE GUIDE");
    expect(staticRun.output).not.toContain("STALE PARSED INDEX");
    const roundtrip = await runServerCurrentStoredEvidence({ project: current, testCase: testCase("roundtrip") });
    expect(roundtrip.verificationStatus, roundtrip.output).toBe("verified");
    expect(roundtrip.artifactHash).toBe(staticRun.artifactHash);
    blobs.delete("raw-guide");
    expect((await runServerCurrentStoredEvidence({ project: current, testCase: testCase("roundtrip") })).verificationStatus).toBe("unverified");
  });

  it("reads current Source ZIP bytes for static and bounded semantic code evidence", async () => {
    const current = project("zip");
    current.sourceArtifacts[0]!.artifactKind = "codebase";
    current.evolutionCommand = "Improve configuration setup";
    current.acceptanceRubric[0]!.requirement = "configuration setup implementation";
    const zipCase = { ...testCase("static-evidence"), title: "Configuration setup", input: "Check configuration setup implementation" };
    await storeSource(current, await codebaseZip("ACTUAL SOURCE ZIP"));
    const run = await runServerCurrentStoredEvidence({ project: current, testCase: zipCase });
    expect(run.verificationStatus, run.output).toBe("verified");
    expect(run.output).toContain("ACTUAL SOURCE ZIP");
    expect(run.output).not.toContain("STALE PARSED INDEX");
    const context = await buildServerCurrentSemanticArtifactContext({ project: current });
    expect(context[0]?.content).toContain("ACTUAL SOURCE ZIP");
    expect(context[0]?.truncated).toBe(true);
    blobs.delete("raw-guide");
    expect((await runServerCurrentStoredEvidence({ project: current, testCase: zipCase })).verificationStatus).toBe("unverified");
  });

  it("uses accepted Champion ZIP bytes instead of its overlay or Source ZIP", async () => {
    const current = project("zip");
    current.sourceArtifacts[0]!.artifactKind = "codebase";
    current.evolutionCommand = "Improve configuration setup";
    current.acceptanceRubric[0]!.requirement = "configuration setup implementation";
    await storeSource(current, await codebaseZip("OLD SOURCE ZIP"));
    const bytes = await codebaseZip("ACTUAL CHAMPION ZIP");
    const blob = new NodeBlob([bytes], { type: "application/zip" }) as Blob;
    const sha256 = await serverArtifactSha256(bytes);
    const content = '{"kind":"codebase-patch","files":[{"path":"src/config.ts","content":"OVERLAY ONLY"}]}';
    const contentHash = await serverArtifactSha256(new TextEncoder().encode(content));
    blobs.set("champion-guide", blob);
    current.searchChampion = {
      id: "champion", versionLabel: "S1", validation: { status: "completed", recommendation: "release" }, artifactAcceptance: { status: "passed", candidateId: "C1" },
      candidate: { id: "C1", artifactSnapshots: [{ id: "S1", sourceArtifactId: "guide", name: "guide.zip", content, contentHash,
        frozenArtifact: { sourceArtifactId: "guide", snapshotHash: contentHash, blobId: "champion-guide", name: "guide.zip", sha256, size: blob.size } }] },
    } as unknown as EvolveProject["searchChampion"];
    const context = await buildServerCurrentSemanticArtifactContext({ project: current });
    expect(context[0]?.content).toContain("ACTUAL CHAMPION ZIP");
    expect(JSON.stringify(context)).not.toContain("OLD SOURCE ZIP");
    expect(JSON.stringify(context)).not.toContain("OVERLAY ONLY");
    const zipCase = { ...testCase("static-evidence"), title: "Configuration setup", input: "Check configuration setup implementation" };
    const run = await runServerCurrentStoredEvidence({ project: current, testCase: zipCase });
    expect(run.verificationStatus, run.output).toBe("verified");
    expect(run.output).toContain("ACTUAL CHAMPION ZIP");
    blobs.set("champion-guide", new NodeBlob(["tampered bytes"]) as Blob);
    await expect(buildServerCurrentSemanticArtifactContext({ project: current })).rejects.toThrow();
  });
  it("extracts current PDF text from uploaded bytes for static and semantic evidence", async () => {
    const current = project("pdf");
    await storeSource(current, minimalTextPdf("ACTUAL PDF CONTENT"));
    const staticRun = await runServerCurrentStoredEvidence({ project: current, testCase: testCase("static-evidence") });
    expect(staticRun.verificationStatus, staticRun.output).toBe("verified");
    expect(staticRun.output).toContain("ACTUAL PDF CONTENT");
    const context = await buildServerCurrentSemanticArtifactContext({ project: current });
    expect(context[0]?.content).toContain("ACTUAL PDF CONTENT");
    expect((await runServerCurrentStoredEvidence({ project: current, testCase: testCase("roundtrip") })).verificationStatus).toBe("unverified");
    await storeSource(current, "%PDF-1.4 invalid");
    expect((await runServerCurrentStoredEvidence({ project: current, testCase: testCase("static-evidence") })).verificationStatus).toBe("unverified");
  });
  it("extracts uploaded DOCX bytes but does not claim unsupported binary roundtrip", async () => {
    const current = project("docx");
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:t>ACTUAL DOCX TEXT</w:t>");
    await storeSource(current, new Uint8Array(await zip.generateAsync({ type: "uint8array" })));
    expect((await runServerCurrentStoredEvidence({ project: current, testCase: testCase("static-evidence") })).output).toContain("ACTUAL DOCX TEXT");
    expect((await runServerCurrentStoredEvidence({ project: current, testCase: testCase("roundtrip") })).verificationStatus).toBe("unverified");
  });

  it("uses the accepted Champion Blob and refuses a stale or missing frozen file", async () => {
    const current = project();
    await storeSource(current, "OLD SOURCE");
    await acceptChampion(current, "ACTUAL CHAMPION GUIDE");
    const staticRun = await runServerCurrentStoredEvidence({ project: current, testCase: testCase("static-evidence") });
    expect(staticRun.verificationStatus, staticRun.output).toBe("verified");
    expect(staticRun.output).toContain("ACTUAL CHAMPION GUIDE");
    expect(staticRun.output).not.toContain("OLD SOURCE");
    expect((await runServerCurrentStoredEvidence({ project: current, testCase: testCase("roundtrip") })).verificationStatus).toBe("verified");
    blobs.set("champion-guide", new NodeBlob(["TAMPERED CHAMPION TEXT"]) as Blob);
    expect((await runServerCurrentStoredEvidence({ project: current, testCase: testCase("roundtrip") })).verificationStatus).toBe("unverified");
    blobs.delete("champion-guide");
    expect((await runServerCurrentStoredEvidence({ project: current, testCase: testCase("static-evidence") })).verificationStatus).toBe("unverified");
  });
});

it("reads a migrated local upload under its Source id without reconstructing the parsed index",async()=>{
  const current=project();const source=current.sourceArtifacts[0]!;
  const blob=await storeSource(current,"ACTUAL MIGRATED UPLOAD");
  source.inputMode="upload";source.storageRef=undefined;
  blobs.delete("raw-guide");blobs.set(source.id,blob);
  const roundtrip=await runServerCurrentStoredEvidence({project:current,testCase:testCase("roundtrip")});
  expect(roundtrip.verificationStatus,roundtrip.output).toBe("verified");
  expect((await buildServerCurrentSemanticArtifactContext({project:current}))[0]?.content).toBe("ACTUAL MIGRATED UPLOAD");
  source.storageRef="explicit-missing-binding";
  expect((await runServerCurrentStoredEvidence({project:current,testCase:testCase("roundtrip")})).verificationStatus).toBe("unverified");
  await expect(buildServerCurrentSemanticArtifactContext({project:current})).rejects.toThrow();
  source.storageRef=undefined;blobs.delete(source.id);
  expect((await runServerCurrentStoredEvidence({project:current,testCase:testCase("roundtrip")})).verificationStatus).toBe("unverified");
  await expect(buildServerCurrentSemanticArtifactContext({project:current})).rejects.toThrow();
});

it("uses the accepted Champion filename rather than requiring the original upload filename",async()=>{
  const current=project();await storeSource(current,"OLD SOURCE");
  await acceptChampion(current,"ACTUAL EVOLVED CHAMPION");
  const snapshot=current.searchChampion!.candidate!.artifactSnapshots[0]!;
  snapshot.name="guide-evolved.md";snapshot.frozenArtifact!.name=snapshot.name;
  const roundtrip=await runServerCurrentStoredEvidence({project:current,testCase:testCase("roundtrip")});
  expect(roundtrip.verificationStatus,roundtrip.output).toBe("verified");
  expect((await buildServerCurrentSemanticArtifactContext({project:current}))[0]?.content).toBe("ACTUAL EVOLVED CHAMPION");
  snapshot.frozenArtifact!.name="different-file.md";
  expect((await runServerCurrentStoredEvidence({project:current,testCase:testCase("roundtrip")})).verificationStatus).toBe("unverified");
  await expect(buildServerCurrentSemanticArtifactContext({project:current})).rejects.toThrow();
});
