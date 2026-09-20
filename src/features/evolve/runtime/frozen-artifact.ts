import type { FrozenArtifact } from "../schemas";
import { getArtifactBlob, putArtifactBlob } from "./artifact-blob-store";

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function textDigest(text: string) {
  return sha256(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

/** A receipt refers to the actual persisted bytes, not to an AI-supplied hash. */
export async function freezeArtifact(args: {
  sourceArtifactId: string; content: string; blob: Blob; name: string;
  checks: string[]; limitations: string[];
}): Promise<FrozenArtifact> {
  const hash = await sha256(await args.blob.arrayBuffer());
  const blobId = `verified-file:${hash}`;
  await putArtifactBlob(blobId, args.blob);
  const stored = await getArtifactBlob(blobId);
  if (!stored || await sha256(await stored.arrayBuffer()) !== hash) {
    throw new Error("无法持久保存已验证文件，请检查浏览器存储空间后重试。");
  }
  return { sourceArtifactId: args.sourceArtifactId, snapshotHash: await textDigest(args.content), blobId,
    name: args.name, mimeType: args.blob.type, sha256: hash, size: args.blob.size,
    verifiedAt: new Date().toISOString(), checks: args.checks, limitations: args.limitations };
}

export async function readFrozenArtifact(receipt: FrozenArtifact | undefined, content: string) {
  if (!receipt) throw new Error("这个历史版本尚未冻结实际文件，请重新验收后下载；不会在下载时生成未经验证的新文件。");
  if (receipt.snapshotHash !== await textDigest(content)) throw new Error("成果内容已变化，旧验收已失效，请重新验收。");
  const blob = await getArtifactBlob(receipt.blobId);
  if (!blob) throw new Error("已验收文件不在当前浏览器中。请回到原浏览器下载，或重新接入原文件并验收。");
  if (blob.size !== receipt.size || await sha256(await blob.arrayBuffer()) !== receipt.sha256) throw new Error("成果文件校验不一致，已阻止下载，请重新验收。");
  return blob;
}
