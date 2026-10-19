import { decodeArtifactUtf8 } from "@evolution/adapters";
import JSZip from "jszip";
import {
  CandidateSchema,
  CandidateConstructionBoundarySchema,
  type Candidate,
  type CandidateArtifactSnapshot,
  type EvolveProject,
  type FrozenArtifact,
  type SourceArtifact,
} from "@evolution/contracts";
import { CandidateConstructionOutputError, checkCandidateConstructionOutput, runCandidateConstruction, trustedServerBaselineChampion } from "@evolution/harness";
import { applyExactEdits, hasSourceTextArtifactFileFormat, requiresHtmlProtectionBaseline } from "@evolution/core";
import { buildServerCandidateTargetContext, buildServerExactCandidateArtifacts, isServerTextEditBlueprint, requireServerCandidateOutputModes, SERVER_TEXT_FAMILY as TEXT_FAMILY } from "./server-candidate-context";
import { runServerAi } from "./ai-gateway";
import { checkServerHtmlCandidateProtection } from "./server-html-candidate-protection";
import { getServerArtifactStore } from "./artifact-runtime";
import { renderSnapshot, verifyRendered } from "./server-artifact-renderer";

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
    if (!parent || !await verifyServerCandidateFrozenArtifact(parent,source)) throw new Error(`${source.name} 的待修复 Candidate 冻结文件不可用或身份不一致。`);
  }
  const blob = await getServerArtifactStore().get(binding.blobId);
  if (!blob) throw new Error(`找不到 Candidate 父代 Artifact Blob ${binding.blobId}。`);
  if (binding.size !== undefined && blob.size !== binding.size) throw new Error("Search Champion Artifact 大小校验失败。");
  if (binding.sha256 && await serverArtifactSha256(await blob.arrayBuffer()) !== binding.sha256) throw new Error("Search Champion Artifact SHA-256 校验失败。");
  return blob;
}

/** Decode the actual current text file; parsed upload indexes cannot be a mutation base. */
export async function readServerCandidateParentText(project: EvolveProject, source: SourceArtifact, parentCandidate?: Candidate) {
  const parent = currentParentSnapshot(project, source.id, parentCandidate);
  if ((project.searchChampion || parentCandidate) && !parent) throw new Error(`当前 Search Champion 缺少 ${source.name} 的唯一可信父代。`);
  if (!parent && source.inputMode === "paste" && !source.storageRef?.trim()) {
    if (source.textContent === undefined) throw new Error(`${source.name} 缺少完整粘贴正文。`);
    return source.textContent;
  }
  if (parent && !await verifyServerCandidateFrozenArtifact(parent,source)) throw new Error(`${source.name} 的父代冻结文件与 Snapshot 身份不一致。`);
  const blob = await currentBaseBlob(project, source, parentCandidate);
  if (!parent && blob.size !== source.size) throw new Error(`${source.name} 的原文件大小与 Source 不一致。`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = decodeArtifactUtf8(bytes);
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
export async function verifyServerCandidateFrozenArtifact(snapshot: CandidateArtifactSnapshot, source?: SourceArtifact): Promise<boolean> {
  const receipt = snapshot.frozenArtifact;
  if (source && (snapshot.sourceArtifactId !== source.id || !hasSourceTextArtifactFileFormat(source,snapshot.name))) return false;
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
      if (decodeArtifactUtf8(bytes) !== snapshot.content) return false;
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
  if (!TEXT_FAMILY.test(extension || source.name.split(".").pop() || "")) {
    throw new Error(`${source.name} 暂无 Server 原格式 Materializer；不会把 AI 文本冒充 ${source.extension || "二进制"} 成果。`);
  }
  if (!snapshot.content.trim()) throw new CandidateConstructionOutputError("text-format", `${source.name} Candidate 内容为空。`);
  if (extension === "json") {
    try { JSON.parse(snapshot.content.replace(/^\uFEFF/, "")); } catch { throw new CandidateConstructionOutputError("text-format", `${source.name} Candidate JSON 不完整或无效。`); }
  }
  if (/^html?$/.test(extension)
    && (!/<html\b/i.test(snapshot.content) || !/<body\b/i.test(snapshot.content) || !/<\/html\s*>/i.test(snapshot.content))) {
    throw new CandidateConstructionOutputError("text-format", `${source.name} Candidate HTML 缺少完整 html/body 容器。`);
  }
  const blob = new Blob([snapshot.content], { type: source.mimeType || "text/plain;charset=utf-8" });
  if (decodeArtifactUtf8(await blob.arrayBuffer()) !== snapshot.content) throw new Error(`${source.name} Candidate 文本物化不一致。`);
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

export async function materializeServerCandidateArtifacts(
  project:EvolveProject,
  candidate:Candidate,
  artifacts:Array<{sourceArtifactId:string;name:string;mimeType:string;content:string;notes?:string[];buildMode?:"ai-full"|"deterministic"|"external-target"}>,
  summary:string,
  parentCandidate?:Candidate,
  constructionBoundary?:{parentTexts:ReadonlyMap<string,string>;originalTexts:ReadonlyMap<string,string>;outputContexts?:Parameters<typeof requireServerCandidateOutputModes>[0]},
):Promise<Candidate>{
  const targets=project.sourceArtifacts.filter((artifact)=>artifact.role==="target");
  if(!targets.length||new Set(targets.map(target=>target.id)).size!==targets.length) throw new Error("Target 输入身份缺失或重复。");
  const targetIds=new Set(targets.map(target=>target.id));
  if(artifacts.some(artifact=>!targetIds.has(artifact.sourceArtifactId))||new Set(artifacts.map(artifact=>artifact.sourceArtifactId)).size!==artifacts.length) throw new Error("Candidate 输出包含未知或重复的 Target 身份；禁止自动重生成。");
  const bySource=new Map(artifacts.map((artifact)=>[artifact.sourceArtifactId,artifact]));
  if(artifacts.length!==targets.length||targets.some((target)=>!bySource.has(target.id))){
    throw new CandidateConstructionOutputError("missing-target", `Server Artifact Builder 返回 ${artifacts.length} 个成果，但当前有 ${targets.length} 个 Target；禁止遗漏、重复或额外成果。`);
  }
  if(constructionBoundary?.outputContexts)requireServerCandidateOutputModes(constructionBoundary.outputContexts,artifacts);
  const prepared:Array<{source:SourceArtifact;snapshot:CandidateArtifactSnapshot;built?:{blob:Blob;checks:string[];limitations:string[]};unchanged:boolean}>=[];
  // Validate and materialize the entire set before persisting any Candidate bytes.
  for(const [index,source] of targets.entries()){
    const artifact=bySource.get(source.id)!;
    const code=source.artifactKind==="codebase"
      ||source.extension.toLowerCase()==="zip"
      ||source.artifactDescriptor?.family==="codebase"
      ||source.artifactDescriptor?.family==="package";
    const text=!code&&TEXT_FAMILY.test(source.extension);
    const parent=currentParentSnapshot(project,source.id,parentCandidate);
    const parentText=text
      ?await readServerCandidateParentText(project,source,parentCandidate)
      :parent?.content??source.textContent??"";
    if(text&&constructionBoundary?.parentTexts.has(source.id)&&constructionBoundary.parentTexts.get(source.id)!==parentText) throw new Error(source.name+" 构造期间完整父代文件发生变化；必须恢复原执行边界后重试。");
    let snapshotContent=code?composeServerCodebaseOverlay(parent?.content,artifact.content):artifact.content;
    if (text && isServerTextEditBlueprint(artifact.content)) {
      snapshotContent=checkCandidateConstructionOutput("text-edits",()=>applyExactEdits(parentText,artifact.content,{strict:true}));
    }
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
    if (!hasSourceTextArtifactFileFormat(source,snapshot.name)) {
      throw new CandidateConstructionOutputError("text-format", `${source.name} Candidate 文件名 ${snapshot.name} 不符合原文本格式 .${source.extension}。`);
    }
    const protection=text?await checkServerHtmlCandidateProtection({
      project,source,candidateContent:snapshotContent,parentText,hasParent:Boolean(parent),
      readOriginal:async()=>{
        const original=await readServerCandidateParentText({...project,searchChampion:undefined},source);
        if(constructionBoundary?.originalTexts.has(source.id)&&constructionBoundary.originalTexts.get(source.id)!==original) throw new Error(source.name+" 构造期间原始保护基线发生变化；必须恢复原执行边界后重试。");
        return original;
      },
    }):{checks:[],limitations:[]};
    if(unchanged&&parent){
      if(!await verifyServerCandidateFrozenArtifact(parent,source)) throw new Error(`${source.name} 的父代 Candidate 冻结文件不可用或身份不一致。`);
      prepared.push({source,snapshot:{...parent,id:snapshot.id},unchanged:true});
      continue;
    }
    const built=await buildSnapshotFile(project,source,snapshot,artifact.content,parentCandidate);
    built.checks.push(...protection.checks);
    built.limitations.push(...protection.limitations);
    prepared.push({source,snapshot,built,unchanged});
  }
  if(prepared.every((item)=>item.unchanged)){
    throw new CandidateConstructionOutputError("unchanged", "Candidate 与当前父代完全相同，没有产生可验证变异。");
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
  const targets = project.sourceArtifacts.filter(artifact => artifact.role === "target");
  if (!targets.length || new Set(targets.map(target=>target.id)).size !== targets.length) throw new Error("Mission 没有唯一 Target Source Artifact。");
  const pinned = new Map<string,string>();
  const originals = new Map<string,string>();
  const readPinnedText = async(source:SourceArtifact) => {
    const current = await readServerCandidateParentText(project,source);
    if(pinned.has(source.id) && pinned.get(source.id) !== current) throw new Error(source.name+" 构造期间完整父代文件发生变化；必须恢复原执行边界后重试。");
    pinned.set(source.id,current);return current;
  };
  const readPinnedOriginal = async(source:SourceArtifact) => {
    const original=await readServerCandidateParentText({...project,searchChampion:undefined},source);
    if(originals.has(source.id)&&originals.get(source.id)!==original) throw new Error(source.name+" 构造期间原始保护基线发生变化；必须恢复原执行边界后重试。");
    originals.set(source.id,original);return original;
  };
  for(const source of targets.filter(source=>TEXT_FAMILY.test(source.extension))){
    await readPinnedText(source);
    if(project.searchChampion&&requiresHtmlProtectionBaseline(project.protectedItems??[])&&(/^(html|htm)$/i.test(source.extension)||/^text\/html(?:;|$)/i.test(source.mimeType))) await readPinnedOriginal(source);
  }
  const planned = await buildServerExactCandidateArtifacts(project,candidate,readPinnedText);
  let contexts:Awaited<ReturnType<typeof buildServerCandidateTargetContext>>|undefined;
  const payload = async() => {
    contexts ??= await buildServerCandidateTargetContext(project,candidate,readPinnedText);
    for(const source of targets.filter(source=>pinned.has(source.id))) await readPinnedText(source);
    for(const source of targets.filter(source=>originals.has(source.id))) await readPinnedOriginal(source);
    return {
      project:{name:project.name,objectType:project.objectType,goal:project.goal,
        ...(project.htmlProtectionOperationalScope ? { confirmedProtectionPolicy: { policy:project.htmlProtectionOperationalScope.policy, content:project.htmlProtectionOperationalScope.content,
          instruction:"Refine configuration explanations/examples/operation text only inside existing Original card body text nodes. Keep every physical card and exact ordered element structure, all attributes, headings, control/navigation labels, CSS and JS. Never add a card, element, control, script or resource. Preserve Original meaning. Exact physical boundary checks run before any frozen write." } } : {}),evolutionCommand:project.evolutionCommand,protectedItems:project.protectedItems,editableItems:project.editableItems,acceptanceRubric:project.acceptanceRubric,currentTargets:contexts,currentParent:project.searchChampion?{id:project.searchChampion.id,versionLabel:project.searchChampion.versionLabel,score:project.searchChampion.score}:{versionLabel:project.version}},
      candidate:{id:candidate.id,title:candidate.title??candidate.name,change:candidate.change,hypothesis:candidate.hypothesis,patches:candidate.patches,risks:candidate.risks,designRationale:candidate.designRationale},
      outputInstruction:"Return exactly one artifact for every currentTargets item; sourceArtifactId must match exactly. For mutationMode text-edits, return content as JSON {kind:'text-edits',edits:[{before,after,start?,end?}]}. Copy before verbatim from source chunks or verifiedAnchors, without markers or ellipses; start/end refer to the COMPLETE parent file with end exclusive. The server applies strict edits to the complete file, preserving every untouched byte. Never rewrite a whole file from truncated context. An unchanged text Target uses an identical before/after unique anchor. Other text targets return the COMPLETE file. Codebase/package targets return JSON {kind:'codebase',overlay:true,files:[{path,content}],deletions:[path]} with actual changes, never prose or fake tests.",
    };
  };
  return runCandidateConstruction({
    initial:async()=>planned?{artifacts:planned,summary:"精确方案已应用到完整父代文件；AI Artifact Builder 未调用。"}:runServerAi("build-candidate",await payload()),
    prepare:async(response,attempt)=>{
      const artifacts=attempt?response.artifacts.map(artifact=>({...artifact,notes:[...artifact.notes,"首次完整性检查未通过，已执行一次定向构造修复并重新严格验证。"]})):response.artifacts;
      return materializeServerCandidateArtifacts(project,candidate,artifacts,response.summary,undefined,{parentTexts:pinned,originalTexts:originals,outputContexts:contexts});
    },
    recover:async({attempt,failure,previousOutput})=>{
      if(targets.some(source=>!TEXT_FAMILY.test(source.extension)||source.artifactKind==="codebase"||["codebase","package"].includes(source.artifactDescriptor?.family??""))) throw new CandidateConstructionOutputError(failure.code,failure.message);
      const base=await payload();
      const parentFingerprint=await sha256Text(JSON.stringify(await Promise.all(targets.map(async source=>[source.id,await sha256Text(pinned.get(source.id)!),originals.has(source.id)?await sha256Text(originals.get(source.id)!):null]))));
      const generation=await sha256Text(JSON.stringify([project.id,candidate.id,candidate.patches,project.campaign?.checkpoint?.round??project.campaign?.currentRound??0,parentFingerprint]));
      const boundary=CandidateConstructionBoundarySchema.parse({version:"candidate-construction-v1",missionId:project.id,candidateId:candidate.id,parentFingerprint,generation,sourceArtifactIds:targets.map(source=>source.id)});
      let remaining=24000;
      const previous=previousOutput.artifacts.map(artifact=>{const content=artifact.content.slice(0,Math.min(12000,remaining));remaining-=content.length;return {sourceArtifactId:artifact.sourceArtifactId,content};});
      return runServerAi("build-candidate",{...base,recovery:{...boundary,attempt,failure,previousOutput:previous,instruction:"Repair only the failed construction on the SAME complete parent and Candidate plan. Return every original Target and no extras. Use exact, longer unique before anchors from currentTargets or verifiedAnchors and their full-file offsets. Never invent source text, loosen matching, use chunk markers, truncate/rewrite the document, remove protected original titles/content/structure, or introduce duplicate IDs. The original failed output remains rejected; all files are revalidated before freezing."}});
    },
  });
}
