import JSZip from "jszip";
import {
  CandidateSchema,
  type Candidate,
  type CandidateArtifactSnapshot,
  type EvolveProject,
  type FrozenArtifact,
  type SourceArtifact,
} from "@evolution/contracts";
import { trustedServerBaselineChampion } from "@evolution/harness";
import { runServerAi } from "./ai-gateway";
import { getServerArtifactStore } from "./artifact-runtime";
import { renderSnapshot, verifyRendered } from "./server-artifact-renderer";

const TEXT_FAMILY = /^(txt|md|markdown|mdx|csv|tsv|json|yaml|yml|css|js|jsx|ts|tsx|html|htm|xml|svg)$/i;
type CodebaseOverlay = { files: Array<{ path: string; content: string }>; deletions: string[] };

function safeArchivePath(path: string) {
  return Boolean(path)
    && !/[\\:]/.test(path)
    && ![...path].some((char) => char.charCodeAt(0) < 32)
    && !path.startsWith("/")
    && !path.split("/").some((part) => !part || part === "." || part === "..");
}

function parseCodebaseOverlay(content: string, strict = true): CodebaseOverlay | undefined {
  let raw: { files?: Array<{ path?: unknown; content?: unknown }>; deletions?: unknown[] };
  try { raw = JSON.parse(content) as typeof raw; }
  catch {
    if (strict) throw new Error("Candidate 必须返回 JSON codebase overlay。");
    return undefined;
  }
  const files = Array.isArray(raw.files)
    ? raw.files.map((file) => ({ path: String(file.path ?? ""), content: typeof file.content === "string" ? file.content : "" }))
    : [];
  const deletions = Array.isArray(raw.deletions) ? raw.deletions.map((path) => String(path ?? "")) : [];
  if (strict && !files.length && !deletions.length) throw new Error("Candidate 没有实际 changed/deleted files。");
  return { files, deletions };
}

/** Preserve cumulative changed-file context across accepted Search Champions. */
export function composeServerCodebaseOverlay(parentContent: string | undefined, deltaContent: string) {
  const delta = parseCodebaseOverlay(deltaContent, true)!;
  const parent = parentContent ? parseCodebaseOverlay(parentContent, false) : undefined;
  if (!parent) return JSON.stringify({ kind: "codebase", overlay: true, files: delta.files, deletions: delta.deletions });
  const files = new Map(parent.files.map((file) => [file.path, file.content]));
  const deletions = new Set(parent.deletions);
  for (const file of delta.files) {
    files.set(file.path, file.content);
    deletions.delete(file.path);
  }
  for (const path of delta.deletions) {
    files.delete(path);
    deletions.add(path);
  }
  return JSON.stringify({
    kind: "codebase",
    overlay: true,
    files: [...files].map(([path, content]) => ({ path, content })),
    deletions: [...deletions],
  });
}

export async function serverArtifactSha256(bytes: ArrayBuffer | Uint8Array) {
  const buffer: ArrayBuffer = bytes instanceof Uint8Array
    ? (() => { const copy = new Uint8Array(bytes.byteLength); copy.set(bytes); return copy.buffer; })()
    : bytes;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(text: string) {
  return serverArtifactSha256(new TextEncoder().encode(text));
}

function compactStructured(artifact: SourceArtifact, candidate: Candidate) {
  const data = artifact.structuredContent as Record<string, unknown> | undefined;
  if (!data) return undefined;
  const query = [
    ...(candidate.designRationale?.sourceEvidence ?? []),
    ...candidate.patches.map((patch) => `${patch.target} ${patch.rationale}`),
  ].join(" ").toLowerCase();
  const entries = Array.isArray(data.entries) ? data.entries as Array<Record<string, unknown>> : [];
  const ranked = entries.map((entry) => {
    const path = String(entry.path ?? "");
    const content = String(entry.content ?? "");
    const haystack = `${path}\n${content}`.toLowerCase();
    const score = query.split(/\s+/).filter((token) => token.length >= 3 && haystack.includes(token)).length;
    return { path, content: content.slice(0, 5000), score };
  }).filter((entry) => entry.path || entry.content)
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);
  return {
    kind: data.kind,
    manifest: Array.isArray(data.manifest) ? data.manifest.slice(0, 240) : artifact.structure.slice(0, 240),
    relevantEntries: ranked,
  };
}

function currentTargetContext(project: EvolveProject, candidate: Candidate) {
  const champion = trustedServerBaselineChampion(project);
  const championBySource = new Map((champion?.artifactSnapshots ?? []).map((snapshot) => [snapshot.sourceArtifactId, snapshot]));
  let remaining = 72_000;
  return project.sourceArtifacts.filter((artifact) => artifact.role === "target").map((artifact) => {
    const parent = championBySource.get(artifact.id);
    const source = parent?.content || artifact.textContent || artifact.textExcerpt || "";
    const allowance = Math.max(0, Math.min(22_000, remaining));
    const content = source.slice(0, allowance);
    remaining = Math.max(0, remaining - content.length);
    return {
      id: artifact.id,
      name: artifact.name,
      mimeType: artifact.mimeType,
      extension: artifact.extension,
      artifactKind: artifact.artifactKind,
      descriptor: artifact.artifactDescriptor,
      structure: artifact.structure.slice(0, 120),
      currentVersion: parent ? (project.searchChampion?.versionLabel ?? champion?.id) : project.version,
      currentSnapshotHash: parent?.contentHash,
      content,
      originalChars: source.length,
      truncated: content.length < source.length,
      structuredContext: compactStructured(artifact, candidate),
    };
  });
}

function currentParentSnapshot(project: EvolveProject, sourceArtifactId: string) {
  const matches=trustedServerBaselineChampion(project)?.artifactSnapshots.filter((snapshot)=>snapshot.sourceArtifactId===sourceArtifactId)??[];
  return matches.length===1?matches[0]:undefined;
}

export function resolveServerExperimentParentBinding(project: EvolveProject, source: SourceArtifact) {
  const parent = currentParentSnapshot(project, source.id);
  if (!parent && project.searchChampion) {
    return {
      blobId: undefined,
      candidateId: trustedServerBaselineChampion(project)?.id,
      sha256: undefined,
      size: undefined,
      reason: `当前 Search Champion 缺少 ${source.name} 的唯一可信 Artifact Snapshot，不能回退原 Source 作为 Candidate 父代。`,
    };
  }
  if (!parent) return { blobId: source.storageRef?.trim() || source.id, candidateId: undefined, sha256: undefined, size: undefined, reason: undefined };
  if (!parent.frozenArtifact) {
    return {
      blobId: undefined,
      candidateId: trustedServerBaselineChampion(project)?.id,
      sha256: undefined,
      size: undefined,
      reason: `当前 Search Champion 的 ${source.name} 尚未冻结实际文件，不能回退原 Source 作为 Candidate 父代。`,
    };
  }
  return {
    blobId: parent.frozenArtifact.blobId,
    candidateId: trustedServerBaselineChampion(project)?.id,
    sha256: parent.frozenArtifact.sha256,
    size: parent.frozenArtifact.size,
    reason: undefined,
  };
}

async function currentBaseBlob(project: EvolveProject, source: SourceArtifact) {
  const binding = resolveServerExperimentParentBinding(project, source);
  if (!binding.blobId) throw new Error(binding.reason ?? "当前 Candidate 父代 Artifact 不可用。");
  const blob = await getServerArtifactStore().get(binding.blobId);
  if (!blob) throw new Error(`找不到 Candidate 父代 Artifact Blob ${binding.blobId}。`);
  if (binding.size !== undefined && blob.size !== binding.size) throw new Error("Search Champion Artifact 大小校验失败。");
  if (binding.sha256 && await serverArtifactSha256(await blob.arrayBuffer()) !== binding.sha256) throw new Error("Search Champion Artifact SHA-256 校验失败。");
  return blob;
}

async function persistFrozenArtifact(
  source: SourceArtifact,
  snapshot: CandidateArtifactSnapshot,
  blob: Blob,
  checks: string[],
  limitations: string[],
): Promise<FrozenArtifact> {
  const bytes = await blob.arrayBuffer();
  if (!bytes.byteLength) throw new Error(`${source.name} 物化结果为空。`);
  const sha256 = await serverArtifactSha256(bytes);
  const blobId = `server-candidate:${sha256}`;
  await getServerArtifactStore().put(blobId, blob);
  const readback = await getServerArtifactStore().get(blobId);
  if (!readback || readback.size !== blob.size || await serverArtifactSha256(await readback.arrayBuffer()) !== sha256) {
    throw new Error(`${source.name} Candidate Artifact 持久化回读校验失败。`);
  }
  return {
    sourceArtifactId: source.id,
    snapshotHash: await sha256Text(snapshot.content),
    blobId,
    name: snapshot.name,
    mimeType: blob.type || source.mimeType,
    sha256,
    size: blob.size,
    verifiedAt: new Date().toISOString(),
    checks,
    limitations,
  };
}

/** Recheck the persisted bytes at execution time, not just at materialization time. */
export async function verifyServerCandidateFrozenArtifact(snapshot: CandidateArtifactSnapshot): Promise<boolean> {
  const receipt = snapshot.frozenArtifact;
  if (!receipt || receipt.sourceArtifactId !== snapshot.sourceArtifactId || receipt.size <= 0
    || receipt.name !== snapshot.name || receipt.mimeType !== snapshot.mimeType) return false;
  const contentHash = await sha256Text(snapshot.content);
  if (receipt.snapshotHash !== contentHash || (snapshot.contentHash && snapshot.contentHash !== contentHash)) return false;
  const blob = await getServerArtifactStore().get(receipt.blobId);
  if (!blob || blob.size !== receipt.size) return false;
  const bytes = await blob.arrayBuffer();
  if (await serverArtifactSha256(bytes) !== receipt.sha256) return false;
  const extension = receipt.name.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_FAMILY.test(extension)) {
    try {
      if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== snapshot.content) return false;
    } catch {
      return false;
    }
  }
  return true;
}
export async function applyServerCodebaseOverlay(baseBlob: Blob, content: string, mimeType = "application/zip") {
  const payload = parseCodebaseOverlay(content, true)!;
  const { files, deletions } = payload;
  const seen = new Set<string>();
  for (const file of files) {
    if (!safeArchivePath(file.path) || seen.has(file.path) || !file.content) throw new Error(`无效、重复或空代码文件：${file.path || "(empty)"}`);
    seen.add(file.path);
  }
  const deleted = new Set<string>();
  for (const path of deletions) {
    if (!safeArchivePath(path) || seen.has(path) || deleted.has(path)) throw new Error(`无效、重复或冲突的删除路径：${path || "(empty)"}`);
    deleted.add(path);
  }
  const base = await JSZip.loadAsync(new Uint8Array(await baseBlob.arrayBuffer()), { checkCRC32: true });
  const originalPaths = Object.keys(base.files);
  for (const path of deleted) {
    if (!base.files[path]) throw new Error(`Candidate 删除目标不存在：${path}`);
    base.remove(path);
  }
  for (const file of files) base.file(file.path, file.content);
  const bytes = await base.generateAsync({ type: "uint8array" });
  const verify = await JSZip.loadAsync(bytes, { checkCRC32: true });
  if (originalPaths.some((path) => !deleted.has(path) && !verify.files[path])) throw new Error("Candidate 丢失未授权的父代 ZIP 条目。");
  for (const path of deleted) {
    if (verify.files[path]) throw new Error(`Candidate 删除未生效：${path}`);
  }
  for (const file of files) {
    if (await verify.file(file.path)?.async("string") !== file.content) throw new Error(`Candidate ZIP 写入不一致：${file.path}`);
  }
  return {
    blob: new Blob([(() => { const copy = new Uint8Array(bytes.byteLength); copy.set(bytes); return copy.buffer; })()], { type: mimeType }),
    checks: ["以当前 Source/Search Champion ZIP 为父代", "压缩包 CRC 重新打开通过", "未授权父代条目完整保留", `${files.length} 个 changed files 与 ${deletions.length} 个 deletions 逐项核对`],
    limitations: ["代码文件写入与包完整性已验证；Build/Test 由 Vercel Sandbox 独立执行。"],
  };
}

async function materializeCodebase(project: EvolveProject, source: SourceArtifact, content: string) {
  const baseBlob = await currentBaseBlob(project, source);
  return applyServerCodebaseOverlay(baseBlob, content, source.mimeType || "application/zip");
}

async function materializeText(source: SourceArtifact, snapshot: CandidateArtifactSnapshot) {
  const extension = source.extension.toLowerCase();
  if (!TEXT_FAMILY.test(extension || source.name.split(".").pop() || "")) {
    throw new Error(`${source.name} 暂无 Server 原格式 Materializer；不会把 AI 文本冒充 ${source.extension || "二进制"} 成果。`);
  }
  if (!snapshot.content.trim()) throw new Error(`${source.name} Candidate 内容为空。`);
  if (extension === "json") JSON.parse(snapshot.content);
  if (/^html?$/.test(extension)
    && (!/<html\b/i.test(snapshot.content) || !/<body\b/i.test(snapshot.content) || !/<\/html\s*>/i.test(snapshot.content))) {
    throw new Error(`${source.name} Candidate HTML 缺少完整 html/body 容器。`);
  }
  const blob = new Blob([snapshot.content], { type: source.mimeType || "text/plain;charset=utf-8" });
  if (await blob.text() !== snapshot.content) throw new Error(`${source.name} Candidate 文本物化不一致。`);
  return {
    blob,
    checks: ["Candidate Snapshot 已物化为实际文件", "持久化前全文逐字一致"],
    limitations: [/^html?$/.test(extension) ? "HTML 文件结构已检查；真实交互仍需 Browser/Runner。" : "内容文件已逐字核对；业务行为仍由 Eval Suite 独立验证。"],
  };
}

async function materializeSnapshot(
  project: EvolveProject,
  source: SourceArtifact,
  snapshot: CandidateArtifactSnapshot,
  materializationContent = snapshot.content,
) {
  const code = source.artifactKind === "codebase"
    || source.extension.toLowerCase() === "zip"
    || source.artifactDescriptor?.family === "codebase"
    || source.artifactDescriptor?.family === "package";
  const office = source.artifactDescriptor?.adapterId === "document-docx-ooxml"
    || source.artifactDescriptor?.adapterId === "presentation-pptx-ooxml"
    || source.artifactDescriptor?.family === "spreadsheet"
    || source.artifactKind === "spreadsheet";
  let built: {blob:Blob;checks:string[];limitations:string[]};
  if(code){
    built=await materializeCodebase(project,source,materializationContent);
  }else if(office){
    const store=getServerArtifactStore();
    const base=project.searchChampion||source.storageRef?.trim()
      ?await currentBaseBlob(project,source)
      :await store.get(source.id);
    const rendered=await renderSnapshot(source,snapshot,store,base);
    const verification=await verifyRendered(source,snapshot,rendered.blob,store,base);
    built={blob:rendered.blob,checks:["验收前原格式物化",...verification.checks],limitations:verification.limitations};
  }else{
    built=await materializeText(source,snapshot);
  }
  const frozenArtifact = await persistFrozenArtifact(source, snapshot, built.blob, built.checks, built.limitations);
  return { ...snapshot, name: frozenArtifact.name, mimeType: frozenArtifact.mimeType, frozenArtifact };
}

export async function materializeServerCandidateArtifacts(
  project:EvolveProject,
  candidate:Candidate,
  artifacts:Array<{sourceArtifactId:string;name:string;mimeType:string;content:string;notes?:string[];buildMode?:"ai-full"|"deterministic"|"external-target"}>,
  summary:string,
):Promise<Candidate>{
  const targets=project.sourceArtifacts.filter((artifact)=>artifact.role==="target");
  const bySource=new Map(artifacts.map((artifact)=>[artifact.sourceArtifactId,artifact]));
  if(artifacts.length!==targets.length||targets.some((target)=>!bySource.has(target.id))){
    throw new Error(`Server Artifact Builder 返回 ${artifacts.length} 个成果，但当前有 ${targets.length} 个 Target；禁止遗漏、重复或额外成果。`);
  }
  const snapshots:CandidateArtifactSnapshot[]=[];
  for(const [index,source] of targets.entries()){
    const artifact=bySource.get(source.id)!;
    const code=source.artifactKind==="codebase"
      ||source.extension.toLowerCase()==="zip"
      ||source.artifactDescriptor?.family==="codebase"
      ||source.artifactDescriptor?.family==="package";
    const parent=currentParentSnapshot(project,source.id);
    const snapshotContent=code?composeServerCodebaseOverlay(parent?.content,artifact.content):artifact.content;
    const snapshot:CandidateArtifactSnapshot={
      id:`server-candidate-${candidate.id}-${source.id}-${index}`,
      sourceArtifactId:source.id,
      name:artifact.name||source.name,
      mimeType:artifact.mimeType||source.mimeType,
      content:snapshotContent,
      contentHash:await sha256Text(snapshotContent),
      buildMode:artifact.buildMode??"ai-full",
      notes:[...(artifact.notes??[]),"Durable Workflow Server Materializer：实际文件已物化并冻结。"],
      createdAt:new Date().toISOString(),
    };
    const parentText=parent?.content??source.textContent??"";
    if(!code&&artifact.content.trim()===parentText.trim()){
      throw new Error(`${source.name} Candidate 与当前父代完全相同，没有产生可验证变异。`);
    }
    snapshots.push(await materializeSnapshot(project,source,snapshot,artifact.content));
  }
  return CandidateSchema.parse({
    ...candidate,
    artifactSnapshots:snapshots,
    artifactBuildStatus:"ready",
    artifactBuildSummary:`${snapshots.length} 份 Candidate 实际文件已在 Server 物化、持久化并绑定 SHA-256；${summary}`,
  });
}

export async function buildServerExperimentCandidate(project: EvolveProject, candidate: Candidate): Promise<Candidate> {
  const targets = project.sourceArtifacts.filter((artifact) => artifact.role === "target");
  if (!targets.length) throw new Error("Mission 没有 Target Source Artifact。");
  const response = await runServerAi("build-candidate", {
    project: {
      name: project.name,
      objectType: project.objectType,
      goal: project.goal,
      evolutionCommand: project.evolutionCommand,
      protectedItems: project.protectedItems,
      editableItems: project.editableItems,
      acceptanceRubric: project.acceptanceRubric,
      currentTargets: currentTargetContext(project, candidate),
      currentParent: project.searchChampion ? {
        id: project.searchChampion.id,
        versionLabel: project.searchChampion.versionLabel,
        score: project.searchChampion.score,
      } : { versionLabel: project.version },
    },
    candidate: {
      id: candidate.id,
      title: candidate.title ?? candidate.name,
      change: candidate.change,
      hypothesis: candidate.hypothesis,
      patches: candidate.patches,
      risks: candidate.risks,
      designRationale: candidate.designRationale,
    },
    outputInstruction: "Return exactly one artifact for every currentTargets item. For text/html/md/json return the COMPLETE evolved file. For codebase/package return content as JSON {kind:'codebase',overlay:true,files:[{path,content}],deletions:[path]} with actual changed/deleted files only; never return prose or fake test results. sourceArtifactId must exactly match currentTargets.id.",
  });
  return materializeServerCandidateArtifacts(project,candidate,response.artifacts,response.summary);
}
