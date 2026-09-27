import { evidenceFingerprint } from "./evidence-binding";
import { acceptanceArtifacts as coreAcceptanceArtifacts, indexScopedAcceptanceResults } from "@evolution/core";
import { htmlCandidateGuard } from "./html-candidate-guard";
import {
  ArtifactAcceptanceAiResultSchema,
  BuildCandidateAiResultSchema,
  RepairArtifactAiResultSchema,
  RubricAiResultSchema,
} from "../ai/schemas";
import { runEvolveAi } from "../ai/service";
import { buildCandidateDeterministically, normalizeCandidateArtifactOutputs } from "./candidate-builder";
import { composeCandidateOnSearchChampion, projectAtSearchChampion, searchBaseCandidate } from "./search-base";
import { integritySignals, outlineFromText, retrieveTextContext } from "./context-retrieval";
import { normalizeAcceptanceRubric, rubricValidation } from "./acceptance-rubric";
import { resolveProjectArtifactStrategy } from "./artifact-strategy";
import { activeSupplementalEvidence } from "./supplemental-validation-evidence";
import { retrieveArtifactContext } from "./artifact-context";
import { buildDownloadBlob, verifyGeneratedArtifact } from "./artifact-output-builders";
import { freezeArtifact, readFrozenArtifact } from "./frozen-artifact";
import type {
  AcceptanceCriterion,
  ArtifactAcceptance,
  Candidate,
  CandidateArtifactSnapshot,
  EvolveProject,
  OutputArtifact,
  SourceArtifact,
} from "../schemas";

function now() { return new Date().toISOString(); }

function fingerprint(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}

export function chunkText(text: string, chunkSize = 6000, maxChars = 100000) {
  const bounded = text.slice(0, maxChars);
  const chunks: Array<{ index: number; start: number; end: number; text: string }> = [];
  for (let start = 0, index = 0; start < bounded.length; start += chunkSize, index += 1) {
    chunks.push({ index, start, end: Math.min(start + chunkSize, bounded.length), text: bounded.slice(start, start + chunkSize) });
  }
  return chunks;
}


function parseJsonObject(text:string){try{return JSON.parse(text) as Record<string,unknown>}catch{return undefined}}
function artifactIntegrity(original: SourceArtifact | undefined, snapshot: CandidateArtifactSnapshot){
  const generic=integritySignals(original?.textContent||original?.textExcerpt,snapshot.content);
  if(!original) return generic;
  if(original.artifactKind==="presentation"){
    const data=parseJsonObject(snapshot.content); const slides=Array.isArray(data?.slides)?data!.slides as Array<Record<string,unknown>>:[];
    const valid=slides.length>0&&slides.every((slide)=>typeof slide.number==="number"&&Array.isArray(slide.textRuns));
    const emptyRuns=slides.flatMap((slide)=>Array.isArray(slide.textRuns)?slide.textRuns:[]).filter((run)=>typeof run==="string"?!run.trim():typeof run==="object"&&run!==null&&"text" in run?!String((run as Record<string,unknown>).text??"").trim():false).length;
    return {...generic, structured:true, structuredKind:"presentation", structuredUnits:slides.length, emptyStructuredUnits:emptyRuns, suspiciouslyShort:false, empty:!valid, newPlaceholderMarkers:generic.newPlaceholderMarkers};
  }
  if(original.artifactDescriptor?.adapterId==="document-docx-ooxml"){
    const data=parseJsonObject(snapshot.content); const parts=Array.isArray(data?.parts)?data!.parts as Array<Record<string,unknown>>:[];
    const sourceParts=((original.structuredContent as {parts?:Array<{path:string}>}|undefined)?.parts??[]).map((part)=>part.path);
    const evolvedPaths=parts.map((part)=>String(part.path??""));
    const missing=sourceParts.filter((path)=>!evolvedPaths.includes(path));
    const invalid=parts.filter((part)=>!String(part.path??"").trim()||!Array.isArray(part.textRuns)).length;
    return {...generic,structured:true,structuredKind:"docx",structuredUnits:parts.length,emptyStructuredUnits:missing.length+invalid,suspiciouslyShort:false,empty:parts.length===0||missing.length>0||invalid>0,newPlaceholderMarkers:generic.newPlaceholderMarkers};
  }
  if(original.artifactKind==="codebase"){
    const data=parseJsonObject(snapshot.content); const files=Array.isArray(data?.files)?data!.files as Array<Record<string,unknown>>:[];
    const invalid=files.filter((file)=>!String(file.path??"").trim()||!String(file.content??"").trim()).length;
    return {...generic, structured:true, structuredKind:"codebase", structuredUnits:files.length, emptyStructuredUnits:invalid, suspiciouslyShort:false, empty:files.length===0||invalid>0, newPlaceholderMarkers:generic.newPlaceholderMarkers};
  }
  if(original.artifactDescriptor?.family==="package"){
    const data=parseJsonObject(snapshot.content); const files=Array.isArray(data?.files)?data!.files as Array<Record<string,unknown>>:[];
    const manifest=new Set(((original.structuredContent as {manifest?:string[]}|undefined)?.manifest??original.structure??[]).map((item)=>String(item)));
    const invalid=files.filter((file)=>!String(file.path??"").trim()||typeof file.content!=="string").length;
    const unknownPaths=files.filter((file)=>manifest.size>0&&!manifest.has(String(file.path??""))).length;
    return {...generic, structured:true, structuredKind:"package", structuredUnits:files.length, emptyStructuredUnits:invalid+unknownPaths, suspiciouslyShort:false, empty:files.length===0||invalid>0||unknownPaths>0, newPlaceholderMarkers:generic.newPlaceholderMarkers};
  }
  if(original.artifactKind==="spreadsheet"){
    const data=parseJsonObject(snapshot.content); const sheets=Array.isArray(data?.sheets)?data!.sheets as Array<Record<string,unknown>>:[];
    const sourceSheets=((original.structuredContent as {sheets?:Array<{name:string}>}|undefined)?.sheets??[]).map((sheet)=>sheet.name);
    const evolvedNames=sheets.map((sheet)=>String(sheet.name??"")); const missing=sourceSheets.filter((name)=>!evolvedNames.includes(name));
    return {...generic, structured:true, structuredKind:"spreadsheet", structuredUnits:sheets.length, emptyStructuredUnits:missing.length, suspiciouslyShort:false, empty:sheets.length===0||missing.length>0, newPlaceholderMarkers:generic.newPlaceholderMarkers};
  }
  return generic;
}

function compactStructuredContent(artifact: SourceArtifact) {
  const data = artifact.structuredContent as Record<string, unknown> | undefined;
  if (!data) return undefined;
  if (artifact.artifactDescriptor?.adapterId === "codebase-zip-repository" || artifact.artifactDescriptor?.adapterId === "package-zip-generic") {
    const repository = data.repositoryIntelligence as Record<string, unknown> | undefined;
    return {
      kind: data.kind,
      manifestCount: Array.isArray(data.manifest) ? data.manifest.length : artifact.structure.length,
      inventory: data.inventory,
      selectedTextFiles: data.selectedTextFiles,
      selectedTextChars: data.selectedTextChars,
      semanticPrimaryPaths: Array.isArray(data.semanticPrimaryPaths) ? data.semanticPrimaryPaths.slice(0, 100) : [],
      evidenceOnlyPaths: Array.isArray(data.evidenceOnlyPaths) ? data.evidenceOnlyPaths.slice(0, 40) : [],
      repositoryIntelligence: repository ? {
        totalEntries: repository.totalEntries,
        deepIndexedEntries: repository.deepIndexedEntries,
        codeFiles: repository.codeFiles,
        parsedCodeFiles: repository.parsedCodeFiles,
        indexedSymbols: repository.indexedSymbols,
        internalImports: repository.internalImports,
        resolvedInternalImports: repository.resolvedInternalImports,
        entrypoints: Array.isArray(repository.entrypoints) ? repository.entrypoints.slice(0, 12) : [],
        criticalModules: Array.isArray(repository.criticalModules) ? repository.criticalModules.slice(0, 18) : [],
        featureClusters: Array.isArray(repository.featureClusters) ? repository.featureClusters.slice(0, 12) : [],
      } : undefined,
    };
  }
  if (artifact.artifactKind === "presentation") {
    const slides = Array.isArray(data.slides) ? data.slides as Array<Record<string, unknown>> : [];
    return { kind: data.kind, slideCount: slides.length, slides: slides.slice(0, 12).map((slide) => ({ number: slide.number, path: slide.path, textRunCount: Array.isArray(slide.textRuns) ? slide.textRuns.length : 0 })) };
  }
  if (artifact.artifactKind === "spreadsheet") {
    const sheets = Array.isArray(data.sheets) ? data.sheets as Array<Record<string, unknown>> : [];
    return { kind: data.kind, sheets: sheets.map((sheet) => ({ name: sheet.name, rowCount: Array.isArray(sheet.rows) ? sheet.rows.length : undefined, cellCount: Array.isArray(sheet.cells) ? sheet.cells.length : undefined })).slice(0, 20) };
  }
  if (artifact.artifactDescriptor?.adapterId === "document-docx-ooxml") {
    const parts = Array.isArray(data.parts) ? data.parts as Array<Record<string, unknown>> : [];
    return { kind: data.kind, partCount: parts.length, parts: parts.slice(0, 30).map((part) => ({ path: part.path, textRunCount: Array.isArray(part.textRuns) ? part.textRuns.length : 0 })) };
  }
  try {
    const text = JSON.stringify(data);
    return text.length <= 12000 ? data : { kind: data.kind, summary: text.slice(0, 12000), truncated: true };
  } catch { return { kind: data.kind }; }
}

function sourceForAi(artifact: SourceArtifact, query = "", contextChars?: number) {
  const text = artifact.textContent || artifact.textExcerpt || "";
  return {
    id: artifact.id,
    name: artifact.name,
    mimeType: artifact.mimeType,
    role: artifact.role,
    artifactKind: artifact.artifactKind,
    artifactDescriptor: artifact.artifactDescriptor,
    parsingProfile: artifact.parsingProfile,
    summary: artifact.summary,
    structure: artifact.structure?.length ? artifact.structure.slice(0, 120) : outlineFromText(text),
    structuredContent: compactStructuredContent(artifact),
    warnings: artifact.warnings,
    length: text.length,
    context: contextChars === 0 ? undefined : retrieveTextContext(text, query || `${artifact.name} ${artifact.summary || ""}`, { maxChars: contextChars ?? (artifact.role === "target" ? 18000 : 7000) }),
  };
}

function compactSourceUnderstanding(project: EvolveProject) {
  const value = project.sourceUnderstanding;
  if (!value) return undefined;
  return {
    currentStateSummary: value.currentStateSummary,
    evolutionIntent: value.evolutionIntent,
    detectedObjectType: value.detectedObjectType,
    acceptanceCriteria: value.acceptanceCriteria,
    artifactSummaries: value.artifactSummaries?.slice(0, 16),
    followUpQuestions: value.followUpQuestions?.slice(0, 6),
  };
}

function candidateRubric(project: EvolveProject, candidate: Candidate) {
  const artifactIds = new Set(candidate.patches.flatMap((patch) => patch.artifactId ? [patch.artifactId] : []));
  return [...project.acceptanceRubric]
    .filter((criterion) => !criterion.artifactIds.length || criterion.artifactIds.some((id) => artifactIds.has(id)) || criterion.hardGate)
    .sort((a, b) => Number(b.hardGate) - Number(a.hardGate) || b.weight - a.weight)
    .slice(0, 10);
}


export async function ensureAcceptanceRubric(project: EvolveProject, options?: { force?: boolean }): Promise<AcceptanceCriterion[]> {
  if (!options?.force && project.acceptanceRubric.length >= 3 && rubricValidation(project.acceptanceRubric).ready) return normalizeAcceptanceRubric(project.acceptanceRubric, project);
  const result = RubricAiResultSchema.parse(await runEvolveAi("rubric", {
    project: {
      name: project.name,
      objectType: project.objectType,
      aiProfile: project.aiProfile,
      goal: project.goal,
      evolutionCommand: project.evolutionCommand,
      acceptanceCriteria: project.sourceUnderstanding?.acceptanceCriteria ?? [],
      protectedItems: project.protectedItems,
      editableItems: project.editableItems,
      metrics: project.metrics,
      sourceUnderstanding: project.sourceUnderstanding,
      artifactGraph: project.artifactGraph,
      semanticEvolution: project.semanticEvolution,
      semanticObject: project.semanticEvolution?.semanticObject,
      evolutionIntentModel: project.semanticEvolution?.intent,
      adaptiveStrategy: resolveProjectArtifactStrategy(project),
    },
    // Rubric compilation needs requirements and structure, not 100k full bodies.
    targetArtifacts: project.sourceArtifacts.filter((artifact) => artifact.role === "target").map((artifact) => sourceForAi(artifact, `${project.evolutionCommand} ${project.goal}`)),
  }));
  return normalizeAcceptanceRubric(result.criteria, project);
}


async function prepareActualFiles(project: EvolveProject, candidate: Candidate): Promise<Candidate> {
  const targets = project.sourceArtifacts.filter((source) => source.role === "target");
  const snapshots = candidate.artifactSnapshots;
  if (snapshots.length !== targets.length || new Set(snapshots.map((s) => s.sourceArtifactId)).size !== targets.length || targets.some((t) => !snapshots.some((s) => s.sourceArtifactId === t.id))) throw new Error("候选遗漏或重复了进化对象，已停止实验。");
  const activeBase = projectAtSearchChampion(project);
  const guardProjects = activeBase === project ? [project] : [project, activeBase];
  const guardFailures = [...new Set(guardProjects.flatMap((current) => htmlCandidateGuard(current, snapshots).flatMap((report) => report.issues)))];
  if (guardFailures.length) throw new Error(`HTML 候选前置检查失败：${guardFailures.join("；")}`);
  const prepared: CandidateArtifactSnapshot[] = [];
  const parent = searchBaseCandidate(project);
  const parentBySource = new Map(parent?.artifactSnapshots.map((snapshot) => [snapshot.sourceArtifactId, snapshot.content.trim()]) ?? []);
  const noNewMutation = parent
    ? snapshots.every((snapshot) => snapshot.content.trim() === parentBySource.get(snapshot.sourceArtifactId))
    : snapshots.every((snapshot) => snapshot.content.trim() === targets.find((source) => source.id === snapshot.sourceArtifactId)?.textContent?.trim());
  if (noNewMutation) throw new Error(parent ? "候选与当前 Search Champion 完全相同，没有产生新的可验证变异。" : "候选没有产生实际内容变化，请调整改进方案；未修改的原版不能作为进化成果。");
  for (const snapshot of snapshots) {
    const source = targets.find((t) => t.id === snapshot.sourceArtifactId)!;
    const built = await buildDownloadBlob(source, snapshot);
    const verified = await verifyGeneratedArtifact(source, snapshot, built.blob);
    const frozenArtifact = await freezeArtifact({sourceArtifactId:source.id,content:snapshot.content,blob:built.blob,name:built.name,...verified});
    prepared.push({...snapshot,frozenArtifact});
  }
  return {...candidate,artifactSnapshots:prepared,artifactBuildStatus:"ready",artifactBuildSummary:`${prepared.length} 份实际文件已生成并完成结构核对；继续验证用户目标。`};
}

export async function buildCandidateArtifacts(project: EvolveProject, candidate: Candidate): Promise<Candidate> {
  // Candidate mutation reads from the accepted Search Champion when one exists, but final file
  // construction/guards still bind to the immutable original project for end-to-end traceability.
  const baseProject = projectAtSearchChampion(project);
  const targets = baseProject.sourceArtifacts.filter((artifact) => artifact.role === "target");
  if (!targets.length) return { ...candidate, artifactBuildStatus: "failed", artifactBuildSummary: "没有 Target Source Artifact" };

  let preflightFailure: string | undefined;
  if (candidate.artifactBuildStatus === "ready" && candidate.artifactSnapshots.length) {
    try { return await prepareActualFiles(project, composeCandidateOnSearchChampion(project, candidate)); }
    catch (error) { if (!(error instanceof Error) || !error.message.startsWith("HTML 候选前置检查失败")) throw error; preflightFailure = error.message; }
  }

  // Fast path: exact heading/full-section patches are applied to the CURRENT champion snapshot,
  // not repeatedly to V1. Structured deltas are composed with the parent before materialization.
  const deterministic = buildCandidateDeterministically(candidate, targets);
  if (deterministic && !preflightFailure) {
    const cumulative = composeCandidateOnSearchChampion(project, { ...candidate, artifactSnapshots: deterministic.snapshots, artifactBuildStatus: "ready", artifactBuildSummary: deterministic.summary });
    try { return await prepareActualFiles(project, cumulative); }
    catch (error) { if (!(error instanceof Error) || !error.message.startsWith("HTML 候选前置检查失败")) throw error; preflightFailure = error.message; }
  }

  // Slow path only when patch cannot be applied deterministically. Put common current-version
  // source context before candidate-specific data to improve provider prefix-cache hit rate.
  const query = `${candidate.title || candidate.name} ${candidate.change} ${candidate.patches.map((patch) => `${patch.target} ${patch.rationale}`).join(" ")} ${project.evolutionCommand}`;
  // A long text target used to send the same source twice (8k overview + 18k adaptive excerpt),
  // often together with the entire project graph. This made small HTML edits a large generation
  // request and exhausted slower reasoning models before they could emit the JSON blueprint.
  const largeTextTarget = targets.some((artifact) => /^(html?|xhtml|md|markdown|txt|css|js|ts|tsx|jsx|json|yaml|yml|svg)$/i.test(artifact.extension) && (artifact.textContent?.length ?? 0) > 32000);
  const targetContexts = await Promise.all(targets.map(async (artifact) => ({
    ...sourceForAi(artifact, query, largeTextTarget ? 0 : 8000),
    adaptiveContext: await retrieveArtifactContext(artifact, query, largeTextTarget ? 12000 : 18000),
  })));
  const references = baseProject.sourceArtifacts.filter((artifact) => artifact.role === "reference");
  const referenceContexts = await Promise.all(references.map(async (artifact) => ({
    ...sourceForAi(artifact, candidate.hypothesis || candidate.change, largeTextTarget ? 0 : 4000),
    adaptiveContext: await retrieveArtifactContext(artifact, candidate.hypothesis || candidate.change, largeTextTarget ? 4000 : 6000),
  })));
  const anchorHints = targets.map((artifact) => {
    const source = artifact.textContent ?? "";
    const candidates = [
      ...(candidate.designRationale?.sourceEvidence ?? []),
      ...candidate.patches.filter((patch) => !patch.artifactId || patch.artifactId === artifact.id).map((patch) => patch.target),
    ];
    const anchors = candidates.flatMap((text) => {
      const start = text ? source.indexOf(text) : -1;
      return start >= 0 && source.indexOf(text, start + 1) < 0 ? [{ start, end: start + text.length, text }] : [];
    }).slice(0, 8);
    return { sourceArtifactId: artifact.id, anchors };
  });
  const basePayload = {
    htmlPreflight: { previousFailure: preflightFailure, instruction: "Retain all original protected slide IDs, titles, body content and structure. Use fresh unique IDs for added slide cards; do not append a second element with an existing ID. Prefer exact local text edits; all untouched original bytes remain intact. Address the actual requested tutorial steps and error recovery content, not only CSS. Local guard runs before judging and rejects any protection loss or new duplicate IDs." },
    project: {
      name: project.name,
      objectType: project.objectType,
      aiProfile: project.aiProfile,
      goal: project.goal,
      evolutionCommand: project.evolutionCommand,
      protectedItems: project.protectedItems,
      editableItems: project.editableItems,
      acceptanceRubric: candidateRubric(project, candidate),
      sourceUnderstanding: compactSourceUnderstanding(project),
      artifactGraph: largeTextTarget ? undefined : project.artifactGraph,
      semanticEvolution: largeTextTarget ? undefined : project.semanticEvolution,
      semanticObject: largeTextTarget ? undefined : project.semanticEvolution?.semanticObject,
      evolutionIntentModel: largeTextTarget ? undefined : project.semanticEvolution?.intent,
      adaptiveStrategy: resolveProjectArtifactStrategy(project),
      existingSearchChampion: project.searchChampion ? { versionLabel: project.searchChampion.versionLabel, patches: project.searchChampion.patches } : undefined,
    },
    outputInstruction: "For edits inside an HTML section with a unique ID, prefer content JSON {kind:'html-edits',edits:[{targetId:'slide-56',operation:'prepend'|'append'|'replace',content:'HTML fragment'}]}. prepend/append insert INSIDE the existing element; never include its outer element or duplicate its ID. For replacement return exactly one complete target element retaining its ID. Merge overlapping edits into one replacement. The program preserves all bytes outside the selected element. For text/html/md/css/js/ts files longer than 32000 chars, do NOT regenerate the full document from excerpts. Set content to JSON {kind:'text-edits',edits:[{start,end,before,after}]}. Preserve every untouched byte. before must be a unique verbatim source block with no chunk markers or ellipses; when an anchorHints entry applies, copy its text/start/end exactly. Use enough surrounding source to make before unique. start/end are zero-based offsets and end is exclusive. For native Office formats keep the existing structured format.",
    targetArtifacts: targetContexts,
    referenceArtifacts: referenceContexts,
    anchorHints,
    candidate: { id: candidate.id, title: candidate.title, change: candidate.change, hypothesis: candidate.hypothesis, patches: candidate.patches, risks: candidate.risks },
  };
  const prepareResult = async (result: ReturnType<typeof BuildCandidateAiResultSchema.parse>, attempt: "initial" | "recovery") => {
    const normalizedArtifacts = normalizeCandidateArtifactOutputs(targets, result.artifacts);
    const snapshots: CandidateArtifactSnapshot[] = normalizedArtifacts.map((artifact, index) => ({
      id: `candidate-artifact-${candidate.id}-${index}-${Date.now()}`, sourceArtifactId: artifact.sourceArtifactId, name: artifact.name, mimeType: artifact.mimeType, content: artifact.content, contentHash: fingerprint(artifact.content), buildMode: artifact.buildMode, notes: [...artifact.notes, ...(attempt === "recovery" ? ["首次构造未通过本地完整性检查，已按具体失败原因自动修复并重新生成。"] : [])], createdAt: now(),
    }));
    return prepareActualFiles(project, composeCandidateOnSearchChampion(project, { ...candidate, artifactSnapshots: snapshots, artifactBuildStatus: "ready", artifactBuildSummary: result.summary }));
  };
  const first = BuildCandidateAiResultSchema.parse(await runEvolveAi("build-candidate", basePayload));
  try {
    return await prepareResult(first, "initial");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Missing local source/blob or a required external renderer cannot be repaired by asking the
    // model to rewrite content. All other content/anchor/shape failures get one targeted retry.
    if (/已取消|持久保存|原始文件不可用|需要外部|Renderer|需要原生|无法连接/.test(reason)) throw error;
    const recovery = BuildCandidateAiResultSchema.parse(await runEvolveAi("build-candidate", {
      ...basePayload,
      recovery: {
        attempt: 1,
        failure: reason,
        previousOutput: first.artifacts.map((artifact) => ({ sourceArtifactId: artifact.sourceArtifactId, content: artifact.content.slice(0, 12000), notes: artifact.notes })),
        instruction: "Repair the failed artifact construction, not the product goal. Return one artifact for every target and no extras. For a text-edits failure, choose a longer unique before block copied verbatim from targetArtifacts/adaptiveContext or anchorHints; never copy [chunk ...] markers. Keep the intended after content and use verified zero-based offsets when available. For an HTML duplicate-ID or overlapping-edit failure, use html-edits against the ORIGINAL unique targetId. Return only inserted children for prepend/append. Combine all changes to the same section in one edit. Do not rewrite the complete document during recovery.",
      },
    }));
    try { return await prepareResult(recovery, "recovery"); }
    catch (recoveryError) {
      const recoveryReason = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
      throw new Error(`${candidate.title || candidate.name} 的实际文件构造失败：首次 ${reason}；自动修复后 ${recoveryReason}`, { cause: recoveryError });
    }
  }
}


export async function acceptCandidateArtifacts(project: EvolveProject, candidate: Candidate, criteria: AcceptanceCriterion[]): Promise<ArtifactAcceptance> {
  const binding = evidenceFingerprint({ ...project, acceptanceRubric: criteria }, candidate);
  const result = await acceptCandidateArtifactsUnbound(project, candidate, criteria);
  return { ...result, evidenceFingerprint: binding };
}

async function acceptCandidateArtifactsUnbound(project: EvolveProject, candidate: Candidate, criteria: AcceptanceCriterion[]): Promise<ArtifactAcceptance> {
  if (!candidate.artifactSnapshots.length) throw new Error("Candidate 尚未构造成完整 Artifact Snapshot");
  const originals = project.sourceArtifacts.filter((artifact) => artifact.role === "target");
  const originalById = new Map(originals.map((artifact) => [artifact.id, artifact]));
  const ids = candidate.artifactSnapshots.map((snapshot) => snapshot.sourceArtifactId);
  if (new Set(ids).size !== ids.length || ids.length !== originals.length || originals.some((source) => !ids.includes(source.id))) throw new Error("候选成果与进化对象不一一对应：存在遗漏、重复或未知文件。请重新生成完整候选。");
  const frozenArtifacts: NonNullable<ArtifactAcceptance["frozenArtifacts"]> = [];
  try {
    for (const snapshot of candidate.artifactSnapshots) {
      const source = originalById.get(snapshot.sourceArtifactId)!;
      if (snapshot.frozenArtifact && snapshot.frozenArtifact.sourceArtifactId === source.id) {
        await readFrozenArtifact(snapshot.frozenArtifact, snapshot.content);
        frozenArtifacts.push(snapshot.frozenArtifact);
        continue;
      }
      const built = await buildDownloadBlob(source, snapshot);
      const verified = await verifyGeneratedArtifact(source, snapshot, built.blob);
      frozenArtifacts.push(await freezeArtifact({ sourceArtifactId: source.id, content: snapshot.content, blob: built.blob, name: built.name, ...verified }));
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "生成文件验证失败";
    const unavailable = /不可用|持久保存|需要外部|需要原生|当前需要|需要对应/.test(reason);
    return { id:`artifact-file-${Date.now()}`, status:unavailable ? "unverified" : "failed", candidateId:candidate.id, overallScore:0, coverageScore:0, integrityScore:0, pairwiseScore:0, hardGatePass:false, results:[], attempts:0, maxRepairAttempts:project.artifactAcceptance.maxRepairAttempts ?? 3, summary:`${unavailable ? "待验证" : "实际文件检查失败"}：${reason}`, lastCheckedAt:now() };
  }
  const evidenceFor = (criterion: AcceptanceCriterion) => {
    const scoped = candidate.artifactSnapshots.filter((snapshot) => !criterion.artifactIds.length || criterion.artifactIds.includes(snapshot.sourceArtifactId));
    const query = `${criterion.title} ${criterion.requirement} ${criterion.evidenceExpected.join(" ")}`;
    return {
      criterionId: criterion.id,
      requirement: criterion.requirement,
      evidenceExpected: criterion.evidenceExpected,
      artifactIds: criterion.artifactIds,
      original: scoped.map((snapshot) => { const original=originalById.get(snapshot.sourceArtifactId); return { sourceArtifactId:snapshot.sourceArtifactId,name:original?.name??snapshot.name,artifactKind:original?.artifactKind,outline:outlineFromText(original?.textContent||original?.textExcerpt),excerpt:retrieveTextContext(original?.textContent||original?.textExcerpt,query,{maxChars:3200,maxChunks:2}) }; }),
      evolved: scoped.map((snapshot) => ({ sourceArtifactId:snapshot.sourceArtifactId,name:snapshot.name,outline:outlineFromText(snapshot.content),excerpt:retrieveTextContext(snapshot.content,query,{maxChars:4800,maxChunks:2}) })),
    };
  };
  const evidenceByCriterion = criteria.map(evidenceFor);
  const integrity = candidate.artifactSnapshots.map((snapshot) => { const original=originalById.get(snapshot.sourceArtifactId); return { sourceArtifactId:snapshot.sourceArtifactId,name:snapshot.name,artifactKind:original?.artifactKind,...artifactIntegrity(original,snapshot) }; });
  const deterministicIntegrityPass = integrity.every((item) => !item.empty && !item.suspiciouslyShort && item.newPlaceholderMarkers === 0);
  const maxRepairAttempts = project.artifactAcceptance.maxRepairAttempts ?? 3;
  const supplementalEvidence = activeSupplementalEvidence(project, candidate);
  const acceptanceBinding = evidenceFingerprint({ ...project, acceptanceRubric: criteria }, candidate);
  const validationReusable = project.validationRun.status === "completed"
    && project.validationRun.candidateId === candidate.id
    && project.validationRun.evidenceFingerprint === acceptanceBinding
    && !project.validationRun.evaluation?.demoJudged;
  const validatedById = indexScopedAcceptanceResults([{
    requestedCriterionIds: criteria.map((criterion) => criterion.id),
    results: validationReusable ? project.validationRun.evaluation?.criterionScores ?? [] : [],
  }]).byId;
  const preResolved = new Map<string, ArtifactAcceptance["results"][number]>();
  const frozenIds = new Set(frozenArtifacts.map((artifact) => artifact.sourceArtifactId));
  for (const criterion of criteria) {
    const scopedIds = criterion.artifactIds.length ? criterion.artifactIds : candidate.artifactSnapshots.map((snapshot) => snapshot.sourceArtifactId);
    if (criterion.validationMethod === "format-roundtrip" && scopedIds.length > 0 && scopedIds.every((id) => frozenIds.has(id))) {
      preResolved.set(criterion.id, { criterionId:criterion.id,score:100,pass:true,evidence:scopedIds.map((id)=>`${id}: 实际生成文件已通过 build/verify/freeze 原格式检查`),gaps:[],note:"deterministic actual-file roundtrip evidence" });
      continue;
    }
    if (criterion.id === "SYS-INTEGRITY" && deterministicIntegrityPass) {
      preResolved.set(criterion.id, { criterionId:criterion.id,score:100,pass:true,evidence:integrity.map((item)=>`${item.name}: 完整、无异常截短、无新增占位符`),gaps:[],note:"deterministic artifact integrity evidence" });
      continue;
    }
    const validated = validatedById.get(criterion.id);
    if (validated?.verificationStatus === "verified") {
      preResolved.set(criterion.id, {
        criterionId: criterion.id, score: validated.score, pass: validated.pass && validated.score >= criterion.minScore,
        evidence: [`Hidden Validation（同一成果指纹）`, ...validated.evidence].slice(0,6), gaps: validated.gaps.slice(0,6), note:"reused exact-fingerprint Hidden Validation evidence",
      });
    }
  }

  // Fast Gate 0: deterministic structure/integrity failure does not need an expensive full LLM rubric pass.
  if (!deterministicIntegrityPass) {
    const integrityCriterion=criteria.find((item)=>item.id==="SYS-INTEGRITY");
    return { id:`artifact-acceptance-${Date.now()}`,status:"failed",candidateId:candidate.id,overallScore:0,coverageScore:0,integrityScore:50,pairwiseScore:0,hardGatePass:false,results:integrityCriterion?[{criterionId:integrityCriterion.id,score:50,pass:false,evidence:integrity.map((item)=>`${item.name}: empty=${item.empty}, short=${item.suspiciouslyShort}, newPlaceholder=${item.newPlaceholderMarkers}`),gaps:["确定性完整性检查失败；已提前停止完整 LLM Rubric 评审"],note:"fast deterministic gate"}]:[],attempts:0,maxRepairAttempts,summary:"Fast Gate：成果存在截断/异常缩短/新增占位符，已提前停止后续评审以节省时间。",lastCheckedAt:now() };
  }

  const runBatches = async (subset: AcceptanceCriterion[]) => {
    const unresolved = subset.filter((criterion)=>!preResolved.has(criterion.id));
    if (!unresolved.length) return [];
    const batches: AcceptanceCriterion[][]=[]; for(let i=0;i<unresolved.length;i+=4)batches.push(unresolved.slice(i,i+4));
    const queue=[...batches]; const responses:Array<{requestedCriterionIds:string[];result:ReturnType<typeof ArtifactAcceptanceAiResultSchema.parse>}>=[];
    const workers=Array.from({length:Math.min(3,queue.length)},async()=>{while(queue.length){const batch=queue.shift();if(!batch)break;const ids=new Set(batch.map((item)=>item.id));const result=ArtifactAcceptanceAiResultSchema.parse(await runEvolveAi("artifact-acceptance",{
      aiProfile:project.aiProfile,
      project:{name:project.name,objectType:project.objectType,goal:project.goal,evolutionCommand:project.evolutionCommand,protectedItems:project.protectedItems,metrics:project.metrics,sourceUnderstanding:project.sourceUnderstanding,artifactGraph:project.artifactGraph,semanticEvolution:project.semanticEvolution,semanticObject:project.semanticEvolution?.semanticObject,evolutionIntentModel:project.semanticEvolution?.intent,adaptiveStrategy:resolveProjectArtifactStrategy(project)},
      rubric:batch,criterionEvidence:evidenceByCriterion.filter((item)=>ids.has(item.criterionId)),integritySignals:integrity,actualFileEvidence:frozenArtifacts,
      artifactMeta:candidate.artifactSnapshots.map((artifact)=>({sourceArtifactId:artifact.sourceArtifactId,name:artifact.name,mimeType:artifact.mimeType,length:artifact.content.length,contentHash:artifact.contentHash,notes:artifact.notes,descriptor:originalById.get(artifact.sourceArtifactId)?.artifactDescriptor})),
      evaluatorInstruction:"Judge ONLY this rubric subset and only its scoped artifactIds. Return every criterionId. Cite exact source offsets or actualFileEvidence checks. Excerpts are partial: do not infer whole-document coverage from an excerpt. Structural file checks do NOT prove rendering, execution, recalculation or usability. Never claim checks listed as limitations passed. Separate user requirements from AI suggestions. Hard gates cannot be averaged away. Be concise and evidence-based."
    }));responses.push({requestedCriterionIds:[...ids],result});}});await Promise.all(workers);return responses;
  };
  const normalize = (subset: AcceptanceCriterion[], responses:Array<{requestedCriterionIds:string[];result:ReturnType<typeof ArtifactAcceptanceAiResultSchema.parse>}>) => {
    const {byId:map,duplicateIds}=indexScopedAcceptanceResults(responses.map((response)=>({requestedCriterionIds:response.requestedCriterionIds,results:response.result.results})));
    return subset.map((criterion)=>{
      const item=map.get(criterion.id);
      const alreadyResolved = preResolved.get(criterion.id);
      if (alreadyResolved) return alreadyResolved;
      const supplemental = supplementalEvidence.get(criterion.id);
      if (supplemental) {
        const pass = supplemental.verdict === "pass";
        const priorScore = item ? Math.max(0, Math.min(100, item.score)) : 0;
        const label = supplemental.method === "visual-review" ? "视觉人工验收" : "人工验收";
        return {
          criterionId: criterion.id,
          score: pass ? Math.max(priorScore, criterion.minScore) : Math.min(priorScore, Math.max(0, criterion.minScore - 1)),
          pass,
          evidence: [`${label}：${supplemental.note}`, ...(supplemental.screenshotIds.length ? [`截图证据 ${supplemental.screenshotIds.length} 张（绑定当前成果指纹）`] : [])],
          gaps: pass ? [] : [`${label}明确判定未通过：${supplemental.note}`],
          note: "supplemental human evidence",
        };
      }
      if(!item)return {criterionId:criterion.id,score:0,pass:false,evidence:[],gaps:[duplicateIds.has(criterion.id)?"Evaluator 对该 Criterion 返回重复结果，证据身份不明确":"Evaluator 未返回该 Criterion 结果"],note:"missing evaluator result"};
      const score=Math.max(0,Math.min(100,item.score));
      return {...item,score,pass:item.pass&&score>=criterion.minScore&&item.evidence.some(e=>e.trim().length>0)};
    });
  };

  // Fast Gate 1: evaluate non-negotiable requirements first. Most bad candidates stop here.
  const hardCriteria=criteria.filter((item)=>item.hardGate);
  const hardResponses=await runBatches(hardCriteria);
  const hardResults=normalize(hardCriteria,hardResponses);
  const hardGatePass=hardCriteria.every((criterion)=>hardResults.find((item)=>item.criterionId===criterion.id)?.pass===true);
  if(!hardGatePass){
    const hardAvg=Math.round(hardResults.reduce((sum,item)=>sum+item.score,0)/Math.max(1,hardResults.length));
    return {id:`artifact-acceptance-${Date.now()}`,status:"failed",candidateId:candidate.id,overallScore:hardAvg,coverageScore:hardAvg,integrityScore:100,pairwiseScore:hardResults.find((item)=>item.criterionId==="SYS-PAIRWISE")?.score??0,hardGatePass:false,results:hardResults,attempts:0,maxRepairAttempts,summary:"Fast Gate：Hard Rubric 未通过；已停止 Soft Criteria 全量评审。修复 Hard Gate 后再继续。",lastCheckedAt:now()};
  }

  // Full Gate: only candidates that survived all hard gates pay for soft/project-quality criteria.
  const softCriteria=criteria.filter((item)=>!item.hardGate);
  const softResponses=await runBatches(softCriteria);
  const softResults=normalize(softCriteria,softResponses);
  const normalizedResults=[...hardResults,...softResults];
  const allResponses=[...hardResponses,...softResponses].map((response)=>response.result);
  const weightedTotal=criteria.reduce((sum,criterion)=>sum+(normalizedResults.find((item)=>item.criterionId===criterion.id)?.score??0)*criterion.weight,0);
  const weightTotal=criteria.reduce((sum,criterion)=>sum+criterion.weight,0)||1;
  const overallScore=Math.round(weightedTotal/weightTotal);
  const requirementCriteria=criteria.filter((criterion)=>!criterion.id.startsWith("SYS-")&&!criterion.protectedConstraint);
  const requirementWeight=requirementCriteria.reduce((sum,criterion)=>sum+criterion.weight,0)||1;
  const coverageScore=Math.round(requirementCriteria.reduce((sum,criterion)=>sum+(normalizedResults.find((item)=>item.criterionId===criterion.id)?.score??0)*criterion.weight,0)/requirementWeight);
  const integrityScore=normalizedResults.find((item)=>item.criterionId==="SYS-INTEGRITY")?.score??100;
  const pairwiseScore=normalizedResults.find((item)=>item.criterionId==="SYS-PAIRWISE")?.score??Math.round(allResponses.reduce((sum,item)=>sum+item.pairwiseScore,0)/Math.max(1,allResponses.length));
  const passed=overallScore>=85&&coverageScore>=90&&integrityScore>=90&&pairwiseScore>=80;
  return {id:`artifact-acceptance-${Date.now()}`,status:passed?"passed":"failed",candidateId:candidate.id,frozenArtifacts,overallScore,coverageScore,integrityScore,pairwiseScore,hardGatePass:true,results:normalizedResults,attempts:0,maxRepairAttempts,summary:`${allResponses.map((r)=>r.summary).filter(Boolean).join("；")||"成果验收完成"}`,lastCheckedAt:now(),acceptedAt:passed?now():undefined};
}

export async function repairCandidateArtifacts(project: EvolveProject, candidate: Candidate, acceptance: ArtifactAcceptance, criteria: AcceptanceCriterion[]): Promise<Candidate> {
  const failed = criteria.flatMap((criterion) => {
    const result = acceptance.results.find((item) => item.criterionId === criterion.id);
    return result?.pass ? [] : [{ criterionId: criterion.id, requirement: criterion.requirement, minScore: criterion.minScore, hardGate: criterion.hardGate, evidenceExpected: criterion.evidenceExpected, score: result?.score ?? 0, gaps: result?.gaps ?? ["该验收项未通过"] }];
  });
  if (!failed.length) return candidate;
  const repaired = RepairArtifactAiResultSchema.parse(await runEvolveAi("repair-artifact", {
    project: {
      name: project.name,
      goal: project.goal,
      evolutionCommand: project.evolutionCommand,
      protectedItems: project.protectedItems,
      editableItems: project.editableItems,
      artifactGraph: project.artifactGraph,
      semanticEvolution: project.semanticEvolution,
      semanticObject: project.semanticEvolution?.semanticObject,
    },
    candidate: { id: candidate.id, title: candidate.title, patches: candidate.patches },
    acceptance,
    failedCriteria: failed,
    artifacts: candidate.artifactSnapshots.map((artifact) => ({ sourceArtifactId: artifact.sourceArtifactId, name: artifact.name, mimeType: artifact.mimeType, content: artifact.content, contentHash: artifact.contentHash })),
    originalArtifacts: project.sourceArtifacts.filter((artifact) => artifact.role === "target").map((artifact) => sourceForAi(artifact)),
  }));
  const snapshots: CandidateArtifactSnapshot[] = repaired.artifacts.map((artifact, index) => ({
    id: `candidate-repair-${candidate.id}-${index}-${Date.now()}`,
    sourceArtifactId: artifact.sourceArtifactId,
    name: artifact.name,
    mimeType: artifact.mimeType,
    content: artifact.content,
    contentHash: fingerprint(artifact.content),
    buildMode: "ai-full",
    notes: artifact.notes,
    createdAt: now(),
  }));
  return {
    ...candidate,
    name: `${candidate.name} · Repair ${acceptance.attempts + 1}`,
    title: `${candidate.title || candidate.name} · Acceptance Repair`,
    artifactSnapshots: snapshots,
    artifactBuildStatus: "ready",
    artifactBuildSummary: repaired.summary,
    notes: [...candidate.notes, `Artifact Repair：${repaired.summary}`],
  };
}

export function acceptanceArtifacts(project: EvolveProject, candidate: Candidate, acceptance: ArtifactAcceptance): OutputArtifact[] {
  return coreAcceptanceArtifacts(project, candidate, acceptance);
}
