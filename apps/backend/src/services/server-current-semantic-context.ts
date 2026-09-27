import type { EvolveProject } from "@evolution/contracts";
import { trustedServerBaselineChampion } from "@evolution/harness";
import { getServerArtifactStore } from "./artifact-runtime";
import { serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";
import { extractServerStaticArtifactText } from "./server-static-artifact-evidence";

const MAX_FILE_BYTES = 12_000_000;
const MAX_TOTAL_CHARS = 56_000;
const MAX_ARTIFACT_CHARS = 18_000;

/** Construct AI context from the same current bytes used by deterministic evidence. */
export async function buildServerCurrentSemanticArtifactContext({ project }: { project: EvolveProject }): Promise<Array<Record<string, unknown>>> {
  const champion = project.searchChampion ? trustedServerBaselineChampion(project) : undefined;
  if (project.searchChampion && !champion) throw new Error("当前 Search Champion 尚未通过可信验收。");
  const ordered = [...project.sourceArtifacts].sort((a, b) => Number(b.role === "target") - Number(a.role === "target"));
  if (!ordered.length || ordered.length > 12 || new Set(ordered.map((source) => source.id)).size !== ordered.length) {
    throw new Error("当前版本成果数量为空、重复或超出语义索引范围。");
  }
  const store = getServerArtifactStore();
  let remaining = MAX_TOTAL_CHARS;
  const context: Array<Record<string, unknown>> = [];
  for (const source of ordered) {
    const snapshots = source.role === "target" ? champion?.artifactSnapshots.filter((snapshot) => snapshot.sourceArtifactId === source.id) ?? [] : [];
    if (champion && source.role === "target" && snapshots.length !== 1) throw new Error(`${source.name} 缺少唯一的当前 Champion Snapshot。`);
    const snapshot = snapshots[0];
    const receipt = snapshot?.frozenArtifact;
    if (snapshot && (!receipt || receipt.sourceArtifactId !== source.id || receipt.name !== source.name)) {
      throw new Error(`${source.name} 缺少正确的 Champion 冻结文件凭证。`);
    }
    let content: string;
    let sha256: string | undefined;
    const blobId = receipt?.blobId ?? source.storageRef?.trim();
    if (blobId) {
      if (snapshot && !await verifyServerCandidateFrozenArtifact(snapshot)) throw new Error(`${source.name} 的 Champion 冻结凭证与文件不一致。`);
      const blob = await store.get(blobId);
      if (!blob || blob.size > MAX_FILE_BYTES || blob.size !== (receipt?.size ?? source.size)) throw new Error(`${source.name} 的当前文件缺失、大小不一致或超出索引范围。`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength !== blob.size) throw new Error(`${source.name} 的当前文件读取大小已变化。`);
      sha256 = await serverArtifactSha256(bytes);
      if (receipt && sha256 !== receipt.sha256) throw new Error(`${source.name} 的当前 Champion Blob 已变化。`);
      const extracted = await extractServerStaticArtifactText(source.extension.toLowerCase(), bytes);
      if (!extracted?.trim()) throw new Error(`${source.name} 尚无可读取的当前文件语义索引。`);
      content = extracted;
    } else {
      if (source.inputMode !== "paste" || !source.textContent?.trim()) throw new Error(`${source.name} 缺少实际文件或完整粘贴正文。`);
      content = source.textContent;
    }
    const allowance = Math.max(0, Math.min(MAX_ARTIFACT_CHARS, remaining));
    const bounded = content.slice(0, allowance);
    remaining -= bounded.length;
    context.push({
      id: source.id, name: source.name, role: source.role, mimeType: source.mimeType,
      artifactKind: source.artifactKind, extension: source.extension, content: bounded,
      currentVersion: snapshot ? (project.searchChampion?.versionLabel ?? champion?.id) : project.version,
      snapshotHash: snapshot?.contentHash, artifactSha256: sha256,
      originalChars: content.length, truncated: bounded.length < content.length,
    });
  }
  return context;
}