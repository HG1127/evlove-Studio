import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it } from "vitest";
import { SourceArtifactSchema, TestCaseSchema, type CandidateArtifactSnapshot, type EvolveProject } from "@evolution/contracts";
import { verifyGeneratedArtifact } from "./artifact-output-builders";
import { runRoundtripEvidence } from "./static-evidence";

function source(extension: string, content: string) {
  return SourceArtifactSchema.parse({ id: "source", name: `file.${extension}`, extension, mimeType: extension === "json" ? "application/json" : extension === "md" ? "text/markdown" : "text/html", artifactKind: "document", role: "target", size: Buffer.byteLength(content), inputMode: "paste", textContent: content, parseStatus: "ready", createdAt: "2026-10-09T00:00:00.000Z" });
}
describe("browser exact UTF-8 Artifact verification", () => {
  it.each([['html', '\ufeff<html><body>完整原文 😀\r\n</body></html>'], ['json', '\ufeff{\r\n"value":"原文"\r\n}']])("reopens %s without discarding its leading BOM", async (extension, content) => {
    const input = source(extension, content);
    const snapshot: CandidateArtifactSnapshot = { id: "snapshot", sourceArtifactId: input.id, name: input.name, mimeType: input.mimeType, content, createdAt: input.createdAt, buildMode: "deterministic" as const, notes: [] };
    const blob = new NodeBlob([content], { type: input.mimeType }) as Blob;
    await expect(verifyGeneratedArtifact(input, snapshot, blob)).resolves.toMatchObject({ checks: expect.arrayContaining(["实际文本与候选内容逐字一致"]) });
    await expect(verifyGeneratedArtifact(input, snapshot, new NodeBlob([content.slice(1)]) as Blob)).rejects.toThrow("不一致");
  });
  it("keeps canonical pasted plain text BOM roundtrip verified", async () => {
    const input = source("md", "\ufeff# 完整原文\r\n😀 é\r\n");
    const project = { sourceArtifacts: [input] } as unknown as EvolveProject;
    const testCase = TestCaseSchema.parse({ id: "roundtrip", title: "文本往返", input: "逐字核对", expected: [], tags: [], hidden: true, criterionIds: [], executionMode: "roundtrip", evidenceScope: "implementation" });
    expect((await runRoundtripEvidence(project, testCase)).verificationStatus).toBe("verified");
  });
});