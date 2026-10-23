import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSchema, TestCaseSchema, type EvolveProject } from "@evolution/contracts";
import { serverArtifactSha256 } from "./server-experiment-artifacts";
import { runServerFrozenArtifactStaticEvidence } from "./server-static-artifact-evidence";
import { minimalTextPdf } from "./pdf-test-fixture";

const blobs = vi.hoisted(() => new Map<string, Blob>());
const reads = vi.hoisted(() => ({ count: 0, second: undefined as Blob | undefined }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => {
  reads.count += 1;
  return reads.count === 2 && reads.second ? reads.second : blobs.get(id);
} }) }));

function project(extension: string): EvolveProject {
  return {
    id: "mission", evolutionCommand: "Improve guide",
    sourceArtifacts: [{ id: "guide", name: `guide.${extension}`, role: "target", artifactKind: "document", extension }],
    acceptanceRubric: [{ id: "STRUCT", requirement: "Guide text structure", artifactIds: ["guide"] }],
  } as unknown as EvolveProject;
}
const testCase = TestCaseSchema.parse({ id: "STATIC", title: "Guide structure", input: "Inspect final guide text", expected: ["final guide"], tags: [], hidden: true, criterionIds: ["STRUCT"], executionMode: "static-evidence", evidenceScope: "implementation" });

async function candidate(extension: string, blob: Blob, content = "BLUEPRINT ONLY") {
  const snapshotHash = await serverArtifactSha256(new TextEncoder().encode(content));
  const sha256 = await serverArtifactSha256(await blob.arrayBuffer());
  const blobId = `server-candidate:${sha256}`;
  blobs.set(blobId, blob);
  return CandidateSchema.parse({ id: "C1", name: "Guide", change: "Improve guide", artifactSnapshots: [{
    id: "snapshot", sourceArtifactId: "guide", name: `guide.${extension}`, mimeType: blob.type, content,
    contentHash: snapshotHash, createdAt: "2026-09-27T00:00:00.000Z",
    frozenArtifact: { sourceArtifactId: "guide", snapshotHash, blobId, name: `guide.${extension}`, mimeType: blob.type, sha256, size: blob.size, verifiedAt: "2026-09-27T00:00:00.000Z", checks: ["materialized"], limitations: [] },
  }] });
}

async function ooxml(path: string, xml: string) {
  const zip = new JSZip();
  zip.file(path, xml);
  return new NodeBlob([new Uint8Array(await zip.generateAsync({ type: "uint8array" }))], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }) as Blob;
}

beforeEach(() => {
  blobs.clear();
  reads.count = 0;
  reads.second = undefined;
  vi.stubGlobal("crypto", webcrypto);
});

describe("Server frozen Artifact static evidence", () => {
  it("retains complete large HTML document text when the accepted Champion becomes a later Baseline",async()=>{
    const content=`<html><head><style>${".layout{color:red}".repeat(3000)}</style></head><body><h1>真实候选全文</h1><p>${"正文中的步骤、配置与回退说明。".repeat(1200)}</p><p>FINAL-CURRENT-CHAMPION-TEXT</p><script>UNEXECUTED_CODE</script></body></html>`;
    const variant=await candidate("html",new NodeBlob([content],{type:"text/html"}) as Blob,content);
    const run=await runServerFrozenArtifactStaticEvidence({project:project("html"),candidate:variant,testCase});
    expect(run.verificationStatus).toBe("verified");
    expect(run.artifactHash).toBe(variant.artifactSnapshots[0]!.frozenArtifact!.sha256);
    expect(run.output).toContain("FINAL-CURRENT-CHAMPION-TEXT");
    expect(run.output).toContain("静态文本投影");
    expect(run.output).not.toContain("UNEXECUTED_CODE");
  });

  it.each(["md", "docx"])("extracts a legitimately renamed %s Candidate from its exact frozen bytes", async (extension) => {
    const content = "ACTUAL RENAMED FINAL GUIDE";
    const blob = extension === "docx" ? await ooxml("word/document.xml", '<w:t>ACTUAL RENAMED FINAL GUIDE</w:t>') : new NodeBlob([content], { type: "text/markdown" }) as Blob;
    const variant = await candidate(extension, blob, extension === "md" ? content : "BLUEPRINT ONLY");
    const snapshot = variant.artifactSnapshots[0]!;
    snapshot.name = snapshot.frozenArtifact!.name = `guide-evolved.${extension}`;
    const run = await runServerFrozenArtifactStaticEvidence({ project: project(extension), candidate: variant, testCase });
    expect(run.verificationStatus, run.output).toBe("verified");
    expect(run.artifactHash).toBe(snapshot.frozenArtifact!.sha256);
    expect(run.output).toContain(snapshot.name);
    expect(run.output).toContain(content);
    expect(run.output).not.toContain("BLUEPRINT ONLY");
  });
  it.each(["name", "mimeType", "sourceArtifactId"] as const)("refuses changed frozen receipt %s before extracting bytes", async (field) => {
    const variant = await candidate("md", new NodeBlob(["REAL FINAL GUIDE"], { type: "text/markdown" }) as Blob, "REAL FINAL GUIDE");
    variant.artifactSnapshots[0]!.frozenArtifact![field] = "wrong-binding";
    const run = await runServerFrozenArtifactStaticEvidence({ project: project("md"), candidate: variant, testCase });
    expect(run.verificationStatus).toBe("unverified");
    expect(reads.count).toBe(0);
  });

  it("extracts final DOCX text from frozen bytes instead of the change blueprint", async () => {
    const blob = await ooxml("word/document.xml", '<w:document xmlns:w="w"><w:p><w:r><w:t>REAL FROZEN GUIDE TEXT</w:t></w:r></w:p></w:document>');
    const variant = await candidate("docx", blob);
    const run = await runServerFrozenArtifactStaticEvidence({ project: project("docx"), candidate: variant, testCase });
    expect(run.verificationStatus, run.output).toBe("verified");
    expect(run.artifactHash).toBe(variant.artifactSnapshots[0]!.frozenArtifact!.sha256);
    expect(run.output).toContain("REAL FROZEN GUIDE TEXT");
    expect(run.output).not.toContain("BLUEPRINT ONLY");
  });

  it("reads the final PPTX slide and XLSX cell content", async () => {
    const pptx = await ooxml("ppt/slides/slide1.xml", '<p:sld xmlns:a="a"><a:t>REAL FROZEN SLIDE</a:t></p:sld>');
    const slideVariant = await candidate("pptx", pptx);
    expect((await runServerFrozenArtifactStaticEvidence({ project: project("pptx"), candidate: slideVariant, testCase })).output).toContain("REAL FROZEN SLIDE");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["REAL FROZEN CELL"]]), "Sheet1");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const sheetVariant = await candidate("xlsx", new NodeBlob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }) as Blob);
    const sheet = await runServerFrozenArtifactStaticEvidence({ project: project("xlsx"), candidate: sheetVariant, testCase });
    expect(sheet.verificationStatus, sheet.output).toBe("verified");
    expect(sheet.output).toContain("A1: REAL FROZEN CELL");
  });

  it("rejects a Blob swapped between verification and extraction", async () => {
    const blob = await ooxml("word/document.xml", "<w:t>ORIGINAL</w:t>");
    const variant = await candidate("docx", blob);
    reads.second = new NodeBlob(["X".repeat(blob.size)], { type: blob.type }) as Blob;
    const run = await runServerFrozenArtifactStaticEvidence({ project: project("docx"), candidate: variant, testCase });
    expect(reads.count).toBe(2);
    expect(run.verificationStatus).toBe("unverified");
    expect(run.output).toContain("字节已变化");
  });

  it("keeps truncated text partial and cross-artifact scope unverified", async () => {
    const longText = "Guide section. ".repeat(3000);
    const variant = await candidate("md", new NodeBlob([longText], { type: "text/markdown" }) as Blob, longText);
    const truncated = await runServerFrozenArtifactStaticEvidence({ project: project("md"), candidate: variant, testCase });
    expect(truncated.verificationStatus).toBe("partial");
    expect(truncated.output).toContain("超过输出预算");
    const mixed = project("md");
    mixed.sourceArtifacts.push({ ...mixed.sourceArtifacts[0]!, id: "second", name: "second.md" });
    mixed.acceptanceRubric[0]!.artifactIds = ["guide", "second"];
    const cross = await runServerFrozenArtifactStaticEvidence({ project: mixed, candidate: variant, testCase });
    expect(cross.verificationStatus).toBe("unverified");
    expect(cross.output).toContain("跨成果证据");
  });
  it("reads actual frozen PDF text and rejects image-only or corrupt PDFs", async () => {
    const bytes = minimalTextPdf("ACTUAL FROZEN PDF");
    const variant = await candidate("pdf", new NodeBlob([bytes], { type: "application/pdf" }) as Blob);
    const run = await runServerFrozenArtifactStaticEvidence({ project: project("pdf"), candidate: variant, testCase });
    expect(run.verificationStatus, run.output).toBe("verified");
    expect(run.output).toContain("ACTUAL FROZEN PDF");
    expect(run.output).not.toContain("BLUEPRINT ONLY");
    const corrupt = await candidate("pdf", new NodeBlob(["%PDF-1.4 invalid"], { type: "application/pdf" }) as Blob);
    expect((await runServerFrozenArtifactStaticEvidence({ project: project("pdf"), candidate: corrupt, testCase })).verificationStatus).toBe("unverified");
  },15_000);

  it("keeps product behavior partial and unsupported empty PDF unverified", async () => {
    const variant = await candidate("md", new NodeBlob(["REAL FINAL GUIDE"], { type: "text/markdown" }) as Blob, "REAL FINAL GUIDE");
    const behavior = TestCaseSchema.parse({ ...testCase, evidenceScope: "product-behavior" });
    expect((await runServerFrozenArtifactStaticEvidence({ project: project("md"), candidate: variant, testCase: behavior })).verificationStatus).toBe("partial");
    const pdfVariant = await candidate("pdf", new NodeBlob(["%PDF-1.7"], { type: "application/pdf" }) as Blob);
    expect((await runServerFrozenArtifactStaticEvidence({ project: project("pdf"), candidate: pdfVariant, testCase })).verificationStatus).toBe("unverified");
  });
});
