import type { EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { trustedServerBaselineChampion } from "@evolution/harness";
import { getServerArtifactStore } from "./artifact-runtime";
import { serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";
import { extractServerStaticArtifactText, runServerFrozenArtifactStaticEvidence, serverStaticTextExtension } from "./server-static-artifact-evidence";
import { indexServerCodebaseZip } from "./server-codebase-zip-index";
import { buildServerCodebaseStaticRun } from "./server-static-codebase-evidence";
import {requiresIndependentFormatValidation} from "@evolution/core";
import {hasServerNativeRoundtrip,inspectServerNativeFormat} from "./server-native-format-roundtrip";
import {serverStaticArtifactReviewText} from "./server-static-review-text";

const MAX_FILE_BYTES = 12_000_000;
const MAX_OUTPUT_CHARS = 28_000;

function unavailable(testCase: TestCase, detail: string): TargetRunResult {
  return {
    testCaseId: testCase.id, output: `UNVERIFIED：${detail}`, latencyMs: 0, cost: 0,
    verificationStatus: "unverified",
    trace: [{ id: `server-current-file-${testCase.id}`, stage: testCase.executionMode, summary: "当前版本实际文件证据不可用", status: "warning", detail }],
  };
}

/** Reads the exact current version: an accepted Champion's frozen Blob, or the original uploaded Source Blob. */
export async function runServerCurrentStoredEvidence({ project, testCase }: { project: EvolveProject; testCase: TestCase }): Promise<TargetRunResult> {
  if (testCase.criterionIds.length && testCase.criterionIds.every((id) => id === "SYS-PAIRWISE")) return unavailable(testCase, "原版不能独立证明 Pairwise 相对改进。");
  const scopedIds = new Set(project.acceptanceRubric.filter((criterion) => testCase.criterionIds.includes(criterion.id)).flatMap((criterion) => criterion.artifactIds));
  const targets = project.sourceArtifacts.filter((source) => source.role === "target" && (!scopedIds.size || scopedIds.has(source.id)));
  if (targets.length !== 1 || (scopedIds.size && scopedIds.size !== 1)) return unavailable(testCase, "题目没有唯一的当前版本 Target，不能从单个文件推断跨成果结论。");
  const source = targets[0]!;
  const extension = source.extension.toLowerCase();
  const champion = project.searchChampion ? trustedServerBaselineChampion(project) : undefined;
  if (project.searchChampion && !champion) return unavailable(testCase, "当前 Search Champion 尚未通过可信验收，不能回退原 Source 作为当前版本。");
  const snapshots = champion?.artifactSnapshots.filter((snapshot) => snapshot.sourceArtifactId === source.id) ?? [];
  if (champion && snapshots.length !== 1) return unavailable(testCase, "当前 Search Champion 缺少唯一的 Target Snapshot。");
  const snapshot = snapshots[0];
  if (champion && testCase.executionMode === "static-evidence") {
    return runServerFrozenArtifactStaticEvidence({ project, candidate: champion, testCase });
  }
  const receipt = snapshot?.frozenArtifact;
  if (champion && (!receipt || receipt.sourceArtifactId !== source.id || receipt.name !== snapshot?.name)) {
    return unavailable(testCase, "当前 Search Champion 缺少对应 Target 的冻结文件凭证。");
  }
  const blobId = receipt?.blobId ?? (source.storageRef?.trim() || (source.inputMode === "upload" ? source.id : undefined));
  if (!blobId) return unavailable(testCase, "当前 Source 没有实际上传文件引用。");
  try {
    if (snapshot && !await verifyServerCandidateFrozenArtifact(snapshot)) return unavailable(testCase, "当前 Search Champion 冻结文件校验失败。");
    const blob = await getServerArtifactStore().get(blobId);
    if (!blob || blob.size > (extension === "zip" ? 25_000_000 : MAX_FILE_BYTES) || blob.size !== (receipt?.size ?? source.size)) return unavailable(testCase, "当前文件缺失、大小不一致或超出索引范围。");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength !== blob.size) return unavailable(testCase, "当前文件读取大小发生变化。");
    const sha256 = await serverArtifactSha256(bytes);
    if (receipt && sha256 !== receipt.sha256) return unavailable(testCase, "当前 Search Champion 冻结字节 SHA-256 不一致。");
    if (testCase.executionMode === "roundtrip") {
      if(testCase.evidenceScope==="product-behavior")return unavailable(testCase,
        "格式往返只证明字节/结构；实际产品行为必须由独立 Runner 验证。");
      if(requiresIndependentFormatValidation(extension)&&!hasServerNativeRoundtrip(extension)){
        return unavailable(testCase,`${extension.toUpperCase()} 尚未接入独立语法/结构往返校验器，不能仅凭 UTF-8 字节相同标记 VERIFIED。`);
      }
      if(hasServerNativeRoundtrip(extension)){
        // A proper format check must read/parse *current stored bytes*, not the
        // Candidate's JSON delta. Formatted data never equals that JSON text.
        const detail=await inspectServerNativeFormat({source,bytes,snapshot});
        return {
          testCaseId:testCase.id,
          output:`CURRENT NATIVE FORMAT ROUNDTRIP · SHA-256 ${sha256}\n${source.name}\n${detail}\n这是原生格式结构证据，不能作为视觉、公式重算或运行行为证据。`,
          latencyMs:0,cost:0,verificationStatus:"verified",artifactHash:sha256,
          trace:[{id:`server-current-native-${testCase.id}`,stage:"format-roundtrip",
            summary:"已从实际 Source/Champion 字节验证原生格式",status:"pass",
            detail:JSON.stringify([source.id,blobId,sha256,extension])}],
        };
      }
      if (!serverStaticTextExtension(extension)) return unavailable(testCase, "此格式尚无 Server 当前版本解析→物化→逐字节往返验证器。");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const encoded = new TextEncoder().encode(text);
      if (encoded.length !== bytes.length || encoded.some((value, index) => value !== bytes[index])) return unavailable(testCase, "当前文件 UTF-8 编解码未保持原始字节。");
      if (snapshot && text !== snapshot.content) return unavailable(testCase, "当前 Search Champion 文本 Blob 与 Snapshot 内容不一致。");
      return {
        testCaseId: testCase.id, output: `CURRENT FILE TEXT ROUNDTRIP · SHA-256 ${sha256}\n${source.name} · ${bytes.length} bytes\nServer 从当前版本实际文件读取 UTF-8，重新编码并逐字节比较。`,
        latencyMs: 0, cost: 0, verificationStatus: "verified", artifactHash: sha256,
        trace: [{ id: `server-current-file-${testCase.id}`, stage: "format-roundtrip", summary: "当前版本实际文本字节往返一致", status: "pass", detail: JSON.stringify([source.id, blobId, sha256]) }],
      };
    }
    if (testCase.executionMode !== "static-evidence") return unavailable(testCase, "此执行模式不支持当前文件静态证据。");
    if (extension === "zip") {
      const index = await indexServerCodebaseZip(bytes);
      return buildServerCodebaseStaticRun({ index, project, testCase, sha256, currentSource: true });
    }
    const text = await extractServerStaticArtifactText(extension, bytes);
    if (!text?.trim()) return unavailable(testCase, "当前文件没有受支持的静态文本索引。");
    const reviewText=serverStaticArtifactReviewText(extension,text,MAX_OUTPUT_CHARS);
    const complete = reviewText.length <= MAX_OUTPUT_CHARS;
    const status: TargetRunResult["verificationStatus"] = complete && testCase.evidenceScope !== "product-behavior" ? "verified" : "partial";
    return {
      testCaseId: testCase.id,
      output: `CURRENT SOURCE FILE STATIC EVIDENCE · SHA-256 ${sha256}\n${source.name} · ${extension}\n${reviewText.slice(0, MAX_OUTPUT_CHARS)}\n${complete ? "已从实际上传文件读取受支持的静态文本索引。" : "文本索引超过输出预算，仅展示前段。"}\n静态证据不能证明真实交互、公式重算或视觉保真。`,
      latencyMs: 0, cost: 0, verificationStatus: status, artifactHash: sha256,
      trace: [{ id: `server-current-file-${testCase.id}`, stage: "static-evidence", summary: "从当前 Source 文件字节建立静态索引", status: "pass", detail: JSON.stringify([source.id, blobId, sha256]) }],
    };
  } catch (error) {
    return unavailable(testCase, `当前版本文件证据解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
