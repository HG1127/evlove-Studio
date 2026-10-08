import { createHash } from "node:crypto";
import JSZip from "jszip";
import { SandboxHtmlValidationRequestSchema, SandboxTargetBatchResponseSchema, type SandboxHtmlValidationRequest } from "@evolution/contracts";
import { runVercelSandboxCodebaseValidation } from "./vercel-sandbox-adapter";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Execute the exact standalone HTML inside the existing isolated browser runtime. */
export async function runVercelSandboxHtmlValidation(raw: SandboxHtmlValidationRequest) {
  const args = SandboxHtmlValidationRequestSchema.parse(raw);
  const html = new Uint8Array(args.html);
  const artifactHash = hash(html);
  if (artifactHash !== args.expectedSha256.toLowerCase()) {
    return SandboxTargetBatchResponseSchema.parse({ artifactHash, scriptsRun: [], results: args.testCases.map((testCase) => ({
      testCaseId: testCase.id, output: "SANDBOX BLOCKED：HTML SHA-256 与请求绑定值不一致。", latencyMs: 0, cost: 0, artifactHash, verificationStatus: "failed", error: "artifact hash mismatch", trace: [],
    })) });
  }
  // dist is a recognized static preview root and contains only the public HTML.
  // Runtime/Hidden files stay outside that root. The package has no user scripts.
  // index.html is
  // copied as bytes; it is never reconstructed from a parser index or model output.
  const zip = new JSZip();
  zip.file("dist/index.html", html);
  zip.file("package.json", JSON.stringify({ name: "evolution-standalone-html", version: "1.0.0", private: true }));
  const archive = await zip.generateAsync({ type: "uint8array" });
  const transportHash = hash(archive);
  const response = SandboxTargetBatchResponseSchema.parse(await runVercelSandboxCodebaseValidation({ id: args.id, archive, expectedSha256: transportHash, testCases: args.testCases }));
  if (response.artifactHash !== transportHash || response.results.some((run) => run.artifactHash !== transportHash)) {
    throw new Error("Sandbox HTML transport receipt is not bound to the exact wrapper ZIP.");
  }
  return SandboxTargetBatchResponseSchema.parse({ ...response, artifactHash, results: response.results.map((run) => ({
    ...run, artifactHash,
    output: run.output.replaceAll(transportHash, artifactHash),
    trace: [...run.trace, { id: "sandbox-html-binding", stage: "sandbox-artifact", status: "pass", summary: "原 HTML 字节已完整复制进入隔离浏览器；交付身份仍绑定原文件", detail: `HTML SHA-256: ${artifactHash}; transport ZIP SHA-256: ${transportHash}` }],
  })) });
}
