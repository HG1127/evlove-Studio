import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSchema, TestCaseSchema, type EvolveProject } from "@evolution/contracts";
import { serverArtifactSha256 } from "./server-experiment-artifacts";
import { runServerFrozenCodebaseStaticEvidence } from "./server-static-codebase-evidence";

const blobs = vi.hoisted(() => new Map<string, Blob>());
const storageRead = vi.hoisted(() => ({ count: 0, second: undefined as Blob | undefined }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => {
  storageRead.count += 1;
  return storageRead.count === 2 && storageRead.second ? storageRead.second : blobs.get(id);
} }) }));

const testCase = TestCaseSchema.parse({
  id: "STATIC-CONFIG", title: "Configuration setup", input: "Check configuration setup implementation",
  expected: ["configuration setup"], tags: [], hidden: true, criterionIds: ["CONFIG"],
  executionMode: "static-evidence", evidenceScope: "implementation",
});

function project(): EvolveProject {
  return {
    id: "mission", evolutionCommand: "Improve configuration setup",
    sourceArtifacts: [{ id: "repo", name: "repo.zip", role: "target", artifactKind: "codebase", extension: "zip" }],
    acceptanceRubric: [{ id: "CONFIG", requirement: "Configuration setup implementation", artifactIds: ["repo"] }],
  } as unknown as EvolveProject;
}

async function candidate(configText = "NEW CANDIDATE CONFIGURATION") {
  const zip = new JSZip();
  zip.file("package.json", JSON.stringify({ name: "candidate-config", version: "1.0.0" }));
  zip.file("src/config.ts", `export function configureProject() { return "configuration setup ${configText}"; }`);
  zip.file("src/setup.ts", `export function setupProject() { return "setup configuration ${configText}"; }`);
  zip.file("README.md", `Configuration setup steps: ${configText}`);
  const blob = new NodeBlob([new Uint8Array(await zip.generateAsync({ type: "uint8array" }))], { type: "application/zip" });
  const content = JSON.stringify({ kind: "codebase", overlay: true, files: [{ path: "src/config.ts", content: "overlay only" }] });
  const contentHash = await serverArtifactSha256(new TextEncoder().encode(content));
  const sha256 = await serverArtifactSha256(await blob.arrayBuffer());
  const blobId = `server-candidate:${sha256}`;
  blobs.set(blobId, blob as Blob);
  const variant = CandidateSchema.parse({ id: "C1", name: "Setup", change: "Improve setup", artifactSnapshots: [{
    id: "snapshot", sourceArtifactId: "repo", name: "repo.zip", mimeType: "application/zip", content,
    contentHash, createdAt: "2026-09-27T00:00:00.000Z",
    frozenArtifact: { sourceArtifactId: "repo", snapshotHash: contentHash, blobId, name: "repo.zip", mimeType: "application/zip", sha256, size: blob.size, verifiedAt: "2026-09-27T00:00:00.000Z", checks: ["zip"], limitations: [] },
  }] });
  return { variant, blob, blobId };
}

beforeEach(() => {
  blobs.clear();
  storageRead.count = 0;
  storageRead.second = undefined;
  vi.stubGlobal("crypto", webcrypto);
});

describe("Server frozen codebase static evidence", () => {
  it("indexes the exact frozen ZIP instead of Candidate overlay text", async () => {
    const { variant } = await candidate();
    const run = await runServerFrozenCodebaseStaticEvidence({ project: project(), candidate: variant, testCase });

    expect(run.verificationStatus, run.output).toBe("verified");
    expect(run.artifactHash).toBe(variant.artifactSnapshots[0]!.frozenArtifact!.sha256);
    expect(run.output).toContain("NEW CANDIDATE CONFIGURATION");
    expect(run.output).not.toContain("overlay only");
  });

  it("rejects changed Blob bytes and a Candidate Snapshot whose content changed", async () => {
    const { variant, blobId } = await candidate();
    blobs.set(blobId, new NodeBlob(["tampered bytes"]) as Blob);
    expect((await runServerFrozenCodebaseStaticEvidence({ project: project(), candidate: variant, testCase })).verificationStatus).toBe("unverified");
    const valid = await candidate();
    const changed = CandidateSchema.parse({ ...valid.variant, artifactSnapshots: [{ ...valid.variant.artifactSnapshots[0]!, content: "changed overlay" }] });
    expect((await runServerFrozenCodebaseStaticEvidence({ project: project(), candidate: changed, testCase })).verificationStatus).toBe("unverified");
  });

  it("rejects a Blob that changes between receipt validation and indexing", async () => {
    const { variant, blob } = await candidate();
    storageRead.second = new NodeBlob(["X".repeat(blob.size)], { type: "application/zip" }) as Blob;
    const run = await runServerFrozenCodebaseStaticEvidence({ project: project(), candidate: variant, testCase });
    expect(storageRead.count).toBe(2);
    expect(run.verificationStatus).toBe("unverified");
    expect(run.output).toContain("字节已变化");
  });
  it("does not verify a cross-artifact Criterion from only one ZIP", async () => {
    const { variant } = await candidate();
    const mixed = project();
    mixed.sourceArtifacts.push({ ...mixed.sourceArtifacts[0]!, id: "guide", name: "guide.md", artifactKind: "document", extension: "md" });
    mixed.acceptanceRubric[0]!.artifactIds = ["repo", "guide"];
    const run = await runServerFrozenCodebaseStaticEvidence({ project: mixed, candidate: variant, testCase });
    expect(run.verificationStatus).toBe("unverified");
    expect(run.output).toContain("多个 Target");
  });
  it("does not promote static source evidence into product behavior verification", async () => {
    const { variant } = await candidate();
    const behavior = TestCaseSchema.parse({ ...testCase, evidenceScope: "product-behavior" });
    const run = await runServerFrozenCodebaseStaticEvidence({ project: project(), candidate: variant, testCase: behavior });
    expect(run.verificationStatus).toBe("partial");
  });
});