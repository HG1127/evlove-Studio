import {OriginalArtifactReferenceProofSchema,type OriginalArtifactReferenceProof,type EvolveProject,type TestCase} from "@evolution/contracts";
import { compactServerSourceText, htmlSnapshotReview, serverSemanticContextQuery, trustedServerBaselineChampion } from "@evolution/harness";
import { getServerArtifactStore } from "./artifact-runtime";
import { serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";
import { extractServerStaticArtifactText } from "./server-static-artifact-evidence";
import { indexServerCodebaseZip, rankServerCodebaseFiles } from "./server-codebase-zip-index";

const MAX_FILE_BYTES = 12_000_000;
const MAX_TOTAL_CHARS = 56_000;
const MAX_ARTIFACT_CHARS = 18_000;
const MAX_HTML_TEXT_CHARS = 28_000;
async function codebaseSemanticText(bytes: Uint8Array, project: EvolveProject) {
  const index = await indexServerCodebaseZip(bytes);
  const query = [project.goal, project.evolutionCommand, ...project.acceptanceRubric.map((criterion) => criterion.requirement)].join(" ");
  const selected = rankServerCodebaseFiles(index, query).filter((entry) => entry.code).slice(0, 12);
  if (!selected.length) throw new Error("当前代码 ZIP 没有可定位的实现文件。");
  return [
    `CODEBASE ZIP STATIC CONTEXT: ${index.fileCount} entries, ${index.textFiles.length} fully indexed text files.`,
    ...selected.map((entry) => `--- ${entry.path} · relevance=${entry.score} ---\n${entry.content.slice(0, 3_600)}`),
    "这是实际 ZIP 的静态源码摘录，不能证明构建或运行行为。",
  ].join("\n\n");
}

/** Construct AI context from the same current bytes used by deterministic evidence. */
export async function buildServerCurrentSemanticArtifactContext({ project, testCases = project.evalSuite }: { project: EvolveProject; testCases?: TestCase[] }): Promise<Array<Record<string, unknown>>> {
  const champion = project.searchChampion ? trustedServerBaselineChampion(project) : undefined;
  if (project.searchChampion && !champion) throw new Error("当前 Search Champion 尚未通过可信验收。");
  const ordered = [...project.sourceArtifacts].sort((a, b) => Number(b.role === "target") - Number(a.role === "target"));
  if (!ordered.length || ordered.length > 12 || new Set(ordered.map((source) => source.id)).size !== ordered.length) {
    throw new Error("当前版本成果数量为空、重复或超出语义索引范围。");
  }
  const store = getServerArtifactStore();
  const query = serverSemanticContextQuery(project, testCases);
  let remaining = MAX_TOTAL_CHARS;
  const context: Array<Record<string, unknown>> = [];
  for (const source of ordered) {
    const snapshots = source.role === "target" ? champion?.artifactSnapshots.filter((snapshot) => snapshot.sourceArtifactId === source.id) ?? [] : [];
    if (champion && source.role === "target" && snapshots.length !== 1) throw new Error(`${source.name} 缺少唯一的当前 Champion Snapshot。`);
    const snapshot = snapshots[0];
    const receipt = snapshot?.frozenArtifact;
    if (snapshot && (!receipt || receipt.sourceArtifactId !== source.id || receipt.name !== snapshot?.name)) {
      throw new Error(`${source.name} 缺少正确的 Champion 冻结文件凭证。`);
    }
    let content: string;
    let sha256: string | undefined;
    let originalReference:OriginalArtifactReferenceProof|undefined;
    const blobId = receipt?.blobId ?? (source.storageRef?.trim() || (source.inputMode === "upload" ? source.id : undefined));
    if (blobId) {
      if (snapshot && !await verifyServerCandidateFrozenArtifact(snapshot)) throw new Error(`${source.name} 的 Champion 冻结凭证与文件不一致。`);
      const blob = await store.get(blobId);
      if (!blob || blob.size > (source.extension.toLowerCase() === "zip" ? 25_000_000 : MAX_FILE_BYTES) || blob.size !== (receipt?.size ?? source.size)) throw new Error(`${source.name} 的当前文件缺失、大小不一致或超出索引范围。`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength !== blob.size) throw new Error(`${source.name} 的当前文件读取大小已变化。`);
      sha256 = await serverArtifactSha256(bytes);
      if (receipt && sha256 !== receipt.sha256) throw new Error(`${source.name} 的当前 Champion Blob 已变化。`);
      if(!snapshot&&source.role==="target"&&/^(html|htm)$/i.test(source.extension)&&store.getMetadata){
        // A failed metadata read cannot establish a comparison reference; content observation remains separate.
        const metadata=await store.getMetadata(blobId).catch(()=>undefined);
        if(metadata&&(metadata.id!==blobId||metadata.sha256!==sha256||metadata.sizeBytes!==bytes.byteLength)){
          throw new Error(`${source.name} 的原版元数据与实际文件字节不一致。`);
        }
        if(metadata&&metadata.id===blobId&&metadata.missionId===project.id&&metadata.kind==="source"
          &&metadata.sha256===sha256&&metadata.sizeBytes===bytes.byteLength){
          originalReference=OriginalArtifactReferenceProofSchema.parse({schemaVersion:"original-artifact-reference-v1",
            missionId:project.id,sourceArtifactId:source.id,blobId,sha256,sizeBytes:bytes.byteLength});
        }
      }
      const extracted = source.extension.toLowerCase() === "zip"
        ? await codebaseSemanticText(bytes, project)
        : await extractServerStaticArtifactText(source.extension.toLowerCase(), bytes);
      if (!extracted?.trim()) throw new Error(`${source.name} 尚无可读取的当前文件语义索引。`);
      content = extracted;
    } else {
      if (source.inputMode !== "paste" || !source.textContent?.trim()) throw new Error(`${source.name} 缺少实际文件或完整粘贴正文。`);
      content = source.textContent;
    }
    const allowance = Math.max(0, Math.min(MAX_ARTIFACT_CHARS, remaining));
    const html = /^(html|htm)$/i.test(source.extension) || /^text\/html(?:;|$)/i.test(receipt?.mimeType ?? source.mimeType);
    const review=html&&content.length>allowance?htmlSnapshotReview(content):undefined;
    const projection=review?`${review.summary}\n正文全文（静态文本投影）：\n${review.text}\n证据边界：正文投影不包含脚本、样式、视觉和实际交互；这些必须独立验证。`:undefined;
    const completeProjection=Boolean(projection&&projection.length<=Math.min(remaining,MAX_HTML_TEXT_CHARS));
    const bounded = completeProjection?projection!:compactServerSourceText(content, query, allowance, html);
    remaining -= bounded.length;
    context.push({
      id: source.id, name: source.name, role: source.role, mimeType: source.mimeType,
      artifactKind: source.artifactKind, extension: source.extension, content: bounded,
      currentVersion: snapshot ? (project.searchChampion?.versionLabel ?? champion?.id) : project.version,
      snapshotHash: snapshot?.contentHash, artifactSha256: sha256,
      ...(originalReference?{originalReference}:{}),
      originalChars: content.length, truncated: completeProjection?false:bounded !== content || source.extension.toLowerCase() === "zip",
      ...(completeProjection?{contextRepresentation:"complete-html-static-text-projection",projectionChars:review!.text.length,
        excludes:["scripts","styles","visual-fidelity","runtime-behavior"]}:{}),
    });
  }
  return context;
}
