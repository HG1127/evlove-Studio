import JSZip from "jszip";
import {z} from "zod";
import {
  CandidateSchema,
  type ArtifactStorePort,
  type BuildCandidateAiResult,
  type Candidate,
  type CandidateArtifactSnapshot,
  type EvolveProject,
  type FrozenArtifact,
  type SourceArtifact,
} from "@evolution/contracts";
import { trustedServerBaselineChampion } from "@evolution/harness";
import { applyExactEdits, bindHtmlBuildTextEditAnchors,bindHtmlBuildBodyNodeEdits, isTextArtifactExtension, isZipArtifact,userGoalScopeContext,candidateFailureContextBlocker } from "@evolution/core";
import { buildServerCandidateTargetContext, buildServerExactCandidateArtifacts, isServerTextEditBlueprint, requireServerCandidateOutputModes } from "./server-candidate-context";
import { runServerAi } from "./ai-gateway";
import { checkServerHtmlCandidateProtection } from "./server-html-candidate-protection";
import {compileServerHtmlDerivedMetadata} from "./server-html-derived-metadata";
import {serverCandidateConstructionCorrection} from "./server-candidate-construction-feedback";
import {SERVER_HTML_BUILD_BODY_INSTRUCTION,SERVER_HTML_BUILD_BODY_NODE_INSTRUCTION,SERVER_HTML_PARAGRAPH_CONSTRUCTION_INSTRUCTION} from "./server-html-build-context";
import { getServerArtifactStore } from "./artifact-runtime";
import { renderSnapshot, verifyRendered } from "./server-artifact-renderer";
import {parseServerSource} from "./server-source-parser";
import {validateStructuredTextFormat} from "@evolution/adapters";

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

function currentParentSnapshot(project: EvolveProject, sourceArtifactId: string, parentCandidate?: Candidate) {
  const matches=(parentCandidate ?? trustedServerBaselineChampion(project))?.artifactSnapshots.filter((snapshot)=>snapshot.sourceArtifactId===sourceArtifactId)??[];
  return matches.length===1?matches[0]:undefined;
}

export function resolveServerExperimentParentBinding(project: EvolveProject, source: SourceArtifact, parentCandidate?: Candidate) {
  const parent = currentParentSnapshot(project, source.id, parentCandidate);
  if (!parent && (parentCandidate || project.searchChampion)) {
    return {
      blobId: undefined,
      candidateId: parentCandidate?.id ?? trustedServerBaselineChampion(project)?.id,
      sha256: undefined,
      size: undefined,
      reason: `当前 Search Champion 缺少 ${source.name} 的唯一可信 Artifact Snapshot，不能回退原 Source 作为 Candidate 父代。`,
    };
  }
  if (!parent) return { blobId: source.storageRef?.trim() || source.id, candidateId: undefined, sha256: undefined, size: undefined, reason: undefined };
  if (!parent.frozenArtifact) {
    return {
      blobId: undefined,
      candidateId: parentCandidate?.id ?? trustedServerBaselineChampion(project)?.id,
      sha256: undefined,
      size: undefined,
      reason: `当前 Search Champion 的 ${source.name} 尚未冻结实际文件，不能回退原 Source 作为 Candidate 父代。`,
    };
  }
  return {
    blobId: parent.frozenArtifact.blobId,
    candidateId: parentCandidate?.id ?? trustedServerBaselineChampion(project)?.id,
    sha256: parent.frozenArtifact.sha256,
    size: parent.frozenArtifact.size,
    reason: undefined,
  };
}

async function currentBaseBlob(project: EvolveProject, source: SourceArtifact, parentCandidate?: Candidate) {
  const binding = resolveServerExperimentParentBinding(project, source, parentCandidate);
  if (!binding.blobId) throw new Error(binding.reason ?? "当前 Candidate 父代 Artifact 不可用。");
  if (parentCandidate) {
    const parent = currentParentSnapshot(project, source.id, parentCandidate);
    if (!parent || !await verifyServerCandidateFrozenArtifact(parent)) throw new Error(`${source.name} 的待修复 Candidate 冻结文件不可用或身份不一致。`);
  }
  const blob = await getServerArtifactStore().get(binding.blobId);
  if (!blob) throw new Error(`找不到 Candidate 父代 Artifact Blob ${binding.blobId}。`);
  if (binding.size !== undefined && blob.size !== binding.size) throw new Error("Search Champion Artifact 大小校验失败。");
  if (binding.sha256 && await serverArtifactSha256(await blob.arrayBuffer()) !== binding.sha256) throw new Error("Search Champion Artifact SHA-256 校验失败。");
  return blob;
}

/** Reindex the current native frozen parent, not only its last sparse edit.
 * The exact current Blob is SHA/size verified before any extracted field can
 * become a coordinate for the next Candidate or targeted repair. */
export async function readServerCandidateParentNativeStructure(
  project:EvolveProject,source:SourceArtifact,parentCandidate?:Candidate,
){
  const blob=await currentBaseBlob(project,source,parentCandidate);
  const binding=resolveServerExperimentParentBinding(project,source,parentCandidate);
  const parsed=await parseServerSource({
    artifactId:source.id,name:source.name,mimeType:source.mimeType,size:blob.size,
    role:source.role,blob,storageRef:binding.blobId!,
  });
  if(parsed.parseStatus!=="ready"||!parsed.structuredContent){
    throw new Error(`${source.name} 当前冻结父代无法重新建立原生索引；不得使用过期上传预览。`);
  }
  return parsed;
}

/** Decode the actual current text file; parsed upload indexes cannot be a mutation base. */
export async function readServerCandidateParentText(project: EvolveProject, source: SourceArtifact, parentCandidate?: Candidate) {
  const parent = currentParentSnapshot(project, source.id, parentCandidate);
  if ((project.searchChampion || parentCandidate) && !parent) throw new Error(`当前 Search Champion 缺少 ${source.name} 的唯一可信父代。`);
  if (!parent && source.inputMode === "paste" && !source.storageRef?.trim()) {
    if (source.textContent === undefined) throw new Error(`${source.name} 缺少完整粘贴正文。`);
    return source.textContent;
  }
  if (parent && !await verifyServerCandidateFrozenArtifact(parent)) throw new Error(`${source.name} 的父代冻结文件与 Snapshot 身份不一致。`);
  const blob = await currentBaseBlob(project, source, parentCandidate);
  if (!parent && blob.size !== source.size) throw new Error(`${source.name} 的原文件大小与 Source 不一致。`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (await sha256Text(text) !== await serverArtifactSha256(bytes)) throw new Error(`${source.name} 不能逐字节还原为 UTF-8 文本。`);
  return text;
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
export async function verifyServerCandidateFrozenArtifact(snapshot: CandidateArtifactSnapshot,reader?:Pick<ArtifactStorePort,"get">): Promise<boolean> {
  const receipt = snapshot.frozenArtifact;
  if (!receipt || receipt.sourceArtifactId !== snapshot.sourceArtifactId || receipt.size <= 0
    || receipt.name !== snapshot.name || receipt.mimeType !== snapshot.mimeType) return false;
  const contentHash = await sha256Text(snapshot.content);
  if (receipt.snapshotHash !== contentHash || (snapshot.contentHash && snapshot.contentHash !== contentHash)) return false;
  const blob = await (reader??getServerArtifactStore()).get(receipt.blobId);
  if (!blob || blob.size !== receipt.size) return false;
  const bytes = await blob.arrayBuffer();
  if (await serverArtifactSha256(bytes) !== receipt.sha256) return false;
  const extension = receipt.name.split(".").pop()?.toLowerCase() ?? "";
  // CSV/TSV are native table overlays. Their Candidate Snapshot is a
  // Sheet/Cell JSON mutation plan (or keep-parent receipt), *not* the literal
  // file bytes. Compare the verified frozen blob hash/size above instead.
  if (isTextArtifactExtension(extension)) {
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

async function materializeCodebase(project: EvolveProject, source: SourceArtifact, content: string, parentCandidate?: Candidate) {
  const baseBlob = await currentBaseBlob(project, source, parentCandidate);
  return applyServerCodebaseOverlay(baseBlob, content, source.mimeType || "application/zip");
}

async function materializeText(source: SourceArtifact, snapshot: CandidateArtifactSnapshot) {
  const extension = source.extension.toLowerCase();
  if (!isTextArtifactExtension(extension || source.name.split(".").pop() || "")) {
    throw new Error(`${source.name} 暂无 Server 原格式 Materializer；不会把 AI 文本冒充 ${source.extension || "二进制"} 成果。`);
  }
  if (!snapshot.content.trim()) throw new Error(`${source.name} Candidate 内容为空。`);
  validateStructuredTextFormat({extension,content:snapshot.content});
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

async function buildSnapshotFile(
  project: EvolveProject,
  source: SourceArtifact,
  snapshot: CandidateArtifactSnapshot,
  materializationContent = snapshot.content,
  parentCandidate?: Candidate,
) {
  const code = isZipArtifact(source);
  const office = source.artifactDescriptor?.adapterId === "document-docx-ooxml"
    || source.artifactDescriptor?.adapterId === "presentation-pptx-ooxml"
    // Old uploaded Office artifacts can predate the V2 descriptor; route them
    // to the real package renderer, never through a text materializer.
    || ["docx","pptx"].includes(source.extension.toLowerCase())
    || source.artifactDescriptor?.family === "spreadsheet"
    || source.artifactKind === "spreadsheet";
  let built: {blob:Blob;checks:string[];limitations:string[]};
  if(code){
    built=await materializeCodebase(project,source,materializationContent,parentCandidate);
  }else if(office){
    const store=getServerArtifactStore();
    const base=parentCandidate||project.searchChampion||source.storageRef?.trim()
      ?await currentBaseBlob(project,source,parentCandidate)
      :await store.get(source.id);
    const rendered=await renderSnapshot(source,snapshot,store,base);
    const verification=await verifyRendered(source,snapshot,rendered.blob,store,base);
    built={blob:rendered.blob,checks:["验收前原格式物化",...verification.checks],limitations:verification.limitations};
  }else{
    built=await materializeText(source,snapshot);
  }
  return built;
}

const KeepParentBlueprint=z.object({
  kind:z.literal("keep-parent"),
  sourceArtifactId:z.string().min(1),
}).strict();
function parseKeepParent(content:string){
  let parsed:unknown;
  try{parsed=JSON.parse(content);}catch{return undefined;}
  if(!parsed||typeof parsed!=="object"||!("kind" in parsed)||parsed.kind!=="keep-parent")return undefined;
  return KeepParentBlueprint.parse(parsed);
}
function canPreserveNativeArtifact(source:SourceArtifact){
  return ["docx","pptx","xlsx","xls","ods","csv","tsv","zip"].includes(source.extension.toLowerCase());
}

export async function materializeServerCandidateArtifacts(
  project:EvolveProject,
  candidate:Candidate,
  artifacts:Array<{sourceArtifactId:string;name:string;mimeType:string;content:string;notes?:string[];buildMode?:"ai-full"|"deterministic"|"external-target"}>,
  summary:string,
  parentCandidate?:Candidate,
  expectedTextParents?:ReadonlyMap<string,string>,
):Promise<Candidate>{
  const targets=project.sourceArtifacts.filter((artifact)=>artifact.role==="target");
  const bySource=new Map(artifacts.map((artifact)=>[artifact.sourceArtifactId,artifact]));
  if(artifacts.length!==targets.length||targets.some((target)=>!bySource.has(target.id))){
    throw new Error(`Server Artifact Builder 返回 ${artifacts.length} 个成果，但当前有 ${targets.length} 个 Target；禁止遗漏、重复或额外成果。`);
  }
  const prepared:Array<{source:SourceArtifact;snapshot:CandidateArtifactSnapshot;built?:{blob:Blob;checks:string[];limitations:string[]};unchanged:boolean}>=[];
  // Validate and materialize the entire set before persisting any Candidate bytes.
  for(const [index,source] of targets.entries()){
    const artifact=bySource.get(source.id)!;
    const outputExtension=(artifact.name||source.name).split(".").pop()?.toLowerCase();
    if(source.extension&&outputExtension!==source.extension.toLowerCase()){
      throw new Error(`${source.name} Candidate 必须保留原文件扩展名，不能冒充其他格式。`);
    }
    const code=isZipArtifact(source);
    const spreadsheet=source.artifactKind==="spreadsheet"||source.artifactDescriptor?.family==="spreadsheet"
      ||["csv","tsv","xlsx","xls","ods"].includes(source.extension.toLowerCase());
    const text=!code&&!spreadsheet&&isTextArtifactExtension(source.extension);
    const parent=currentParentSnapshot(project,source.id,parentCandidate);
    const keep=parseKeepParent(artifact.content);
    if(keep){
      if(!canPreserveNativeArtifact(source)||keep.sourceArtifactId!==source.id){
        throw new Error(`${source.name} 仅允许为当前原生文件返回绑定 Source ID 的 keep-parent；不能用文字标记伪造原文件。`);
      }
      if(parent){
        if(!await verifyServerCandidateFrozenArtifact(parent))throw new Error(`${source.name} 的父代冻结 Artifact 身份不一致，不能保留旧字节。`);
        prepared.push({source,snapshot:{...parent,id:`server-candidate-${candidate.id}-${source.id}-${index}`},unchanged:true});
        continue;
      }
      const original=await currentBaseBlob(project,source,parentCandidate);
      if(source.size>0&&original.size!==source.size)throw new Error(`${source.name} 原文件大小发生变化，不能作为未修改结果冻结。`);
      if(["docx","pptx","zip"].includes(source.extension.toLowerCase())){
        await JSZip.loadAsync(new Uint8Array(await original.arrayBuffer()),{checkCRC32:true});
      }
      const marker=JSON.stringify(keep);
      const snapshot:CandidateArtifactSnapshot={
        id:`server-candidate-${candidate.id}-${source.id}-${index}`,
        sourceArtifactId:source.id,name:source.name,mimeType:original.type||source.mimeType,
        content:marker,contentHash:await sha256Text(marker),buildMode:"deterministic",
        notes:["该 Target 不在本轮修改范围；冻结原始 Blob 的精确字节而非 AI 摘要。"],
        createdAt:new Date().toISOString(),
      };
      prepared.push({source,snapshot,unchanged:true,built:{
        blob:original,checks:["原始字节复用","源文件 SHA-256 冻结","本轮无未授权修改"],limitations:[],
      }});
      continue;
    }
    const parentText=text
      ?await readServerCandidateParentText(project,source,parentCandidate)
      :parent?.content??source.textContent??"";
    const expectedParent=expectedTextParents?.get(source.id);
    if(text&&expectedParent&&await sha256Text(parentText)!==expectedParent)
      throw Object.assign(new Error(`${source.name} 的当前父代已不同于本次构建请求绑定的完整文本，禁止应用旧上下文修改。`),{code:"CANDIDATE_BUILD_PARENT_CHANGED"});
    let snapshotContent=code?composeServerCodebaseOverlay(parent?.content,artifact.content):artifact.content;
    if (text && isServerTextEditBlueprint(artifact.content)) {
      snapshotContent=applyExactEdits(parentText,artifact.content,{strict:true});
    }
    const derived=text?await compileServerHtmlDerivedMetadata({extension:source.extension,content:snapshotContent,parentText,
      readOriginal:()=>readServerCandidateParentText({...project,searchChampion:undefined},source)}):{content:snapshotContent,checks:[]};
    snapshotContent=derived.content;
    const unchanged=snapshotContent.trim()===parentText.trim();
    if(unchanged&&!parent&&!text){
      throw new Error(`${source.name} Candidate 与当前父代完全相同，没有产生可验证变异。`);
    }
    if(unchanged) snapshotContent=parentText;
    const snapshot:CandidateArtifactSnapshot={
      id:`server-candidate-${candidate.id}-${source.id}-${index}`,
      sourceArtifactId:source.id,
      name:unchanged?(parent?.name??source.name):(artifact.name||source.name),
      mimeType:unchanged?(parent?.mimeType??source.mimeType):(artifact.mimeType||source.mimeType),
      content:snapshotContent,
      contentHash:await sha256Text(snapshotContent),
      buildMode:artifact.buildMode??"ai-full",
      notes:[...(artifact.notes??[]),"Durable Workflow Server Materializer：实际文件已物化并冻结。"],
      createdAt:new Date().toISOString(),
    };
    const protection=text?await checkServerHtmlCandidateProtection({
      project,source,candidateContent:snapshotContent,parentText,hasParent:Boolean(parent),
      readOriginal:()=>readServerCandidateParentText({...project,searchChampion:undefined},source),
    }):{checks:[],limitations:[]};
    if(unchanged&&parent){
      if(!await verifyServerCandidateFrozenArtifact(parent)) throw new Error(`${source.name} 的父代 Candidate 冻结文件不可用或身份不一致。`);
      prepared.push({source,snapshot:{...parent,id:snapshot.id},unchanged:true});
      continue;
    }
    const built=await buildSnapshotFile(project,source,snapshot,artifact.content,parentCandidate);
    built.checks.push(...protection.checks);
    built.checks.push(...derived.checks);
    built.limitations.push(...protection.limitations);
    prepared.push({source,snapshot,built,unchanged});
  }
  if(prepared.every((item)=>item.unchanged)){
    throw new Error("Candidate 与当前父代完全相同，没有产生可验证变异。");
  }
  const snapshots:CandidateArtifactSnapshot[]=[];
  for(const item of prepared){
    if(!item.built){snapshots.push(item.snapshot);continue;}
    const {blob,checks,limitations}=item.built;
    const frozenArtifact=await persistFrozenArtifact(item.source,item.snapshot,blob,checks,limitations);
    snapshots.push({...item.snapshot,name:frozenArtifact.name,mimeType:frozenArtifact.mimeType,frozenArtifact});
  }
  if(parentCandidate&&snapshots.every((snapshot)=>snapshot.frozenArtifact?.sha256===currentParentSnapshot(project,snapshot.sourceArtifactId,parentCandidate)?.frozenArtifact?.sha256)){
    throw new Error("修复 Candidate 与当前父代完全相同，没有产生可验证变异。");
  }
  return CandidateSchema.parse({
    ...candidate,
    artifactSnapshots:snapshots,
    artifactBuildStatus:"ready",
    artifactBuildSummary:`${snapshots.length} 份 Candidate 实际文件已在 Server 物化、持久化并绑定 SHA-256；${summary}`,
  });
}

export async function buildServerExperimentCandidate(project: EvolveProject, candidate: Candidate): Promise<Candidate> {
  const blocker=candidateFailureContextBlocker(project,candidate);if(blocker)throw new Error(blocker);
  const targets = project.sourceArtifacts.filter((artifact) => artifact.role === "target");
  if (!targets.length) throw new Error("Mission 没有 Target Source Artifact。");
  const expectedParents=new Map<string,string>();
  const readParent=async(source:SourceArtifact)=>{
    const actual=await readServerCandidateParentText(project,source);expectedParents.set(source.id,await sha256Text(actual));return actual;
  };
  const planned = await buildServerExactCandidateArtifacts(project,candidate,readParent);
  if (planned) return materializeServerCandidateArtifacts(project,candidate,planned,"精确方案已应用到完整父代文件；AI Artifact Builder 未调用。",undefined,expectedParents);
  const contexts = await buildServerCandidateTargetContext(project,candidate,
    readParent,undefined,
    (source)=>readServerCandidateParentNativeStructure(project,source));
  const payload = {
    project: {
      name: project.name,
      objectType: project.objectType,
      goal: project.goal,
      evolutionCommand: project.evolutionCommand,
      protectedItems: project.protectedItems,
      editableItems: project.editableItems,
      acceptanceRubric: project.acceptanceRubric,
      currentTargets: contexts,
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
    htmlBodyContextInstruction:contexts.some(c=>c.bodyAnchorPolicy==="issued-body-nodes-v1")?SERVER_HTML_BUILD_BODY_NODE_INSTRUCTION:SERVER_HTML_BUILD_BODY_INSTRUCTION,
    ...(userGoalScopeContext(project)?{winnerGoalScope:userGoalScopeContext(project)}:{}),
    htmlParagraphConstructionInstruction:SERVER_HTML_PARAGRAPH_CONSTRUCTION_INSTRUCTION,
    outputInstruction: "Return exactly one artifact for every currentTargets item. For a text target with mutationMode text-edits, return content as JSON {kind:'text-edits',edits:[{before,after,start?,end?}]}. Copy before verbatim from the provided current source chunks, without chunk markers or ellipses; offsets are zero-based and end is exclusive. The server applies those edits to the complete current file and preserves every untouched byte. Never regenerate a whole file from truncated context. For an unchanged text Target, return one exact text-edit with identical before/after using a unique verbatim anchor; preserve that file rather than inventing another change. Only when a text target has mutationMode full, return its COMPLETE evolved standalone file (including code-file/CSS/Python/TypeScript/HTML/MD/JSON/JSONL/YAML/XML/SVG); never return a ZIP overlay for a single source file. For ZIP codebase/package targets only return content as JSON {kind:'codebase',overlay:true,files:[{path,content}],deletions:[path]} with actual changed/deleted files only; never return prose or fake test results. For a DOCX target, return content as JSON {kind:'document',subtype:'docx',parts:[{path:'word/document.xml',textRuns:[{index:0,text:'replacement'}]}]}; for a PPTX target use JSON {kind:'presentation',slides:[{number:1,textRuns:[{index:0,text:'replacement'}]}]}; use ONLY real part paths, slide numbers and zero-based run indexes shown in structuredContext. Include only the locations actually changed; preserve all other runs, slides, layout and binary assets via original-package overlay. For an XLSX/XLS/ODS/CSV/TSV target, return JSON {kind:'spreadsheet',sheets:[{name:'Existing Sheet',cells:[{address:'A1',value:'replacement'}]}]}; use real sheet names and existing A1 positions shown in structuredContext, update only desired cells and never reconstruct an entire partial sheet from preview rows. For XLSX formulas include formula:'A1*2' only when required; do not fabricate computed values or verification. CSV/TSV cannot preserve executable formulas. Each actual change must differ from the current accepted Champion, and any unmentioned content remains unchanged. If a DOCX/PPTX/spreadsheet/ZIP Target is intentionally UNCHANGED in this Candidate, return content JSON {kind:'keep-parent',sourceArtifactId:'EXACT currentTargets.id'} for that Target only. The Server then verifies and freezes its existing Source/Champion bytes; do not pretend a no-op was a successful mutation. A Candidate with ALL Targets unchanged is rejected. Do not output PDF/image/audio/video binaries as JSON or text; those targets need an external renderer and remain blocked. sourceArtifactId must exactly match currentTargets.id.",
  };
  if(contexts.some(c=>c.bodyAnchorPolicy==="issued-body-nodes-v1")){
    payload.outputInstruction="For mutationMode html-build-body-node-edits-v1, return content JSON {kind:'html-build-body-node-edits-v1',edits:[{anchorId:'EXACT issued ID',after:'complete raw replacement'}]}. Select IDs from that Target's complete htmlBuildBodyContext.anchors. For an unchanged node-mode Target, return an issued ID with after exactly equal to its raw before. Do not return before/positions/parent/hash fields for this mode. All unchanged-Target and real-mutation rules remain binding. "+payload.outputInstruction.replace("For an unchanged text Target,","For an unchanged text Target with mutationMode text-edits,");
  }
  const bindIssuedBodyAnchors=(artifacts:BuildCandidateAiResult["artifacts"])=>artifacts.map(artifact=>{
    const target=contexts.find(item=>item.id===artifact.sourceArtifactId),context=target?.htmlBuildBodyContext;
    return context?{...artifact,content:target?.bodyAnchorPolicy==="issued-body-nodes-v1"
      ?bindHtmlBuildBodyNodeEdits(artifact.content,context):bindHtmlBuildTextEditAnchors(artifact.content,context)}:artifact;
  });
  const response = await runServerAi("build-candidate", payload);
  requireServerCandidateOutputModes(contexts, response.artifacts);
  try{
    return await materializeServerCandidateArtifacts(project,candidate,bindIssuedBodyAnchors(response.artifacts),response.summary,undefined,expectedParents);
  }catch(error){
    const correction=serverCandidateConstructionCorrection(error,response.artifacts);
    if(!correction)throw error;
    // All Target edits are checked before the first write. This is one construction
    // correction against the same supplied source, never a replacement frozen file.
    const corrected=await runServerAi("build-candidate",{...payload,constructionCorrection:correction});
    requireServerCandidateOutputModes(contexts,corrected.artifacts);
    return materializeServerCandidateArtifacts(project,candidate,bindIssuedBodyAnchors(corrected.artifacts),corrected.summary,undefined,expectedParents);
  }
}
