import type { Candidate, EvolveProject, SourceArtifact } from "@evolution/contracts";
import {HtmlBuildBodyNodeEditsSchema} from "@evolution/contracts";
import { buildExactCandidateTextEdits, isTextArtifactExtension, isZipArtifact } from "@evolution/core";
import { retrieveTextContext, trustedServerBaselineChampion } from "@evolution/harness";
import {serverStructuredTargetContext} from "./server-structured-target-context";
import {serverHtmlBuildBodyContext} from "./server-html-build-context";

export function isServerTextEditBlueprint(content: string) {
  try { return (JSON.parse(content) as { kind?: unknown })?.kind === "text-edits"; }
  catch { return false; }
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

export async function buildServerCandidateTargetContext(
  project:EvolveProject,candidate:Candidate,readCurrentText:(source:SourceArtifact)=>Promise<string>,
  parentCandidate?:Candidate,
  readVerifiedNativeParent?:(source:SourceArtifact)=>Promise<SourceArtifact>,
  options?:{completeHtmlBuildContext?:boolean},
){
  const champion = parentCandidate ?? trustedServerBaselineChampion(project);
  const championBySource = new Map((champion?.artifactSnapshots ?? []).map((snapshot) => [snapshot.sourceArtifactId, snapshot]));
  let remaining = 72_000;
  let bodyIndexRemaining=320_000;
  const result = [];
  for (const artifact of project.sourceArtifacts.filter((artifact) => artifact.role === "target")) {
    const parent = championBySource.get(artifact.id);
    const descriptor=artifact.artifactDescriptor;
    const requiresIndexedMutation=descriptor?.adapterId==="document-docx-ooxml"
      ||descriptor?.adapterId==="presentation-pptx-ooxml"
      ||descriptor?.family==="spreadsheet"||["docx","pptx","xlsx","xls","ods","csv","tsv"].includes(artifact.extension.toLowerCase());
    const textTarget = isTextArtifactExtension(artifact.extension)&&!requiresIndexedMutation;
    if(requiresIndexedMutation&&(parentCandidate||project.searchChampion)&&!parent){
      throw new Error(`${artifact.name} 缺少 Champion 当前 Target Snapshot，禁止回退到过期 Source 索引。`);
    }
    // A last-round sparse edit omits earlier generations. Read the actual
    // SHA-verified frozen parent bytes to build cumulative editable indexes.
    const liveParent=requiresIndexedMutation&&parent&&readVerifiedNativeParent
      ?await readVerifiedNativeParent(artifact):undefined;
    const source = textTarget ? await readCurrentText(artifact)
      :liveParent?.textContent??parent?.content??artifact.textContent??artifact.textExcerpt??"";
    const htmlBody=textTarget&&options?.completeHtmlBuildContext!==false?serverHtmlBuildBodyContext(project.id,artifact.extension,source):undefined;
    const bodyNodes=project.experimentPolicy?.htmlBuildAnchorValidation==="issued-body-nodes-v1"
      &&/^html?$/i.test(artifact.extension)&&options?.completeHtmlBuildContext!==false;
    if(bodyNodes&&!htmlBody)throw new Error("HTML body node construction requires complete authorized body context");
    if(htmlBody){
      bodyIndexRemaining-=JSON.stringify(htmlBody.context).length;
      if(bodyIndexRemaining<0)throw new Error("Complete authorized HTML body indexes exceed the build context capacity; no chapters were truncated");
    }
    const allowance = Math.max(0, Math.min(22_000, remaining));
    const query = [project.goal, project.evolutionCommand, candidate.title, candidate.change, candidate.hypothesis, ...(candidate.designRationale?.sourceEvidence ?? []), ...candidate.patches.filter((patch) => !patch.artifactId || patch.artifactId === artifact.id).map((patch) => `${patch.target} ${patch.rationale}`)].join(" ");
    const content = textTarget ? retrieveTextContext(htmlBody?.markup??source, query, { maxChars: allowance, maxChunks: 6 }) : source.slice(0, allowance);
    remaining = Math.max(0, remaining - content.length);
    const indexedContext=serverStructuredTargetContext(liveParent??artifact,candidate,
      liveParent?undefined:parent?.content);
    if(requiresIndexedMutation&&!indexedContext){
      throw new Error(`${artifact.name} 缺少可编辑的文本位置或 Sheet/Cell 结构；请重新解析原文件，不能把提取的摘要当成可修改的原文件。`);
    }
    result.push({
      id: artifact.id,
      name: parent?.name ?? artifact.name,
      mimeType: parent?.mimeType ?? artifact.mimeType,
      extension: artifact.extension,
      artifactKind: artifact.artifactKind,
      descriptor: artifact.artifactDescriptor,
      structure: artifact.structure.slice(0, 120),
      currentVersion: parentCandidate?.id ?? (parent ? (project.searchChampion?.versionLabel ?? champion?.id) : project.version),
      currentSnapshotHash: parent?.contentHash,
      content,
      originalChars: source.length,
      truncated: content.length < source.length,
      mutationMode: bodyNodes?"html-build-body-node-edits-v1":htmlBody||textTarget&&content.length<source.length?"text-edits":"full",
      structuredContext:htmlBody?undefined:indexedContext??compactStructured(artifact,candidate),
      ...(htmlBody?{htmlBuildBodyContext:htmlBody.context,bodyIndexComplete:true,
        ...(project.experimentPolicy?.htmlBuildAnchorValidation==="issued-body-ranges-v1"?{bodyAnchorPolicy:"issued-body-ranges-v1" as const}:{}),
        ...(bodyNodes?{bodyAnchorPolicy:"issued-body-nodes-v1" as const}:{}),
        contentRepresentation:"non-executable body markup projection",chunkOffsetsAreProjectionOnly:true}:{}),
    });
  }
  return result;
}

export function requireServerCandidateOutputModes(contexts: Array<{id: string; name: string; mutationMode: string}>, artifacts: Array<{sourceArtifactId: string; content: string}>) {
  for (const context of contexts) {
    const output = artifacts.find((artifact) => artifact.sourceArtifactId === context.id);
    if (context.mutationMode === "text-edits" && output && !isServerTextEditBlueprint(output.content)) {
      throw new Error(`${context.name} 的 AI 上下文只是原文件片段，必须返回 text-edits；禁止用片段重写完整成果。`);
    }
    if(context.mutationMode==="html-build-body-node-edits-v1"&&output){
      let content:unknown;try{content=JSON.parse(output.content);}catch{throw new Error(`${context.name} must return complete html-build-body-node-edits-v1 JSON`);}
      HtmlBuildBodyNodeEditsSchema.parse(content);
    }
  }
}


/** Build all Target edits before freezing any file; otherwise retain the normal AI builder. */
export async function buildServerExactCandidateArtifacts(
  project: EvolveProject,
  candidate: Candidate,
  readCurrentText: (source: SourceArtifact) => Promise<string>,
) {
  const targets = project.sourceArtifacts.filter((source) => source.role === "target");
  const ids = new Set(targets.map((source) => source.id));
  if (!targets.length || ids.size !== targets.length || !candidate.patches.length
    || new Set(candidate.patches.map((patch) => patch.id)).size !== candidate.patches.length
    || targets.some((source) => !isTextArtifactExtension(source.extension)
      // Delimited files still require a sheet/cell overlay on the original bytes.
      // Never send a raw CSV/TSV string to the native spreadsheet materializer.
      || ["csv", "tsv"].includes(source.extension.toLowerCase())
      || source.artifactKind === "spreadsheet"
      || source.artifactDescriptor?.family === "spreadsheet"
      || isZipArtifact(source))
    || candidate.patches.some((patch) => patch.artifactId ? !ids.has(patch.artifactId) : targets.length !== 1)) return undefined;
  const artifacts = [];
  const champion = trustedServerBaselineChampion(project);
  for (const source of targets) {
    const patches = candidate.patches.filter((patch) => !patch.artifactId || patch.artifactId === source.id);
    const current = await readCurrentText(source);
    const content = patches.length ? buildExactCandidateTextEdits(current, patches) : current;
    if (!content) return undefined;
    const parent = champion?.artifactSnapshots.find((snapshot) => snapshot.sourceArtifactId === source.id);
    artifacts.push({sourceArtifactId: source.id, name: parent?.name ?? source.name, mimeType: parent?.mimeType ?? source.mimeType, content,
      buildMode: "deterministic" as const, notes: [patches.length ? "完整父代文件上的精确方案修改；无需再次生成文件内容。" : "该 Target 不在本次修改范围；保留完整父代文件。"]});
  }
  return artifacts;
}
