import { deliveryReadiness } from "./delivery-readiness";
import { evidenceFingerprint } from "./evidence-binding";
import { reusableBaselineRuns } from "./baseline-readiness";
import { createValidationReuse, validationImpactPriority } from "./validation-reuse";
import { getActiveAbortSignal } from "./abort-scope";
import type {ReleaseOutcomeTelemetryStatus} from "@evolution/contracts";
import { stepCompleted } from "./real-evolution-workflow";
// 原 Next Route Handler（/api/v1/intake、/api/v1/sources/ingest、/api/v1/runner/*）的
// 浏览器内等价实现：编排逻辑逐行对应 docs/reference/next-api/ 下的原始路由文件，
// 仅把 NextResponse/网络往返替换为直接函数调用；服务器落盘（persistLocal）在浏览器
// 无对应物，附件仅内存解析，storageRef 不再写入。
import { getAiProviderStatus, runEvolveAi, getOpenAIUploadFn, type AiAttemptNotice } from "../ai/service";
import type { AiOperation, IntakeAiResult } from "../ai/schemas";
import { IntakeAiResultSchema, PopulationEvaluationAiResultSchema } from "../ai/schemas";
import { evaluateRuns } from "../evaluation/service";
import { buildCandidateArtifacts } from "./artifact-quality";
import { mapTestsToRubric, normalizeAcceptanceRubric, rubricCoverage, rubricValidation } from "./acceptance-rubric";
import { describeArtifact, resolveProjectArtifactStrategy } from "./artifact-strategy";
import { buildArtifactGraph, compileSemanticEvolution } from "./semantic-evolution";
import { canRetryHoldoutFailures, candidateWinnerDecision, computeGapAnalysis, gapHeadline, indexScopedAcceptanceResults, indexScopedTestCaseResults, indexUniqueById, projectHasOnlineReleaseTarget, reusableHoldoutBaseline, REGRESSION_TOLERANCE, validationDecision, validationHardRubricFailures as hardRubricFailures, validationRegression as coreValidationRegression, validationUnverifiedHardCriteria as unverifiedHardRubricCriteria } from "@evolution/core";
import { extractSource } from "../sources/source-loader";
import { getArtifactBlob, putArtifactBlob } from "./artifact-blob-store";
import { readFrozenArtifact } from "./frozen-artifact";
import { baselineFingerprint, getHoldoutBaseline, setHoldoutBaseline } from "./round-cache";
import { criterionCanUseLocalSnapshotEvidence, normalizeEvalSuiteForProject } from "./eval-suite-normalization";
import { normalizeLocallyVerifiableCandidateRuns, retrieveTextContext } from "@evolution/harness";
import { searchBaseCandidate } from "./search-base";
import { applySupplementalEvidenceToEvaluation } from "./supplemental-validation-evidence";
import { getTargetAdapter, getTargetStatus } from "../target/registry";
import { getProductionRuntime, productionRuntimeMode } from "./production-runtime";
import { runServerReleaseAction } from "./server-release-client";
import {
  ArtifactRoleSchema,
  CandidateSchema,
  EvolveProjectSchema,
  SourceArtifactSchema,
  type ArtifactRole,
  type AdviceSettlement,
  type BaselineRun,
  type Candidate,
  type EvaluationResult,
  type EvolvedVersion,
  type EvolveProject,
  type ExperimentRun,
  type ProjectAiProfile,
  type ReleaseAdapterResult,
  type SourceArtifact,
  type TestCase,
  type TargetRunResult,
  type ValidationRun,
} from "../schemas";

function now() {
  return new Date().toISOString();
}

function evaluationProjectContext(project: EvolveProject) {
  return {
    goal: project.goal,
    metrics: project.metrics,
    acceptanceRubric: project.acceptanceRubric,
    sourceUnderstanding: project.sourceUnderstanding,
    adaptiveStrategy: resolveProjectArtifactStrategy(project),
    semanticEvolution: project.semanticEvolution,
    artifactGraph: project.artifactGraph,
    aiProfile: project.aiProfile,
  };
}

// 并发执行测试题：真实模型下单题可能几十秒，串行会把整轮 Baseline / 实验拖到十几分钟。
// 浏览器同源并发有限（~6），取 4 并保留结果顺序，与评测聚合逻辑等价。
export const CASE_CONCURRENCY = 5;

// 拍平多候选 / 双考卷后的总并发上限：浏览器对同一域名连接数约 6，
// 多个互不依赖的作答共享一个池子才能吃满连接配额，也不超限触发排队。
const TOTAL_CONCURRENCY = 6;

export class CandidateArtifactBuildError extends Error {
  readonly candidates: Candidate[];
  constructor(candidates: Candidate[]) {
    const details = candidates.slice(0, 4).map((candidate) => `${candidate.title || candidate.name}：${candidate.artifactBuildSummary || "未知构造错误"}`);
    const remaining = candidates.length - details.length;
    super(`所选 ${candidates.length} 个 Candidate 均未生成可运行文件。${details.join("；")}${remaining > 0 ? `；另有 ${remaining} 个失败` : ""}`);
    this.name = "CandidateArtifactBuildError";
    this.candidates = candidates;
  }
}

/**
 * 单题容错执行：失败先重试一次（限流/瞬时超时大多能重试化解）；
 * 再失败转为「执行失败」题继续跑其余题——一道坏题不再报废整段已完成的评测。
 */
async function resilientCase(run: () => Promise<TargetRunResult>, testCaseId: string): Promise<TargetRunResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      // V2.2 latency guard: an operation-level timeout/fallback may already have spent 45–120s.
      // Repeating the exact same long request immediately can double the user's wait with little
      // chance of recovery. Only retry genuinely transient rate/server/network failures.
      const retryable = /429|rate.?limit|temporar|network|fetch failed|ECONNRESET|502|503|504|server error/i.test(message);
      if (!retryable || /timeout|timed out|abort/i.test(message)) break;
    }
  }
  const message = lastError instanceof Error ? lastError.message : "unknown error";
  return { testCaseId, output: `（本题执行失败：${message}）`, latencyMs: 0, cost: 0, trace: [], error: message, verificationStatus: "failed" };
}

async function pooled<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>, onDone?: (done: number, total: number) => void): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let done = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
      done += 1;
      onDone?.(done, items.length);
    }
  }));
  return results;
}

function byteLength(text: string) {
  return new TextEncoder().encode(text).length;
}

function imageDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ===== POST /api/v1/intake =====

const MAX_FILES = 12;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;


function extension(name: string) {
  const value = name.split(".").pop()?.toLowerCase();
  return value && value !== name.toLowerCase() ? value : "";
}
function artifactId(index: number) { return `artifact-${Date.now()}-${index + 1}`; }
function isImage(file: File) { return file.type.startsWith("image/"); }
function parseRoles(raw: FormDataEntryValue | null, count: number): ArtifactRole[] {
  try {
    const value = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(value)) throw new Error("invalid roles");
    return Array.from({ length: count }, (_, i) => ArtifactRoleSchema.catch("target").parse(value[i] ?? (i === 0 ? "target" : "reference")));
  } catch {
    return Array.from({ length: count }, (_, i) => i === 0 ? "target" : "reference");
  }
}

export async function runIntake(formData: FormData): Promise<{ intake: IntakeAiResult; artifacts: SourceArtifact[]; provider: { provider: string; live: boolean; model: string } }> {
  const command = String(formData.get("command") || "").trim();
  const pastedText = String(formData.get("pastedText") || "").trim();
  const department = String(formData.get("department") || "其他");
  const requestedObjectType = String(formData.get("requestedObjectType") || "auto");
  const conversation = String(formData.get("conversation") || "").trim();
  let aiProfile: ProjectAiProfile | undefined;
  try { const raw = String(formData.get("aiProfile") || ""); if (raw) aiProfile = JSON.parse(raw) as ProjectAiProfile; } catch { aiProfile = undefined; }
  const files = formData.getAll("files").filter((value): value is File => value instanceof File);

  if (!command && !pastedText && files.length === 0) throw new Error("请上传需要进化的内容，并告诉 AI 你希望怎么进化");
  if (files.length > MAX_FILES) throw new Error(`单次最多上传 ${MAX_FILES} 个附件`);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error("附件总大小不能超过 60MB");
  for (const file of files) if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} 超过单文件 25MB 限制`);

  const roles = parseRoles(formData.get("roles"), files.length);
  const aiStatus = getAiProviderStatus("intake");
  const fileIds: string[] = [];
  const imageDataUrls: string[] = [];

  // V2.2: parsing/uploading attachments sequentially made initial Intake feel frozen when
  // several PDF/DOCX/ZIP files were supplied. Parse at most three files concurrently;
  // pooled() preserves the user's attachment order while avoiding a 12-file serial wait.
  const fileArtifacts = await pooled(files, 3, async (file, i) => {
    const id = artifactId(i);
    const ext = extension(file.name);
    const role = roles[i] ?? (i === 0 ? "target" : "reference");
    const buffer = new Uint8Array(await file.arrayBuffer());
    const extracted = await extractSource({ name: file.name, mimeType: file.type || "application/octet-stream", buffer });
    let openaiFileId: string | undefined;
    let imageUrl: string | undefined;
    const warnings = [...extracted.warnings];

    if (isImage(file) && file.size <= 8 * 1024 * 1024 && aiStatus.live) imageUrl = await imageDataUrl(file);
    if (aiStatus.live) {
      const uploadOpenAIUserFile = getOpenAIUploadFn();
      if (uploadOpenAIUserFile) {
        try { openaiFileId = await uploadOpenAIUserFile(file); }
        catch (error) { warnings.push(`OpenAI 文件输入上传失败：${error instanceof Error ? error.message : "unknown error"}`); }
      }
    }

    const parseStatus = isImage(file) ? "image" : extracted.extractedText ? "ready" : openaiFileId ? "ai-file" : "binary";
    const artifact = SourceArtifactSchema.parse({
      id, name: file.name, role, artifactKind: extracted.artifactKind, artifactDescriptor: extracted.artifactDescriptor, mimeType: file.type || "application/octet-stream", size: file.size,
      extension: ext, inputMode: "upload", parseStatus,
      textContent: extracted.extractedText,
      textExcerpt: extracted.excerpt || (isImage(file) ? `[图片附件] ${file.name}` : `[附件] ${file.name}`),
      openaiFileId, structure: extracted.structure, structuredContent: extracted.structuredContent, parsingProfile: extracted.parsingProfile, warnings, createdAt: now(),
    });
    await putArtifactBlob(id, file);
    return { artifact, openaiFileId, imageUrl };
  });
  const artifacts: SourceArtifact[] = fileArtifacts.map((item) => item.artifact);
  for (const item of fileArtifacts) { if (item.openaiFileId) fileIds.push(item.openaiFileId); if (item.imageUrl) imageDataUrls.push(item.imageUrl); }

  if (pastedText) {
    artifacts.push(SourceArtifactSchema.parse({
      id: `artifact-paste-${Date.now()}`, name: "粘贴内容.txt",
      role: artifacts.some((a) => a.role === "target") ? "reference" : "target",
      artifactKind: "document", artifactDescriptor: describeArtifact({ name: files.length ? "补充粘贴内容.txt" : "粘贴内容.txt", mimeType: "text/plain", extension: "txt", artifactKind: "document", structure: [], structuredContent: undefined }),
      mimeType: "text/plain", size: byteLength(pastedText), extension: "txt", inputMode: "paste", parseStatus: "ready",
      textContent: pastedText, textExcerpt: pastedText.slice(0, 2800), createdAt: now(),
    }));
  }

  if (artifacts.length === 0) {
    artifacts.push(SourceArtifactSchema.parse({
      id: `artifact-command-${Date.now()}`, name: "用户命令.txt", role: "target", artifactKind: "prompt", artifactDescriptor: describeArtifact({ name: "用户命令.txt", mimeType: "text/plain", extension: "txt", artifactKind: "prompt", structure: [], structuredContent: undefined }), mimeType: "text/plain",
      size: byteLength(command), extension: "txt", inputMode: "paste", parseStatus: "ready",
      textContent: command, textExcerpt: command, createdAt: now(),
    }));
  }

  for(const artifact of artifacts.filter(a=>a.inputMode==="paste"))await putArtifactBlob(artifact.id,new Blob([artifact.textContent??""],{type:artifact.mimeType}));
  const artifactGraph = buildArtifactGraph(artifacts);
  const semanticDraft = compileSemanticEvolution({ artifacts, command }).semanticEvolution;
  const result = IntakeAiResultSchema.parse(await runEvolveAi("intake", {
    command, pastedText: retrieveTextContext(pastedText,command,{maxChars:8000,maxChunks:3}), department, requestedObjectType, conversation, aiProfile,
    adaptiveStrategy: resolveProjectArtifactStrategy({ sourceArtifacts: artifacts, semanticEvolution: semanticDraft }),
    artifactGraph, semanticDraft,
    artifacts: artifacts.map(({ textContent, ...artifact }) => ({ ...artifact, textExcerpt: retrieveTextContext(textContent,command,{maxChars:8000,maxChunks:3}) || artifact.textExcerpt })),
  }, { fileIds, imageDataUrls }));

  const summaryMap = new Map(result.artifactSummaries.map((item) => [item.artifactId, item]));
  const enriched = artifacts.map((artifact) => {
    const summary = summaryMap.get(artifact.id);
    return SourceArtifactSchema.parse({ ...artifact, summary: summary?.summary, role: summary?.detectedRole ?? artifact.role });
  });

  return { provider: { provider: aiStatus.provider, live: aiStatus.live, model: aiStatus.model }, artifacts: enriched, intake: result };
}

async function intakeMediaFromArtifacts(artifacts: SourceArtifact[], live: boolean) {
  const fileIds = artifacts.flatMap((artifact) => artifact.openaiFileId ? [artifact.openaiFileId] : []);
  const imageDataUrls: string[] = [];
  if (!live) return { fileIds, imageDataUrls };
  for (const artifact of artifacts) {
    if (!artifact.mimeType.startsWith("image/") || artifact.size > 8 * 1024 * 1024) continue;
    try {
      const blob = await getArtifactBlob(artifact.id);
      if (!blob) continue;
      imageDataUrls.push(await imageDataUrl(new File([blob], artifact.name, { type: artifact.mimeType })));
    } catch {
      // Parsed text/structure remains usable when optional visual payload restoration fails.
    }
  }
  return { fileIds, imageDataUrls };
}

/**
 * GPT-like semantic intake for artifacts already parsed by the background ingestion pipeline.
 * Sending a user instruction no longer re-reads the same file bytes.
 */
export async function runIntakeFromArtifacts(args: {
  command: string;
  artifacts: SourceArtifact[];
  department?: string;
  requestedObjectType?: string;
  conversation?: unknown;
  aiProfile?: ProjectAiProfile;
  pastedText?: string;
}): Promise<{ intake: IntakeAiResult; artifacts: SourceArtifact[]; provider: { provider: string; live: boolean; model: string } }> {
  const command = args.command.trim();
  const artifacts = args.artifacts.map((artifact) => SourceArtifactSchema.parse(artifact));
  if (!command && artifacts.length === 0) throw new Error("请上传需要进化的内容，或告诉 AI 你希望怎么进化");

  const aiStatus = getAiProviderStatus("intake");
  const { fileIds, imageDataUrls } = await intakeMediaFromArtifacts(artifacts, aiStatus.live);
  const artifactGraph = buildArtifactGraph(artifacts);
  const semanticDraft = compileSemanticEvolution({ artifacts, command }).semanticEvolution;
  const result = IntakeAiResultSchema.parse(await runEvolveAi("intake", {
    command,
    pastedText: retrieveTextContext(args.pastedText ?? "", command, { maxChars: 8000, maxChunks: 3 }),
    department: args.department ?? "其他",
    requestedObjectType: args.requestedObjectType ?? "auto",
    conversation: args.conversation,
    aiProfile: args.aiProfile,
    adaptiveStrategy: resolveProjectArtifactStrategy({ sourceArtifacts: artifacts, semanticEvolution: semanticDraft }),
    artifactGraph,
    semanticDraft,
    artifacts: artifacts.map(({ textContent, ...artifact }) => ({
      ...artifact,
      textExcerpt: retrieveTextContext(textContent, command, { maxChars: 8000, maxChunks: 3 }) || artifact.textExcerpt,
    })),
  }, { fileIds, imageDataUrls }));

  const summaryMap = new Map(result.artifactSummaries.map((item) => [item.artifactId, item]));
  const enriched = artifacts.map((artifact) => {
    const summary = summaryMap.get(artifact.id);
    return SourceArtifactSchema.parse({ ...artifact, summary: summary?.summary, role: summary?.detectedRole ?? artifact.role });
  });
  return { provider: { provider: aiStatus.provider, live: aiStatus.live, model: aiStatus.model }, artifacts: enriched, intake: result };
}

// ===== POST /api/v1/sources/ingest =====

const INGEST_MAX_FILES = MAX_FILES;
const INGEST_MAX_FILE_BYTES = MAX_FILE_BYTES;

export async function ingestSources(args: { files?: File[]; text?: string; role?: "target" | "reference" | "eval"; roles?: ArtifactRole[] }): Promise<SourceArtifact[]> {
  const files = args.files ?? [];
  if (files.length > INGEST_MAX_FILES) throw new Error(`单次最多上传 ${INGEST_MAX_FILES} 个附件`);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error("附件总大小不能超过 60MB");
  const pastedText = args.text?.trim() ?? "";
  const requestedRole = (args.role ?? "target") as ArtifactRole;
  const artifacts: SourceArtifact[] = [];
  const aiStatus = getAiProviderStatus("intake");

  const parsedFiles = await pooled(files, 3, async (file, index) => {
    if (file.size > INGEST_MAX_FILE_BYTES) throw new Error(`${file.name} 超过单文件 25MB 限制`);
    const id = `artifact-${crypto.randomUUID()}`;
    const buffer = new Uint8Array(await file.arrayBuffer());
    const extracted = await extractSource({ name: file.name, mimeType: file.type || "application/octet-stream", buffer });
    const role: ArtifactRole = args.roles?.[index] ?? (index === 0 ? requestedRole : "reference");
    const needsAiFile = file.type.startsWith("image/") || file.type === "application/pdf" || !extracted.extractedText;
    const warnings = [...extracted.warnings];
    let openaiFileId: string | undefined;
    if (aiStatus.live) {
      const uploadOpenAIUserFile = getOpenAIUploadFn();
      if (uploadOpenAIUserFile) {
        try { openaiFileId = await uploadOpenAIUserFile(file); }
        catch (error) { warnings.push(`AI 文件输入上传失败：${error instanceof Error ? error.message : "unknown error"}`); }
      }
    }
    if (needsAiFile && !openaiFileId) warnings.push(aiStatus.live
      ? "复杂二进制附件已完成本地解析；AI 原生文件通道暂不可用，将使用已提取文本与结构继续理解。"
      : "复杂二进制附件已完成本地解析；连接 Live AI 后可进一步使用原生文件/视觉理解。");

    const artifact = SourceArtifactSchema.parse({
      id, name: file.name, role, mimeType: file.type || "application/octet-stream", size: file.size,
      extension: extracted.extension, inputMode: "upload",
      parseStatus: file.type.startsWith("image/") ? "image" : extracted.extractedText ? "ready" : openaiFileId ? "ai-file" : "binary",
      artifactKind: extracted.artifactKind, artifactDescriptor: extracted.artifactDescriptor,
      textContent: extracted.extractedText, textExcerpt: extracted.excerpt, openaiFileId,
      structure: extracted.structure, structuredContent: extracted.structuredContent, parsingProfile: extracted.parsingProfile, warnings, createdAt: now(),
    });
    await putArtifactBlob(id, file);
    return artifact;
  });
  artifacts.push(...parsedFiles);

  if (pastedText) {
    artifacts.push(SourceArtifactSchema.parse({
      id: `artifact-${crypto.randomUUID()}`,
      name: files.length ? "补充粘贴内容" : "粘贴内容",
      role: files.length ? "reference" : requestedRole,
      artifactKind: "document", artifactDescriptor: describeArtifact({ name: files.length ? "补充粘贴内容.txt" : "粘贴内容.txt", mimeType: "text/plain", extension: "txt", artifactKind: "document", structure: [], structuredContent: undefined }),
      mimeType: "text/plain", size: byteLength(pastedText), extension: "txt", inputMode: "paste", parseStatus: "ready",
      textContent: pastedText, textExcerpt: pastedText.slice(0, 1200),
      warnings: [],
      createdAt: now(),
    }));
  }

  if (artifacts.length === 0) throw new Error("请至少上传一个附件或粘贴一段待进化内容");
  for(const artifact of artifacts.filter(a=>a.inputMode==="paste"))await putArtifactBlob(artifact.id,new Blob([artifact.textContent??""],{type:artifact.mimeType}));
  return artifacts;
}

// ===== POST /api/v1/ai/evolve =====

export async function runAi<T>(operation: AiOperation, payload: unknown, onAttemptNotice?: (notice: AiAttemptNotice) => void): Promise<T> {
  return runEvolveAi(operation, payload, undefined, onAttemptNotice) as Promise<T>;
}

// ===== POST /api/v1/runner/baseline =====

export async function runBaseline(project: EvolveProject, onProgress?: (done: number, total: number, phase?: string) => void, options?: { retryIncompleteOnly?: boolean }): Promise<BaselineRun> {
  const parsed = EvolveProjectSchema.parse(project);
  const targetGate = parsed.gates.find((gate) => gate.id === "target-ready");
  if (targetGate?.status !== "approved") throw new Error("Target Ready gate is not approved");
  if (parsed.evalSuite.length === 0) throw new Error("Project evalSuite is empty");
  const rubricCheck = rubricValidation(parsed.acceptanceRubric);
  if (!rubricCheck.ready) throw new Error(`Acceptance Rubric is not ready: ${rubricCheck.warnings.join("；")}`);
  const coverage = rubricCoverage(parsed.acceptanceRubric, [...parsed.evalSuite, ...parsed.hiddenEvalSuite]);
  const hiddenHardGateMissing = parsed.acceptanceRubric.filter((criterion) => criterion.hardGate && !parsed.hiddenEvalSuite.some((testCase) => testCase.criterionIds.includes(criterion.id)));
  if (coverage.uncovered.length || hiddenHardGateMissing.length) throw new Error(`Eval Suite does not execute the full Acceptance Rubric: uncovered=${coverage.uncovered.join(",") || "none"}; hidden hard gates=${hiddenHardGateMissing.map((item) => item.id).join(",") || "none"}`);
  const suite = parsed.evalSuite;
  const adapter = getTargetAdapter(parsed);
  const batchSize = options?.retryIncompleteOnly ? 1 : parsed.experimentPolicy.batchArtifactRuntime ? parsed.experimentPolicy.batchSize : 1;
  const measurementFingerprint = baselineFingerprint(parsed) + JSON.stringify(suite);
  const reusable = new Map(reusableBaselineRuns(parsed, measurementFingerprint, Boolean(options?.retryIncompleteOnly)).map((run) => [run.testCaseId, run]));
  const pending = suite.filter((testCase) => !reusable.has(testCase.id));
  const baselineVariant = searchBaseCandidate(parsed);
  const fresh = await executeCaseSet({
    adapter, project: parsed, testCases: pending, variant: baselineVariant, batchSize, concurrency: 3,
    onProgress: (done, total) => onProgress?.(done, total, adapter.runBatch && batchSize > 1 ? "批量运行 Baseline" : "当前版本作答"),
  });
  for (const run of fresh) reusable.set(run.testCaseId, run);
  const runs = suite.map((testCase) => reusable.get(testCase.id)!);
  onProgress?.(suite.length, suite.length, "评审基线答卷");
  const result = await evaluateRuns({ testCases: suite, runs, forceRefresh: options?.retryIncompleteOnly, context: { mode: "baseline", project: evaluationProjectContext(parsed) } });
  return {
    measurementFingerprint,
    id: `baseline-${Date.now()}`,
    status: "completed",
    startedAt: now(),
    completedAt: now(),
    suiteName: "Core Validation Suite",
    totalCases: suite.length,
    result,
    runs,
  };
}

// ===== POST /api/v1/runner/experiment =====

function missingEvidenceAction(criterion: EvolveProject["acceptanceRubric"][number]) {
  switch (criterion.validationMethod) {
    case "visual-review": return "上传当前版本截图，并由验收人确认画面是否达标";
    case "manual-review": return "由实际验收人填写结论并确认通过/不通过";
    case "executable-test":
    case "user-scenario": return "连接真实 Target Runner 后重新运行该验收项";
    case "format-roundtrip": return "重新执行原格式 Roundtrip / 可打开性检查";
    case "static-structure":
    case "cross-artifact": return "重新执行文件结构 / 跨成果确定性检查";
    case "semantic-judge":
    default: return "重新执行当前成果的语义验收";
  }
}

export { normalizeLocallyVerifiableCandidateRuns } from "@evolution/harness";

/**
 * Project-specific Rubric is the primary search objective. Generic dimensions remain
 * secondary diagnostics/regularizers so a candidate cannot win by optimizing generic
 * evidence/accuracy while missing the user's actual acceptance contract.
 */
function score(project: EvolveProject, evaluation: EvaluationResult) {
  if (evaluation.safety === "FAIL" || hardRubricFailures(project, evaluation).length) return -Infinity;
  const generic = evaluation.accuracy * 0.28 + evaluation.evidence * 0.22 + evaluation.riskCoverage * 0.15 + evaluation.completeness * 0.20 + (evaluation.safety === "PASS" ? 15 : 4);
  const objective = evaluation.rubricScore !== undefined ? evaluation.rubricScore * 0.84 + generic * 0.16 : generic;
  const costPenalty = evaluation.averageCost * 3;
  const latencyPenalty = evaluation.averageLatencyMs / 10000;
  // 未验证的 Hard Gate 不是失败，但不确定性必须进入候选排序。
  // 这样实验室仍能选出“当前证据下最值得继续验证”的 provisional winner，
  // Release Ready 则仍然要求 100% Hard Gate 真实证据。
  const uncertaintyPenalty = Math.max(0, 100 - (evaluation.verifiedRubricCoverage ?? 100)) * 0.12;
  // 评审由演示启发式兜底（真实 Judge 连接全失败）时，分数只作参考：重罚并禁止据此夺冠。
  const demoJudgePenalty = evaluation.demoJudged ? 40 : 0;
  return objective - costPenalty - latencyPenalty - uncertaintyPenalty - demoJudgePenalty;
}

/** Regression requires a shared verified criterion, not two unrelated generic averages. */
export function validationRegression(project: EvolveProject, candidate: EvaluationResult, baseline: EvaluationResult) {
  return coreValidationRegression(project, candidate, baseline);
}

/** Cheap first rung: rank hypotheses before paying to construct large artifacts. */
export function hypothesisGroundingScore(candidate: Candidate) {
  const rationale = candidate.designRationale;
  return (candidate.recommended ? 20 : 0)
    + Math.min(30, (rationale?.sourceEvidence.length ?? 0) * 10)
    + (rationale?.mechanism ? 15 : 0)
    + (rationale?.commandAlignment ? 10 : 0)
    + (rationale?.falsifier ? 10 : 0)
    + Math.min(15, (rationale?.coveredCriteria.length ?? 0) * 5)
    + Math.min(10, candidate.patches.filter((patch) => patch.target && patch.content).length * 2)
    - (candidate.riskLevel === "high" ? 5 : 0);
}

export { candidateWinnerDecision } from "@evolution/core";

/** The best item in a weak population is not automatically an evolution winner. */
export function candidateImprovesBaseline(project: EvolveProject, evaluation: EvaluationResult, baseline: EvaluationResult, candidate?: Candidate) {
  return candidateWinnerDecision(project, evaluation, baseline, candidate).eligible;
}

function attachWinnerDecisions(project: EvolveProject, results: ExperimentRun["candidateResults"], candidates: Candidate[], baseline?: EvaluationResult) {
  if (!baseline) return results;
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return results.map((result) => result.experimentStage === "screened" ? result : {
    ...result,
    winnerDecision: candidateWinnerDecision(project, result.evaluation, baseline, candidateById.get(result.candidateId)),
  });
}


function selectScreeningCases(project: EvolveProject, suite: TestCase[], count: number) {
  const criterionMap = new Map(project.acceptanceRubric.map((criterion) => [criterion.id, criterion]));
  const scoreCase = (testCase: TestCase) => {
    const mapped = testCase.criterionIds.flatMap((id) => criterionMap.get(id) ? [criterionMap.get(id)!] : []);
    const hard = mapped.some((criterion) => criterion.hardGate) ? 60 : 0;
    const weight = mapped.reduce((sum, criterion) => sum + criterion.weight, 0);
    const executable = testCase.executionMode === "artifact-runtime" ? 30 : testCase.executionMode === "static-evidence" || testCase.executionMode === "roundtrip" ? 18 : -35;
    const business = testCase.evidenceScope === "product-behavior" || testCase.evidenceScope === "cross-artifact" ? 12 : 0;
    return hard + weight + executable + business;
  };
  const sorted = [...suite].sort((a, b) => scoreCase(b) - scoreCase(a));
  const executable = sorted.filter((testCase) => !["external-runner", "visual-review", "manual"].includes(testCase.executionMode));
  // If no case can actually be executed by the current runtime, do not perform a fake screening
  // round on UNVERIFIED evidence. Fall back to the normal finalist path and let validation report
  // the missing Runner/Visual capability truthfully.
  if (!executable.length) return [];
  return executable.slice(0, Math.max(1, Math.min(count, executable.length)));
}

const SIMPLE_LOCAL_TEXT_EXTENSION = /^(txt|md|markdown|mdx)$/i;

/** Narrow documents can be validated from their immutable Candidate snapshot without paying for an executor call first. */
export function isSimpleLocalTextProject(project: EvolveProject) {
  const targets = project.sourceArtifacts.filter((artifact) => artifact.role === "target");
  return targets.length > 0 && targets.every((artifact) => ["document", "knowledge", "generic"].includes(artifact.artifactKind)
    && SIMPLE_LOCAL_TEXT_EXTENSION.test(artifact.extension || artifact.name.split(".").pop() || "")
    && Boolean(artifact.textContent || artifact.textExcerpt));
}

/** Fast Gate is diagnostic only. Small text artifacts need fewer probes; the authoritative full holdout still runs before release. */
export function fastGateCaseLimit(project: EvolveProject) {
  return isSimpleLocalTextProject(project) ? 2 : 4;
}

export async function executeCaseSet(args: { adapter: ReturnType<typeof getTargetAdapter>; project: EvolveProject; testCases: TestCase[]; variant?: Candidate; batchSize: number; concurrency?: number; onProgress?: (done: number, total: number) => void }) {
  const { adapter, project, testCases, variant, batchSize, onProgress } = args;
  const duplicateCaseIds = indexUniqueById(testCases, (testCase) => testCase.id).duplicateIds;
  const unverified = (testCaseId: string, reason: string, retryable = true): TargetRunResult => ({
    testCaseId, output: `UNVERIFIED：${reason}`, latencyMs: 0, cost: 0, trace: [],
    ...(retryable ? { error: reason } : {}), verificationStatus: "unverified",
  });
  if (adapter.runBatch && testCases.length > 1) {
    const chunks: TestCase[][] = [];
    for (let index = 0; index < testCases.length; index += batchSize) chunks.push(testCases.slice(index, index + batchSize));
    const scoped = (chunk: TestCase[], results: TargetRunResult[]) => ({ requestedTestCaseIds: chunk.map((item) => item.id), results });
    let completedCases = 0;
    const batchResults = await pooled(chunks, Math.min(args.concurrency ?? 3, chunks.length), async (chunk) => {
      try {
        const results = await adapter.runBatch!({ project, testCases: chunk, variant });
        completedCases += chunk.length;
        onProgress?.(Math.min(completedCases, testCases.length), testCases.length);
        return scoped(chunk, results);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // V2.8 watchdog: a batch request may already have consumed the whole 45–60s timeout.
        // Fan-out retrying every case afterwards makes the UI look permanently stuck and can double
        // provider cost. Timeout/abort therefore fail fast and let the user retry only failed cases.
        if (/timeout|timed out|abort/i.test(message)) {
          completedCases += chunk.length;
          onProgress?.(Math.min(completedCases, testCases.length), testCases.length);
          return scoped(chunk, chunk.map((testCase) => ({
            testCaseId: testCase.id,
            output: `（批量执行超时：${message}）`,
            latencyMs: 0,
            cost: 0,
            trace: [],
            error: message,
            verificationStatus: "failed" as const,
          })));
        }
        // Payload/context errors benefit from smaller batches. Split once before falling all the way
        // back to per-case calls; this keeps shared context reuse without repeating a huge request.
        if (/context|too large|payload|413|token limit|maximum context/i.test(message) && chunk.length > 1) {
          const middle = Math.ceil(chunk.length / 2);
          const halves = [chunk.slice(0, middle), chunk.slice(middle)].filter((part) => part.length);
          const split = await pooled(halves, Math.min(2, halves.length), async (part) => {
            try { return await adapter.runBatch!({ project, testCases: part, variant }); }
            catch (splitError) {
              const detail = splitError instanceof Error ? splitError.message : String(splitError);
              return part.map((testCase) => ({ testCaseId: testCase.id, output: `（缩小批次后仍失败：${detail}）`, latencyMs: 0, cost: 0, trace: [], error: detail, verificationStatus: "failed" as const }));
            }
          });
          completedCases += chunk.length;
          onProgress?.(Math.min(completedCases, testCases.length), testCases.length);
          return scoped(chunk, split.flat());
        }
        // Fast non-timeout failures may still be rescued cheaply by independent per-case execution.
        const fallback = await pooled(chunk, Math.min(CASE_CONCURRENCY, chunk.length), (testCase) => resilientCase(() => adapter.run({ project, testCase, variant }), testCase.id));
        completedCases += chunk.length;
        onProgress?.(Math.min(completedCases, testCases.length), testCases.length);
        return scoped(chunk, fallback);
      }
    });
    const { byId, duplicateIds } = indexScopedTestCaseResults(batchResults);
    return testCases.map((testCase) => duplicateCaseIds.has(testCase.id)
      ? unverified(testCase.id, "验收题 ID 重复，需修正题目定义", false)
      : duplicateIds.has(testCase.id)
        ? unverified(testCase.id, "批量执行返回重复 Test Case 结果，身份不明确")
        : byId.get(testCase.id) ?? unverified(testCase.id, "批量执行缺失 Test Case 结果"));
  }
  const results = await pooled(testCases, Math.min(args.concurrency ?? TOTAL_CONCURRENCY, testCases.length), (testCase) => resilientCase(() => adapter.run({ project, testCase, variant }), testCase.id), onProgress);
  return testCases.map((testCase, index) => duplicateCaseIds.has(testCase.id)
    ? unverified(testCase.id, "验收题 ID 重复，需修正题目定义", false)
    : results[index]?.testCaseId === testCase.id
      ? results[index]!
      : unverified(testCase.id, "单题执行返回了不同的 Test Case ID"));
}

/**
 * TXT/Markdown document criteria already have the exact Candidate snapshot in memory. Produce that
 * evidence first and call the target adapter only for cases the local snapshot cannot prove. This
 * removes one LLM executor hop per semantic/roundtrip case without changing the independent judge.
 */
export async function executeCandidateAwareCaseSet(args: Parameters<typeof executeCaseSet>[0]) {
  if (!args.variant || !isSimpleLocalTextProject(args.project)) return executeCaseSet(args);
  const repeatedCaseIds = indexUniqueById(args.testCases, (testCase) => testCase.id).duplicateIds;
  const seedRuns: TargetRunResult[] = args.testCases.map((testCase) => ({
    testCaseId: testCase.id, output: "LOCAL SNAPSHOT EVIDENCE PENDING", latencyMs: 0, cost: 0, trace: [], verificationStatus: "unverified",
  }));
  const localRuns = normalizeLocallyVerifiableCandidateRuns(args.project, args.variant, args.testCases, seedRuns);
  const localIndex = indexUniqueById(localRuns.filter((run) => !run.error && (run.verificationStatus === "verified" || run.verificationStatus === "partial")), (run) => run.testCaseId);
  const localById = localIndex.byId;
  const remaining = args.testCases.filter((testCase) => !localById.has(testCase.id));
  args.onProgress?.(localById.size, args.testCases.length);
  const fresh = remaining.length
    ? await executeCaseSet({ ...args, testCases: remaining, onProgress: (done) => args.onProgress?.(localById.size + done, args.testCases.length) })
    : [];
  const normalizedFresh = remaining.length ? normalizeLocallyVerifiableCandidateRuns(args.project, args.variant, remaining, fresh) : [];
  const freshIndex = indexUniqueById(normalizedFresh, (run) => run.testCaseId);
  return args.testCases.map((testCase) => repeatedCaseIds.has(testCase.id)
    ? { testCaseId: testCase.id, output: "UNVERIFIED：验收题 ID 重复，需修正题目定义", latencyMs: 0, cost: 0, trace: [], verificationStatus: "unverified" as const }
    : localIndex.duplicateIds.has(testCase.id) || freshIndex.duplicateIds.has(testCase.id)
      ? { testCaseId: testCase.id, output: "UNVERIFIED：本地执行返回重复 Test Case 身份", latencyMs: 0, cost: 0, trace: [], error: "duplicate Test Case result", verificationStatus: "unverified" as const }
    : localById.get(testCase.id) ?? freshIndex.byId.get(testCase.id) ?? ({ testCaseId: testCase.id, output: "UNVERIFIED：执行未返回结果", latencyMs: 0, cost: 0, trace: [], error: "missing Test Case result", verificationStatus: "unverified" as const }));
}


function provisionalEvaluation(scoreValue: number, runs: TargetRunResult[], safety: "PASS" | "REVIEW" | "FAIL", summary: string): EvaluationResult {
  const executed = runs.filter((run) => !run.error);
  const source = executed.length ? executed : runs;
  const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const score = Math.max(0, Math.min(100, Math.round(scoreValue)));
  return {
    accuracy: score,
    evidence: score,
    riskCoverage: score,
    completeness: score,
    safety,
    notes: [`V2.8 Successive Halving 预筛：${summary}`, "该分数仅用于决定是否进入 Finalist 完整实验，不代表最终 Acceptance/Release 结论。"],
    failures: safety === "FAIL" ? ["预筛阶段触发 Hard/Safety Gate"] : [],
    rubricScore: score,
    verifiedRubricCoverage: 0,
    unverifiedCriterionIds: [],
    criterionScores: [],
    caseScores: [],
    averageCost: Number(avg(source.map((run) => run.cost)).toFixed(4)),
    averageLatencyMs: Math.round(avg(source.map((run) => run.latencyMs))),
  };
}

const SAME_EXPERIMENT_REUSABLE_MODES = new Set<TestCase["executionMode"]>(["artifact-runtime", "static-evidence", "roundtrip"]);

/** Reuse exact verified local Smoke observations inside the same immutable Candidate experiment. */
export function reusableScreeningRuns(fullSuite: TestCase[], screeningCases: TestCase[], runs: TargetRunResult[]) {
  const screenedDefinitions = indexUniqueById(screeningCases, (test) => test.id).byId;
  const runIndex = indexUniqueById(runs, (run) => run.testCaseId);
  const fullSuiteIndex = indexUniqueById(fullSuite, (test) => test.id);
  const reusable = new Map<string, TargetRunResult>();
  for (const test of fullSuite) {
    const run = runIndex.byId.get(test.id);
    const screened = screenedDefinitions.get(test.id);
    if (fullSuiteIndex.duplicateIds.has(test.id)) continue;
    if (!SAME_EXPERIMENT_REUSABLE_MODES.has(test.executionMode)) continue;
    if (!screened || JSON.stringify(screened) !== JSON.stringify(test)) continue;
    if (!run || run.error || run.verificationStatus !== "verified") continue;
    reusable.set(test.id, run);
  }
  return reusable;
}

/** Migrate only the old automatic defaults; explicit user tuning remains authoritative. */
export function effectiveExperimentPolicy(project: EvolveProject) {
  const policy = project.experimentPolicy;
  const legacyAutoDefault = project.campaign.executionMode === "auto-rounds"
    && policy.mode === "adaptive" && policy.finalistCount === 3 && policy.screeningCaseCount === 3
    && policy.batchSize === 4 && policy.batchArtifactRuntime;
  return legacyAutoDefault ? { ...policy, finalistCount: 2, screeningCaseCount: 2, batchSize: 5 } : policy;
}

async function screenCandidatePopulation(project: EvolveProject, candidates: Candidate[], screeningCases: TestCase[], adapter: ReturnType<typeof getTargetAdapter>, onProgress?: (done: number, total: number, phase?: string) => void) {
  const policy = project.experimentPolicy;
  const runsByCandidate = new Map<string, TargetRunResult[]>();
  let done = 0;
  await pooled(candidates, Math.min(3, candidates.length), async (candidate) => {
    const runs = await executeCaseSet({ adapter, project, testCases: screeningCases, variant: candidate, batchSize: Math.min(policy.batchSize, screeningCases.length), concurrency: 3 });
    runsByCandidate.set(candidate.id, runs);
    done += 1;
    onProgress?.(done, candidates.length, `快速预筛 · ${candidate.id}`);
  });
  onProgress?.(candidates.length, candidates.length, "快速预筛 · 独立 Judge");
  try {
    const judged = PopulationEvaluationAiResultSchema.parse(await runEvolveAi("evaluate-population", {
      aiProfile: project.aiProfile,
      project: { name: project.name, goal: project.goal, evolutionCommand: project.evolutionCommand, acceptanceRubric: project.acceptanceRubric },
      screeningCases: screeningCases.map((testCase) => ({ id: testCase.id, title: testCase.title, expected: testCase.expected, criterionIds: testCase.criterionIds, executionMode: testCase.executionMode, evidenceScope: testCase.evidenceScope })),
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.id,
        title: candidate.title || candidate.name,
        hypothesis: candidate.hypothesis,
        patches: candidate.patches.map((patch) => ({ component: patch.component, operation: patch.operation, target: patch.target, rationale: patch.rationale })),
        runs: (runsByCandidate.get(candidate.id) ?? []).map((run) => ({ testCaseId: run.testCaseId, verificationStatus: run.verificationStatus, error: run.error, output: run.output.slice(0, 2200) })),
      })),
    }));
    return { screeningCases, runsByCandidate, judged };
  } catch (error) {
    if (getActiveAbortSignal()?.aborted) throw error;
    // A failed judge supplies no ranking evidence; retain all candidates.
    return { screeningCases, runsByCandidate, judged: { candidates: [], summary: `预筛评审不可用，保留全部候选进行完整验证：${error instanceof Error ? error.message : String(error)}` } };

  }
}

export function visibleBaselineEvaluationReusable(project: EvolveProject, suite: TestCase[]) {
  if (!project.baselineRun.result || project.baselineRun.runs.length !== suite.length) return false;
  const previous = indexUniqueById(project.evalSuite, (test) => test.id);
  const runs = indexUniqueById(project.baselineRun.runs, (run) => run.testCaseId);
  if (previous.duplicateIds.size || runs.duplicateIds.size || indexUniqueById(suite, (test) => test.id).duplicateIds.size) return false;
  return suite.every((test) => {
    const run = runs.byId.get(test.id);
    return JSON.stringify(previous.byId.get(test.id)) === JSON.stringify(test) && Boolean(run && !run.error && run.verificationStatus === "verified");
  });
}

export async function runExperiment(project: EvolveProject, inputCandidates: Candidate[], onProgress?: (done: number, total: number, phase?: string) => void): Promise<ExperimentRun> {
  const parsed = EvolveProjectSchema.parse(project);
  const experimentGate = parsed.gates.find((gate) => gate.id === "experiment-ready");
  if (experimentGate?.status !== "approved") throw new Error("Experiment Ready gate is not approved");
  if (!stepCompleted(parsed, "diagnose")) throw new Error("请先完成原版基线、选定问题与对应根因诊断；旧诊断不能用于当前问题的实验。");
  let rawCandidates = CandidateSchema.array().parse(inputCandidates);
  if (parsed.evalSuite.length === 0) throw new Error("Project evalSuite is empty");
  const mapped = mapTestsToRubric(parsed.acceptanceRubric, parsed.evalSuite, parsed.hiddenEvalSuite);
  const suite = normalizeEvalSuiteForProject(parsed, mapped.validationCases, mapped.hiddenCases).validationCases;
  const baselineEvaluationReusable = visibleBaselineEvaluationReusable(parsed, suite);
  const previousCases = indexUniqueById(parsed.evalSuite, (item) => item.id).byId;
  const previousRuns = indexUniqueById(parsed.baselineRun.runs, (run) => run.testCaseId).byId;
  const uniqueSuite = indexUniqueById(suite, (item) => item.id);
  const reusable = new Map([...previousRuns.values()].filter((run) => !run.error && run.verificationStatus === "verified"
    && !uniqueSuite.duplicateIds.has(run.testCaseId)
    && suite.some((item) => item.id === run.testCaseId && JSON.stringify(item) === JSON.stringify(previousCases.get(item.id)))).map((run) => [run.testCaseId, run]));
  parsed.evalSuite = suite;
  const adapter = getTargetAdapter(parsed);
  const policy = effectiveExperimentPolicy(parsed);
  const missingBaseline = suite.filter((item) => !reusable.has(item.id));
  const baselineVariant = searchBaseCandidate(parsed);
  if (missingBaseline.length) {
    onProgress?.(0, missingBaseline.length, "补齐同卷基线证据");
    const extra = await executeCaseSet({ adapter, project: parsed, testCases: missingBaseline, variant: baselineVariant, batchSize: policy.batchSize });
    for (const result of extra) reusable.set(result.testCaseId, result);
  }
  const baselineRuns = suite.map((item) => reusable.get(item.id)!);
  const baselineResult = baselineEvaluationReusable && parsed.baselineRun.result
    ? parsed.baselineRun.result
    : await evaluateRuns({ testCases: suite, runs: baselineRuns, context: { mode: "baseline", project: evaluationProjectContext(parsed) } });
  onProgress?.(1, 1, baselineEvaluationReusable ? "复用同卷 Baseline 评审" : "按当前标准重评同卷基线");
  parsed.baselineRun = { ...parsed.baselineRun, totalCases: suite.length, runs: baselineRuns, result: baselineResult };
  const startedAt = now();

  // Rung 0 avoids full-file generation for weak hypotheses. Preserve at least one exploration slot
  // beyond the requested finalists so the next rung can still test alternatives on real outputs.
  const allCandidates = rawCandidates;
  const buildPoolSize = Math.min(rawCandidates.length, Math.max(2, policy.finalistCount + 1));
  const hypothesisPruned = policy.mode === "adaptive" && rawCandidates.length > buildPoolSize
    ? [...rawCandidates].sort((a, b) => hypothesisGroundingScore(b) - hypothesisGroundingScore(a)).slice(buildPoolSize)
    : [];
  if (hypothesisPruned.length) {
    const prunedIds = new Set(hypothesisPruned.map((candidate) => candidate.id));
    rawCandidates = rawCandidates.filter((candidate) => !prunedIds.has(candidate.id));
    onProgress?.(hypothesisPruned.length, allCandidates.length, `轻量假设筛选 · ${allCandidates.length} → ${rawCandidates.length} 个待构造成果`);
  }

  onProgress?.(0,rawCandidates.length,"生成实际候选文件");
  const hasLargeTextTarget = parsed.sourceArtifacts.some((artifact) => artifact.role === "target" && (artifact.textContent?.length ?? 0) > 32000);
  rawCandidates=await pooled(rawCandidates,Math.min(hasLargeTextTarget ? 2 : policy.buildConcurrency,rawCandidates.length),async candidate=>{
    try{return await buildCandidateArtifacts(parsed,candidate);}catch(error){return CandidateSchema.parse({...candidate,artifactBuildStatus:"failed",artifactBuildSummary:error instanceof Error ? error.message : String(error)});}
  },(done,total)=>onProgress?.(done,total,"生成实际候选文件"));
  const failedBuilds = rawCandidates.filter((candidate) => candidate.artifactBuildStatus === "failed");
  rawCandidates=rawCandidates.filter(c=>c.artifactBuildStatus==="ready" && c.artifactSnapshots.length > 0);
  if(!rawCandidates.length)throw new CandidateArtifactBuildError(failedBuilds.length ? failedBuilds : inputCandidates);
  let finalists = rawCandidates;
  let screening: Awaited<ReturnType<typeof screenCandidatePopulation>> | undefined;
  const executableScreeningCases = selectScreeningCases(parsed, suite, policy.screeningCaseCount);
  const shouldScreen = policy.mode === "adaptive" && rawCandidates.length > policy.finalistCount && executableScreeningCases.length > 0;
  if (shouldScreen) {
    onProgress?.(0, rawCandidates.length, "快速预筛 · Successive Halving");
    screening = await screenCandidatePopulation(parsed, rawCandidates, executableScreeningCases, adapter, onProgress);
    const rank = new Map(screening.judged.candidates.map((item) => [item.candidateId, item]));
    const sorted = [...rawCandidates].sort((a, b) => {
      const left = rank.get(a.id); const right = rank.get(b.id);
      const leftSafe = left?.hardGatePass && left.safety !== "FAIL" ? 1 : 0;
      const rightSafe = right?.hardGatePass && right.safety !== "FAIL" ? 1 : 0;
      return rightSafe - leftSafe || (right?.score ?? 0) - (left?.score ?? 0);
    });
    const completeRanking = rawCandidates.every(candidate => rank.has(candidate.id));
    finalists = completeRanking ? sorted.slice(0, Math.max(2, Math.min(policy.finalistCount, sorted.length))) : rawCandidates;
    onProgress?.(finalists.length, rawCandidates.length, `预筛完成 · ${rawCandidates.length} → ${finalists.length} Finalists`);
  }

  // Reuse the exact files already executed during screening.
  const buildable = finalists;

  // Full suite: batch AI Artifact Runtime cases so candidate/source context is transmitted once per
  // batch instead of once per test. External runners retain per-test execution semantics.
  const runsByCandidate = new Map<string, TargetRunResult[]>();
  let completedFinalists = 0;
  await pooled(buildable, Math.min(3, buildable.length), async (candidate) => {
    const screened = screening
      ? reusableScreeningRuns(suite, screening.screeningCases, screening.runsByCandidate.get(candidate.id) ?? [])
      : new Map<string, TargetRunResult>();
    const missing = suite.filter((testCase) => !screened.has(testCase.id));
    const fresh = missing.length
      ? await executeCaseSet({ adapter, project: parsed, testCases: missing, variant: candidate, batchSize: policy.batchArtifactRuntime ? policy.batchSize : 1, concurrency: policy.batchArtifactRuntime ? 2 : TOTAL_CONCURRENCY })
      : [];
    const freshById = new Map(fresh.map((run) => [run.testCaseId, run]));
    const runs = suite.map((testCase) => screened.get(testCase.id) ?? freshById.get(testCase.id)!).filter(Boolean);
    runsByCandidate.set(candidate.id, runs);
    completedFinalists += 1;
    onProgress?.(completedFinalists, buildable.length, screened.size ? `完整实验 · ${candidate.id} · 复用 ${screened.size} 项 Smoke 证据` : `完整实验 · ${candidate.id}`);
  });

  onProgress?.(0, buildable.length, "独立 Judge · Finalists");
  const finalistResults = await pooled(buildable, Math.min(3, buildable.length), async (candidate) => {
    const runs = runsByCandidate.get(candidate.id) ?? [];
    const evaluation = await evaluateRuns({ testCases: suite, runs, context: { mode: "candidate", candidate: { ...candidate, artifactSnapshots: candidate.artifactSnapshots.map((a) => ({ id: a.id, sourceArtifactId: a.sourceArtifactId, name: a.name, mimeType: a.mimeType, contentHash: a.contentHash, buildMode: a.buildMode })) }, project: evaluationProjectContext(parsed) } });
    return { candidateId: candidate.id, evaluation, runs, artifactSnapshots: candidate.artifactSnapshots, artifactBuildSummary: candidate.artifactBuildSummary, experimentStage: "finalist" as const, screeningScore: screening?.judged.candidates.find((item) => item.candidateId === candidate.id)?.score, screeningSummary: screening?.judged.summary };
  }, (done, total) => onProgress?.(done, total, "独立 Judge · Finalists"));

  const finalistIds = new Set(finalistResults.map((result) => result.candidateId));
  const screenedResults = screening ? rawCandidates.filter((candidate) => !finalistIds.has(candidate.id)).map((candidate) => {
    const judged = screening!.judged.candidates.find((item) => item.candidateId === candidate.id);
    const runs = screening!.runsByCandidate.get(candidate.id) ?? [];
    const provisional = provisionalEvaluation(judged?.score ?? 50, runs, judged?.safety ?? "REVIEW", judged ? `${judged.gaps.join("；") || judged.strengths.join("；")}` : "预筛未返回完整结果");
    return { candidateId: candidate.id, evaluation: provisional, runs, artifactSnapshots: candidate.artifactSnapshots, artifactBuildSummary: "实际文件已构造并保留；预筛后未进入全量评测，仅节省后续评测成本。", experimentStage: "screened" as const, screeningScore: judged?.score, screeningSummary: screening!.judged.summary };
  }) : [];

  const hypothesisResults = hypothesisPruned.map((candidate) => {
    const groundingScore = hypothesisGroundingScore(candidate);
    return {
      candidateId: candidate.id,
      evaluation: provisionalEvaluation(groundingScore, [], "REVIEW", "轻量论证筛选未入围，未构造完整成果，也未消耗测试执行成本"),
      runs: [],
      artifactSnapshots: [],
      artifactBuildSummary: "轻量假设筛选未入围：源证据、作用机制、验收对应或证伪条件弱于入围方案，因此未构造大文件。",
      experimentStage: "screened" as const,
      screeningScore: groundingScore,
      screeningSummary: "构造前轻量假设筛选",
    };
  });

  const baselineEvaluation = parsed.baselineRun.result;
  const resultById = new Map([...hypothesisResults, ...screenedResults, ...finalistResults].map((result) => [result.candidateId, result]));
  const rawCandidateResults = allCandidates.flatMap((candidate) => resultById.get(candidate.id) ? [resultById.get(candidate.id)!] : []);
  const candidateResults = attachWinnerDecisions(parsed, rawCandidateResults, allCandidates, baselineEvaluation);
  const finalistResultsWithDecision = candidateResults.filter((result) => result.experimentStage !== "screened");
  const winner = baselineEvaluation
    ? finalistResultsWithDecision.filter((result) => result.winnerDecision?.eligible).sort((a, b) => score(parsed, b.evaluation) - score(parsed, a.evaluation))[0]
    : undefined;
  const closest = [...finalistResultsWithDecision].sort((a, b) => score(parsed, b.evaluation) - score(parsed, a.evaluation))[0];
  const evidencePendingCandidate = !winner && closest && finalistResultsWithDecision.length > 0 && finalistResultsWithDecision.every(({ evaluation }) => {
    const scores = evaluation.criterionScores ?? [];
    return evaluation.safety !== "FAIL"
      && scores.some((item) => item.verificationStatus !== "verified")
      && !scores.some((item) => item.verificationStatus === "verified" && !item.pass);
  }) ? closest : undefined;
  onProgress?.(1, 1, winner
    ? "实验完成 · 已选出待独立验证的候选"
    : evidencePendingCandidate
      ? "实验完成 · 候选本身未判失败，仅待补真实证据"
      : "实验完成 · 未找到可继续验证的候选");
  return {
    id: `experiment-${Date.now()}`,
    status: "completed",
    startedAt,
    completedAt: now(),
    candidateResults,
    comparisonSuite: suite,
    comparisonBaseline: parsed.baselineRun,
    buildFailures: failedBuilds.map(candidate => ({ candidateId: candidate.id, message: candidate.artifactBuildSummary || "构造失败" })),
    winnerId: winner?.candidateId,
    pendingEvidenceCandidateId: evidencePendingCandidate?.candidateId,
    summary: winner
      ? `${winner.candidateId} 在 Finalist 完整 Artifact / 全量 Eval 中领先。${hypothesisPruned.length ? `先将 ${allCandidates.length} 个假设筛到 ${rawCandidates.length} 个再构造成果，节省 ${hypothesisPruned.length} 次大文件生成；` : ""}${shouldScreen ? `真实成果预筛再从 ${rawCandidates.length} 个缩减到 ${finalists.length} 个 Finalist，仅入围候选支付全量评测成本。` : "本轮构造后的候选直接进入完整实验。"}`
      : evidencePendingCandidate
        ? `${evidencePendingCandidate.candidateId} 当前没有已验证的产品失败，只缺真实 Runner / 视觉 / 人工证据。系统保留同一成果快照并送入统一最终验收，不重新生成 Candidate。`
      : closest?.winnerDecision
        ? `${closest.candidateId} 是本轮最接近的候选。${closest.winnerDecision.summary}。缺少映射或缺少真实运行证据的标准保持“待验证”，不会再按 0 分冒充产品失败。`
        : "本轮没有完成全量评测的候选，原版继续保留。请先检查候选构造和实验执行记录。",
  };
}

/**
 * 实验失败题补考：只重跑各候选执行失败的题目（成功作答复用），
 * 重新评审受影响候选并按综合分重排 Winner。
 */
export async function retryFailedExperimentCases(project: EvolveProject, inputCandidates: Candidate[], onProgress?: (done: number, total: number, phase?: string) => void): Promise<ExperimentRun> {
  const parsed = EvolveProjectSchema.parse(project);
  const candidates = CandidateSchema.array().parse(inputCandidates);
  if (parsed.experimentRun.status !== "completed") throw new Error("实验尚未完成，无法补考");
  const suite = parsed.evalSuite;
  const adapter = getTargetAdapter(parsed);
  const failedIndexesOf = (source: TargetRunResult[]) => source.map((run, index) => (run.error ? index : -1)).filter((index) => index >= 0);

  const targetResults = parsed.experimentRun.candidateResults
    .filter((result) => result.experimentStage !== "screened")
    .map((result) => ({ result, candidate: candidates.find((candidate) => candidate.id === result.candidateId) }))
    .filter((item): item is { result: (typeof parsed.experimentRun.candidateResults)[number]; candidate: Candidate } => Boolean(item.candidate && failedIndexesOf(item.result.runs).length > 0));
  if (!targetResults.length) throw new Error("没有执行失败的题目，无需补考");

  const retryTotal = targetResults.reduce((sum, item) => sum + failedIndexesOf(item.result.runs).length, 0);
  const updated = new Map(parsed.experimentRun.candidateResults.map((result) => [result.candidateId, result]));
  // 补考题跨候选拍平进一个池子，答完按候选归组并发评审，不再逐候选串行等 API。
  const retryJobs = targetResults.flatMap(({ result, candidate }) => failedIndexesOf(result.runs).map((index) => ({ candidate, index })));
  const rerunAll = await pooled(retryJobs, TOTAL_CONCURRENCY, async (job) => (await executeCaseSet({ adapter, project: parsed, testCases: [suite[job.index]!], variant: job.candidate, batchSize: 1 }))[0]!, (done, total) => onProgress?.(done, total, "补考失败题"));
  const rerunByCandidate = new Map<string, TargetRunResult[]>(targetResults.map(({ candidate }) => [candidate.id, []]));
  rerunAll.forEach((run, position) => rerunByCandidate.get(retryJobs[position]!.candidate.id)!.push(run));
  onProgress?.(retryTotal, retryTotal, "评审候选");
  await Promise.all(targetResults.map(async ({ result, candidate }) => {
    const failedIndexes = failedIndexesOf(result.runs);
    const rerun = rerunByCandidate.get(candidate.id) ?? [];
    const runs = result.runs.map((run, index) => {
      const position = failedIndexes.indexOf(index);
      return position >= 0 ? rerun[position]! : run;
    });
    const evaluation = await evaluateRuns({ testCases: suite, runs, context: { mode: "candidate", candidate, project: evaluationProjectContext(parsed) } });
    updated.set(candidate.id, { ...result, evaluation, runs });
  }));

  const rawCandidateResults = parsed.experimentRun.candidateResults.map((result) => updated.get(result.candidateId) ?? result);
  const baselineEvaluation = parsed.baselineRun.result;
  const candidateResults = attachWinnerDecisions(parsed, rawCandidateResults, candidates, baselineEvaluation);
  // Winner 只允许来自全量评估过的候选：预筛淘汰者只有 provisional 分，不能参与重排夺冠。
  const fullyEvaluated = candidateResults.filter((result) => result.experimentStage !== "screened");
  const rankedPool = fullyEvaluated.filter(result => result.evaluation.safety !== "FAIL" && !result.evaluation.demoJudged);
  const winner = baselineEvaluation
    ? [...rankedPool].filter((result) => result.winnerDecision?.eligible).sort((a, b) => score(parsed, b.evaluation) - score(parsed, a.evaluation))[0]
    : undefined;
  const closest = [...rankedPool].sort((a, b) => score(parsed, b.evaluation) - score(parsed, a.evaluation))[0];
  const evidencePendingCandidate = !winner && closest && fullyEvaluated.length > 0 && fullyEvaluated.every(({ evaluation }) => {
    const scores = evaluation.criterionScores ?? [];
    return evaluation.safety !== "FAIL"
      && scores.some((item) => item.verificationStatus !== "verified")
      && !scores.some((item) => item.verificationStatus === "verified" && !item.pass);
  }) ? closest : undefined;
  return {
    ...parsed.experimentRun,
    id: `experiment-${Date.now()}`,
    candidateResults,
    winnerId: winner?.candidateId,
    pendingEvidenceCandidateId: evidencePendingCandidate?.candidateId,
    // 首轮补考留存补考前的旧分数快照，多轮补考不覆盖，保留最早一轮的对比基准。
    previousScores: parsed.experimentRun.previousScores ?? parsed.experimentRun.candidateResults.map((result) => ({
      candidateId: result.candidateId,
      accuracy: result.evaluation.accuracy,
      evidence: result.evaluation.evidence,
      riskCoverage: result.evaluation.riskCoverage,
      averageCost: result.evaluation.averageCost,
    })),
    summary: winner
      ? parsed.experimentRun.winnerId !== winner.candidateId
        ? `补考后综合分重排：${winner.candidateId} 领先，推荐已更新。`
        : `补考完成，Winner 保持不变。`
      : evidencePendingCandidate
        ? `补考后 ${evidencePendingCandidate.candidateId} 没有已验证的产品失败，只剩真实证据缺口；保留同一 Candidate 进入最终验收。`
      : closest?.winnerDecision
        ? `补考后 ${closest.candidateId} 仍未晋级。${closest.winnerDecision.summary}。原版继续保留。`
        : "补考后仍没有完成全量评测的候选，原版继续保留。",
  };
}

// ===== POST /api/v1/runner/validation =====

export type ValidationOptions = { retryFailedOnly?: boolean; skipFastGate?: boolean };

export async function runValidation(project: EvolveProject, inputCandidate: Candidate, onProgress?: (done: number, total: number, phase?: string) => void, options?: ValidationOptions): Promise<ValidationRun> {
  // Runtime migration for persisted projects: compact duplicate/fallback rubric rows before binding
  // evidence, then normalize the stored test suite against that current contract in runValidationUnbound.
  const normalizedProject = EvolveProjectSchema.parse({ ...project, acceptanceRubric: normalizeAcceptanceRubric(project.acceptanceRubric, project) });
  const binding = evidenceFingerprint(normalizedProject, inputCandidate);
  // retryFailedOnly may reuse the previous answer sheet only for the exact same artifact binding.
  // skipFastGate is a control-flow hint and must survive a repaired Candidate fingerprint change.
  const effectiveOptions: ValidationOptions | undefined = options
    ? { skipFastGate: options.skipFastGate, retryFailedOnly: normalizedProject.validationRun.evidenceFingerprint === binding ? options.retryFailedOnly : undefined }
    : undefined;
  const result = await runValidationUnbound(normalizedProject, inputCandidate, onProgress, effectiveOptions);
  return { ...result, evidenceFingerprint: binding };
}

async function runValidationUnbound(project: EvolveProject, inputCandidate: Candidate, onProgress?: (done: number, total: number, phase?: string) => void, options?: ValidationOptions): Promise<ValidationRun> {
  const parsed = EvolveProjectSchema.parse(project);
  const candidate = CandidateSchema.parse(inputCandidate);
  const verificationCandidateId = parsed.experimentRun.winnerId ?? parsed.experimentRun.pendingEvidenceCandidateId;
  if (parsed.experimentRun.status !== "completed" || verificationCandidateId !== candidate.id) throw new Error("Candidate is not the completed experiment winner or pending-evidence candidate");
  if (parsed.hiddenEvalSuite.length === 0) throw new Error("Project hiddenEvalSuite is empty");
  // Repair stale/imported suites at execution time too. Remap against the normalized Rubric first:
  // persisted tests that only reference a removed duplicate criterion become orphans and must not
  // keep consuming Hidden Validation time. Missing current hard gates receive dedicated cases.
  const remappedHidden = mapTestsToRubric(parsed.acceptanceRubric, [], parsed.hiddenEvalSuite).hiddenCases
    .filter((testCase) => testCase.criterionIds.length > 0);
  const suite = normalizeEvalSuiteForProject(parsed, [], remappedHidden).hiddenCases;
  parsed.hiddenEvalSuite = suite;
  const adapter = getTargetAdapter(parsed);
  const baselineVariant = searchBaseCandidate(parsed);
  const policy = effectiveExperimentPolicy(parsed);
  const reuse = createValidationReuse(parsed.id);
  const validationContractFingerprint = baselineFingerprint(parsed);
  // Candidate ids are model-generated and may repeat across rounds. Bind reuse to the exact
  // candidate/source + validation-contract fingerprints. Normalize local evidence BEFORE caching,
  // so Fast Gate verified rows are reused by the authoritative full holdout instead of executed twice.
  const executeValidationCases = async (args: Parameters<typeof executeCaseSet>[0]) => {
    const variantKey = args.variant
      ? `candidate:${validationContractFingerprint}:${evidenceFingerprint(parsed, args.variant)}`
      : `baseline:${validationContractFingerprint}`;
    return reuse(variantKey, args.testCases, async (missing, progress) => {
      const fresh = args.variant
        ? await executeCandidateAwareCaseSet({ ...args, project: parsed, testCases: missing, onProgress: progress })
        : await executeCaseSet({ ...args, project: parsed, testCases: missing, onProgress: progress });
      return args.variant ? normalizeLocallyVerifiableCandidateRuns(parsed, args.variant, missing, fresh) : fresh;
    }, args.onProgress);
  };

  // Fast Gate is diagnostic only. Run the Candidate first; if it already fails a hard requirement,
  // do not spend another executor + judge pass on the unchanged baseline. TXT/Markdown documents use
  // two discriminative probes; the authoritative full holdout still runs before any release decision.
  if (!options?.retryFailedOnly && !options?.skipFastGate && suite.length > 4) {
    const hardIds = new Set(parsed.acceptanceRubric.filter((criterion) => criterion.hardGate).map((criterion) => criterion.id));
    const remaining = new Set(hardIds); const critical: TestCase[] = []; const available=[...suite];
    const impactPriority = validationImpactPriority(parsed, candidate);
    const criticalLimit = fastGateCaseLimit(parsed);
    while (available.length && critical.length < criticalLimit) {
      available.sort((a,b)=>100 * (b.criterionIds.filter((id)=>remaining.has(id)).length-a.criterionIds.filter((id)=>remaining.has(id)).length) + impactPriority(b) - impactPriority(a));
      const picked=available.shift()!; critical.push(picked); for(const id of picked.criterionIds)remaining.delete(id);
      if(!remaining.size) break;
    }
    if (critical.length) {
      const batchSize = policy.batchArtifactRuntime ? policy.batchSize : 1;
      onProgress?.(0, critical.length, `Fast Gate · 候选关键标准 ${critical.length} 项`);
      const candidateFast = await executeValidationCases({ adapter, project: parsed, testCases: critical, variant: candidate, batchSize, concurrency: 2, onProgress: (done) => onProgress?.(done, critical.length, "Fast Gate · 候选关键标准") });
      try {
        onProgress?.(critical.length, critical.length, "Fast Gate · 候选 Hard Rubric Judge");
        const candidateEval = applySupplementalEvidenceToEvaluation(parsed, candidate, await evaluateRuns({testCases:critical,runs:candidateFast,context:{mode:"holdout-fast",candidate,project:evaluationProjectContext(parsed)}}));
        const fastHard=hardRubricFailures(parsed,candidateEval);
        const fastUnverified=unverifiedHardRubricCriteria(parsed,candidateEval);
        const externalUnverified=fastUnverified.filter((criterion)=>!criterionCanUseLocalSnapshotEvidence(parsed,criterion));
        if(candidateEval.safety==="FAIL"||fastHard.length||externalUnverified.length){
          const scoreByCriterion=indexScopedAcceptanceResults([{requestedCriterionIds:parsed.acceptanceRubric.map((criterion)=>criterion.id),results:candidateEval.criterionScores??[]}]).byId;
          const checks=[...fastHard.map((criterion)=>{const score=scoreByCriterion.get(criterion.id);const evidence=score?.evidence[0]||score?.gaps[0]||criterion.requirement;return {label:`Hard Gate · ${criterion.title}`,status:"fail" as const,detail:`AI 语义/文件证据已定位未通过内容：${evidence}`};}),...fastUnverified.map((criterion)=>{const score=scoreByCriterion.get(criterion.id);const judgeMissing=score?.gaps.some((gap)=>gap.includes("评审模型未返回"));return {label:`${judgeMissing?"待补评审":"待真实验证"} · ${criterion.title}`,status:"warning" as const,detail:judgeMissing?"测试已经执行，但评审模型漏返逐题/逐标准判断；系统保持未验证，不再按 0 分误判。":`缺少「${criterion.title}」所需证据。下一步：${missingEvidenceAction(criterion)}。该状态不是成果失败，也不会被伪装成通过。`};}),{label:"Safety",status:candidateEval.safety==="FAIL"?"fail" as const:"pass" as const,detail:candidateEval.safety}];
          return {id:`validation-fast-${Date.now()}`,status:"completed",validationMode:"fast-gate",plannedCases:suite.length,executedCases:critical.length,candidateId:candidate.id,evaluation:{...candidateEval,notes:["Candidate-first Fast Gate 已提前定位阻断，不再重复运行原版关键题。",...candidateEval.notes]},runs:candidateFast,baselineRuns:[],checks,recommendation:"hold",summary:`Candidate-first Fast Gate 已执行 ${critical.length}/${suite.length} 题：${fastHard.length} 个已证实 Hard Criterion 失败${externalUnverified.length?`；${externalUnverified.length} 个外部证据 Hard Criterion 待补证`:""}。`};
        }
        // Candidate survived its hard probes. Only now pay for the baseline comparison needed to detect regression.
        onProgress?.(0, critical.length, "Fast Gate · 回归基线关键标准");
        const baselineFast = await executeValidationCases({ adapter, project: parsed, testCases: critical, variant: baselineVariant, batchSize, concurrency: 2, onProgress: (done) => onProgress?.(done, critical.length, "Fast Gate · 回归基线关键标准") });
        const baseEval = await evaluateRuns({testCases:critical,runs:baselineFast,context:{mode:"holdout-fast",project:evaluationProjectContext(parsed)}});
        const fastRegression=validationRegression(parsed, candidateEval, baseEval);
        if(fastRegression){
          const checks=[{label:"Safety",status:"pass" as const,detail:candidateEval.safety},{label:"关键能力回归",status:"fail" as const,detail:`候选关键标准通过，但相对同卷基线出现已验证回归；候选 ${candidateEval.accuracy}/${candidateEval.completeness} vs 基线 ${baseEval.accuracy}/${baseEval.completeness}`}];
          return {id:`validation-fast-${Date.now()}`,status:"completed",validationMode:"fast-gate",plannedCases:suite.length,executedCases:critical.length,candidateId:candidate.id,evaluation:{...candidateEval,notes:["Fast Gate 在候选通过后才运行同卷基线，并发现已验证回归。",...candidateEval.notes]},runs:candidateFast,baselineRuns:baselineFast,baselineEvaluation:baseEval,baselineSuiteIds:critical.map((item)=>item.id),checks,recommendation:"hold",summary:`Fast Gate 已执行 ${critical.length}/${suite.length} 题：候选 Hard Gate 通过，但存在同卷回归。`};
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        // Fast Gate is only an acceleration layer. A temporary judge outage should not block the authoritative full holdout.
        onProgress?.(critical.length, critical.length, "Fast Gate 评审暂不可用 · 继续完整验证");
      }
    }
  }
  // 盲测基线：隐藏题天然比可见题难，如果拿「候选在隐藏题上的分数」对比
  // 「基线在可见题上的分数」，属于不同考卷比总分，回归检查几乎必然误报。
  // 因此先让当前版本（无 variant）在同一套隐藏题上跑一遍，做同卷对照。
  const totalRuns = suite.length * 2;
  const prior = parsed.validationRun;
  const suiteIds = suite.map((testCase) => testCase.id);
  // 跨轮盲测对照复用：当前版本在同一套隐藏题上的作答只取决于「考卷 + 进化对象 + 执行配置」，
  // 指纹不变时直接沿用上一轮的对照卷与评审，多轮编排每轮省掉半程盲测执行与一次评审。
  const roundFingerprint = baselineFingerprint(parsed);
  const cachedHoldout = getHoldoutBaseline(parsed.id, roundFingerprint);
  const cacheReusable = Boolean(cachedHoldout)
    && cachedHoldout!.suiteIds.length === suiteIds.length
    && cachedHoldout!.suiteIds.every((id, index) => id === suiteIds[index])
    && reusableHoldoutBaseline(suite, cachedHoldout!.runs, cachedHoldout!.evaluation);
  let baselineRuns: TargetRunResult[];
  let baselineHoldout: EvaluationResult;
  let runs: TargetRunResult[];
  let evaluation: EvaluationResult;
  // 补考模式：沿用上次成功作答，只重跑两张卷里执行失败的题，再重走评审与发布审查。
  const canRetryFailed = options?.retryFailedOnly && canRetryHoldoutFailures(suite, prior, candidate.id, roundFingerprint);
  if (canRetryFailed) {
    const failedIndexesOf = (source: TargetRunResult[]) => source.map((run, index) => (run.error ? index : -1)).filter((index) => index >= 0);
    const mergeByIndexes = (source: TargetRunResult[], indexes: number[], rerun: TargetRunResult[]) => source.map((run, index) => {
      const position = indexes.indexOf(index);
      return position >= 0 ? rerun[position]! : run;
    });
    const failedBaselineIndexes = failedIndexesOf(prior.baselineRuns);
    const failedRunIndexes = failedIndexesOf(prior.runs);
    if (!failedBaselineIndexes.length && !failedRunIndexes.length) throw new Error("没有执行失败的题目，无需补考");
    const retryTotal = failedBaselineIndexes.length + failedRunIndexes.length;
    const batchSize = policy.batchArtifactRuntime ? policy.batchSize : 1;
    onProgress?.(0, retryTotal, "补考盲测失败题");
    const baselineCases = failedBaselineIndexes.map((index) => suite[index]!);
    const candidateCases = failedRunIndexes.map((index) => suite[index]!);
    let baseDone = 0; let candDone = 0;
    const [rerunBase, rerunCandidate] = await Promise.all([
      baselineCases.length ? executeValidationCases({ adapter, project: parsed, testCases: baselineCases, variant: baselineVariant, batchSize, concurrency: 2, onProgress: (done) => { baseDone = done; onProgress?.(baseDone + candDone, retryTotal, "补考盲测失败题"); } }) : Promise.resolve([]),
      candidateCases.length ? executeValidationCases({ adapter, project: parsed, testCases: candidateCases, variant: candidate, batchSize, concurrency: 2, onProgress: (done) => { candDone = done; onProgress?.(baseDone + candDone, retryTotal, "补考盲测失败题"); } }) : Promise.resolve([]),
    ]);
    baselineRuns = mergeByIndexes(prior.baselineRuns, failedBaselineIndexes, rerunBase);
    runs = mergeByIndexes(prior.runs, failedRunIndexes, rerunCandidate);
    onProgress?.(retryTotal, retryTotal, "评审两张答卷");
    const retryBaseHoldout = await evaluateRuns({ testCases: suite, runs: baselineRuns, context: { mode: "holdout", project: evaluationProjectContext(parsed) } });
    setHoldoutBaseline(parsed.id, { fingerprint: roundFingerprint, suiteIds, runs: baselineRuns, evaluation: retryBaseHoldout });
    const retryEval = applySupplementalEvidenceToEvaluation(parsed, candidate, await evaluateRuns({ testCases: suite, runs, context: { mode: "holdout", candidate, project: evaluationProjectContext(parsed) } }));
    baselineHoldout = retryBaseHoldout;
    evaluation = retryEval;
    setHoldoutBaseline(parsed.id, { fingerprint: roundFingerprint, suiteIds, runs: baselineRuns, evaluation: baselineHoldout });
  } else {
    // 断点复用：同一次失败重跑时，当前版本在同一套盲测题上的作答与评审直接沿用上次结果，
    // 不用把半程的时间和费用再付一遍；题集或当前版本变化时自动失效（重跑会重置存档）。
    const reusableBaseline = prior.baselineContextFingerprint===roundFingerprint && Date.now()-(prior.baselineObservedAt??0)<600000 && Boolean(prior.baselineEvaluation)
      && prior.baselineSuiteIds?.length === suiteIds.length
      && (prior.baselineSuiteIds ?? []).every((id, index) => id === suiteIds[index])
      && reusableHoldoutBaseline(suite, prior.baselineRuns, prior.baselineEvaluation);
    if (reusableBaseline && prior.baselineEvaluation) {
      onProgress?.(suite.length, totalRuns, "复用当前版本同卷作答");
      baselineRuns = prior.baselineRuns;
      baselineHoldout = prior.baselineEvaluation;
      const batchSize = policy.batchArtifactRuntime ? policy.batchSize : 1;
      runs = await executeValidationCases({ adapter, project: parsed, testCases: suite, variant: candidate, batchSize, concurrency: 3, onProgress: (done) => onProgress?.(suite.length + done, totalRuns, adapter.runBatch && batchSize > 1 ? "批量候选同卷作答" : "候选同卷作答") });
      onProgress?.(totalRuns, totalRuns, "评审候选答卷");
      evaluation = applySupplementalEvidenceToEvaluation(parsed, candidate, await evaluateRuns({ testCases: suite, runs, context: { mode: "holdout", candidate, project: evaluationProjectContext(parsed) } }));
      setHoldoutBaseline(parsed.id, { fingerprint: roundFingerprint, suiteIds, runs: baselineRuns, evaluation: baselineHoldout });
    } else if (cacheReusable && cachedHoldout) {
      onProgress?.(suite.length, totalRuns, "复用上一轮当前版本盲测对照");
      baselineRuns = cachedHoldout.runs;
      baselineHoldout = cachedHoldout.evaluation;
      const batchSize = policy.batchArtifactRuntime ? policy.batchSize : 1;
      runs = await executeValidationCases({ adapter, project: parsed, testCases: suite, variant: candidate, batchSize, concurrency: 3, onProgress: (done) => onProgress?.(suite.length + done, totalRuns, adapter.runBatch && batchSize > 1 ? "批量候选同卷作答" : "候选同卷作答") });
      onProgress?.(totalRuns, totalRuns, "评审候选答卷");
      evaluation = applySupplementalEvidenceToEvaluation(parsed, candidate, await evaluateRuns({ testCases: suite, runs, context: { mode: "holdout", candidate, project: evaluationProjectContext(parsed) } }));
    } else {
      // 两张考卷互不依赖；对于支持 runBatch 的 Artifact Runtime，按候选上下文分别批量执行，
      // 避免同一 Source/Candidate 被每一道题重复传输。
      onProgress?.(0, totalRuns, "盲测同卷批量作答");
      const batchSize = policy.batchArtifactRuntime ? policy.batchSize : 1;
      let baseDone = 0; let candDone = 0;
      [baselineRuns, runs] = await Promise.all([
        executeValidationCases({ adapter, project: parsed, testCases: suite, variant: baselineVariant, batchSize, concurrency: 3, onProgress: (done) => { baseDone = done; onProgress?.(baseDone + candDone, totalRuns, "盲测同卷批量作答"); } }),
        executeValidationCases({ adapter, project: parsed, testCases: suite, variant: candidate, batchSize, concurrency: 3, onProgress: (done) => { candDone = done; onProgress?.(baseDone + candDone, totalRuns, "盲测同卷批量作答"); } }),
      ]);
      onProgress?.(totalRuns, totalRuns, "评审两张答卷");
      const holdoutBase = await evaluateRuns({ testCases: suite, runs: baselineRuns, context: { mode: "holdout", project: evaluationProjectContext(parsed) } });
      setHoldoutBaseline(parsed.id, { fingerprint: roundFingerprint, suiteIds, runs: baselineRuns, evaluation: holdoutBase });
      const holdoutEval = applySupplementalEvidenceToEvaluation(parsed, candidate, await evaluateRuns({ testCases: suite, runs, context: { mode: "holdout", candidate, project: evaluationProjectContext(parsed) } }));
      baselineHoldout = holdoutBase;
      evaluation = holdoutEval;
      setHoldoutBaseline(parsed.id, { fingerprint: roundFingerprint, suiteIds, runs: baselineRuns, evaluation: baselineHoldout });
    }
  }

  const baseline = parsed.baselineRun.result;
  // 同卷对照 + 3 分容差（AI 评阅本身有噪声，小于 3 分的差距视为噪声而非回归）
  const regressionTolerance = REGRESSION_TOLERANCE;
  // 差距归因：把总分差拆回维度与题目，检查项 detail 直接带出主因贡献题，不让用户只看两个总分猜原因。
  const gapAnalysis = computeGapAnalysis({ candidate: evaluation, baseline: baselineHoldout, candidateRuns: runs, baselineRuns, testCases: suite, tolerance: regressionTolerance });
  const regressionHeadline = gapHeadline(gapAnalysis);
  const costLimit = parsed.metrics.find((m) => m.key === "cost")?.target ?? Number.POSITIVE_INFINITY;
  const evidenceTarget = parsed.metrics.find((m) => m.key === "evidence")?.target;
  const riskTarget = parsed.metrics.find((m) => m.key === "risk" || m.key === "robustness")?.target;
  const qualityTarget = parsed.metrics.find((m) => m.key === "quality" || m.key === "accuracy")?.target;
  const successTarget = parsed.metrics.find((m) => m.key === "success" || m.key === "completeness")?.target;

  const holdoutDecision = validationDecision(parsed, evaluation, baselineHoldout);
  const { hardCriterionFailures, unverifiedHardCriteria, unverifiedCriteria, comparisonEvidenceGaps } = holdoutDecision;
  const unverifiedSoftCriteria = unverifiedCriteria.filter((criterion) => !criterion.hardGate);
  const rubricTarget = 85;
  const rubricStatus = holdoutDecision.rubricCoverage < 100 || unverifiedCriteria.length > 0
    ? "warning" as const
    : (evaluation.rubricScore ?? 0) >= rubricTarget ? "pass" as const : "fail" as const;
  const criterionScoreById = indexScopedAcceptanceResults([{ requestedCriterionIds: parsed.acceptanceRubric.map((criterion) => criterion.id), results: evaluation.criterionScores ?? [] }]).byId;
  const checks = [
    ...(parsed.acceptanceRubric.length ? [{ label: "Project-specific Rubric", status: rubricStatus, detail: `Rubric ${evaluation.rubricScore ?? "待评"} / ${rubricTarget}；真实证据覆盖 ${holdoutDecision.rubricCoverage}%。未验证项不计为产品失败，但 Release 前必须补齐。` }] : []),
    ...hardCriterionFailures.map((criterion) => ({ label: `Hard Gate · ${criterion.title}`, status: "fail" as const, detail: `Criterion ${criterion.id} 已有真实证据且未达到最低 ${criterion.minScore} 分；${criterion.requirement}` })),
    ...unverifiedHardCriteria.map((criterion) => { const judgeMissing=criterionScoreById.get(criterion.id)?.gaps.some((gap)=>gap.includes("评审模型未返回")); return { label: `${judgeMissing?"待补评审":"待真实验证"} · ${criterion.title}`, status: "warning" as const, detail: judgeMissing?`Criterion ${criterion.id} 的测试已经执行，但评审模型漏返逐题/逐标准判断；保持未验证，不按 0 分失败处理。`:`Criterion ${criterion.id} 缺少与其验证方式匹配的证据。下一步：${missingEvidenceAction(criterion)}。该状态阻止 Release，但不代表成果质量 FAIL。` }; }),
    ...comparisonEvidenceGaps.map((criterion) => ({ label: `同卷对照待补证 · ${criterion.title}`, status: "warning" as const, detail: `当前版本在同一道盲测题上缺少已验证的 Criterion ${criterion.id} 基线证据；请恢复执行或评审能力后重新运行完整验证。候选分数不能替代同卷对照。` })),
    ...unverifiedSoftCriteria.map((criterion) => ({ label: `待真实验证 · ${criterion.title}`, status: "warning" as const, detail: `Criterion ${criterion.id} 缺少可确认的验收证据；下一步：${missingEvidenceAction(criterion)}。该状态阻止 Release，但不代表成果质量 FAIL。` })),
    { label: "Safety", status: evaluation.safety === "PASS" ? "pass" as const : evaluation.safety === "FAIL" ? "fail" as const : "warning" as const, detail: evaluation.safety },
    { label: "关键能力回归", status: validationRegression(parsed, evaluation, baselineHoldout) ? "fail" as const : "pass" as const, detail: `回归结论基于双方已验证的同一标准；以下总分仅供参考。同一套盲测卷：候选 准确 ${evaluation.accuracy}% / 完成 ${evaluation.completeness}% vs 当前版本 ${baselineHoldout.accuracy}% / ${baselineHoldout.completeness}%（容差 ${regressionTolerance} 分）${regressionHeadline ? `；主因：${regressionHeadline}` : ""}` },
    ...(qualityTarget !== undefined ? [{ label: "目标质量", status: evaluation.accuracy >= qualityTarget ? "pass" as const : "warning" as const, detail: `质量 ${evaluation.accuracy}% / 目标 ${qualityTarget}%` }] : []),
    ...(successTarget !== undefined ? [{ label: "任务成功", status: evaluation.completeness >= successTarget ? "pass" as const : "warning" as const, detail: `完成度 ${evaluation.completeness}% / 目标 ${successTarget}%` }] : []),
    ...(evidenceTarget !== undefined ? [{ label: "证据覆盖", status: evaluation.evidence >= evidenceTarget ? "pass" as const : "warning" as const, detail: `证据 ${evaluation.evidence}% / 目标 ${evidenceTarget}%` }] : []),
    ...(riskTarget !== undefined ? [{ label: "稳健/风险覆盖", status: evaluation.riskCoverage >= riskTarget ? "pass" as const : "warning" as const, detail: `覆盖 ${evaluation.riskCoverage}% / 目标 ${riskTarget}%` }] : []),
    { label: "成本边界", status: evaluation.averageCost <= costLimit ? "pass" as const : "warning" as const, detail: `平均成本 ${evaluation.averageCost} / 边界 ${Number.isFinite(costLimit) ? costLimit : "未设置"}` },
  ];
  const failedCases = [...baselineRuns, ...runs].filter((item) => item.error).length;
  const evaluationWithNotes = failedCases
    ? { ...evaluation, notes: [`评审留痕：${failedCases} 题执行失败（对照卷与候选卷合计），该题按未完成任务计分`, ...evaluation.notes] }
    : evaluation;
  const hardFail = checks.some((check) => check.status === "fail");
  const evidenceIncomplete = holdoutDecision.evidenceIncomplete;
  // 评审同时看到可见卷基线与同卷盲测对照，避免「不同考卷比总分」造成误判
  onProgress?.(totalRuns, totalRuns, hardFail ? "Hard Gate 已失败 · 提前停止" : evidenceIncomplete ? "证据未完成 · 等待对应验证渠道补证" : "Release Review");
  // 发布审查同时看到实验阶段的失败题与补考历史，避免对「分数来路」信息不对称做出乐观判断。
  const experimentHistory = {
    failedExperimentCases: parsed.experimentRun.candidateResults.flatMap((result) => result.runs).filter((run) => run.error).length,
    experimentRetried: Boolean(parsed.experimentRun.previousScores),
    experimentSummary: parsed.experimentRun.summary,
  };
  // V2.3：验证主路径只做“是否可发布”的必要工作。过去这里无论成功失败都会
  // 额外自动生成 Gap Advice，导致每次 Hidden Validation 固定多一次 LLM 调用。
  // 现在 Hard Gate 已失败时直接 hold；通过时只调用 Release Review。优化建议改为按需点击生成。
  let review: unknown = { recommendation: "hold", summary: hardFail ? "存在已证实的 Hard Gate 失败，已跳过 Release Judge。" : "候选或同卷基线 Hard Gate 仍缺少真实证据，不能进入 Release。" };
  let recommendation: "release" | "hold" | "reject" = "hold";
  if (!hardFail && !evidenceIncomplete) {
    review = await runEvolveAi("release-review", { baseline, holdoutBaseline: baselineHoldout, candidate, holdout: evaluationWithNotes, checks, experimentHistory, evolutionCommand: parsed.evolutionCommand, sourceUnderstanding: parsed.sourceUnderstanding, acceptanceRubric: parsed.acceptanceRubric, criterionScores: evaluationWithNotes.criterionScores, rubricScore: evaluationWithNotes.rubricScore, aiProfile: parsed.aiProfile });
    recommendation = (review as { recommendation?: "release" | "hold" | "reject" }).recommendation || "hold";
  }
  const aiAdvice = undefined;
  // 建议效果结算：上一轮盲测给出的 AI 建议，本轮验证后逐条判定「执行了没 / 见效了没」，写进项目账本形成闭环。
  let settledAdvice: AdviceSettlement | undefined;
  const priorAdvice = parsed.validationRun.aiAdvice;
  const priorEval = parsed.validationRun.evaluation;
  if (priorAdvice && priorAdvice.actions.length && priorEval) {
    const winnerCandidate = parsed.candidates.find((item) => item.id === candidate.id);
    const executed = (title: string) => parsed.evolutionCommand.includes(title) || (winnerCandidate?.addressesAdvice ?? []).includes(title);
    const improvedOverall = (evaluation.accuracy + evaluation.completeness) > (priorEval.accuracy + priorEval.completeness);
    settledAdvice = {
      settledAt: now(),
      adviceOverall: priorAdvice.overall,
      before: { accuracy: priorEval.accuracy, completeness: priorEval.completeness },
      after: { accuracy: evaluation.accuracy, completeness: evaluation.completeness },
      actions: priorAdvice.actions.map((action) => {
        const wasExecuted = executed(action.title);
        return {
          title: action.title,
          target: action.target,
          executed: wasExecuted,
          improved: wasExecuted && improvedOverall,
          note: wasExecuted
            ? (improvedOverall
              ? `已执行；本轮整体 准确 ${priorEval.accuracy}%→${evaluation.accuracy}% / 完成 ${priorEval.completeness}%→${evaluation.completeness}%，方向见效`
              : "已执行但整体分数未提升：该动作落点可能不对，建议换法或回根因诊断复核")
            : "未转化为进化要求，本轮没有执行",
        };
      }),
    };
  }
  // V2.1 Artifact-in-the-loop：版本快照必须就是刚刚被 Hidden Validation 执行的
  // Candidate Artifact Snapshot，不能在验证结束后再按 Patch 重新拼一份“类似结果”。
  // 因此版本历史、Gate F、最终交付共享同一份 immutable content snapshot。
  const versionSnapshot: EvolvedVersion = {
    id: `version-${Date.now()}`,
    label: `V${parsed.versions.length + 1}`,
    createdAt: now(),
    source: "validation",
    candidateTitle: candidate.title || candidate.id,
    recommendation,
    scores: { accuracy: evaluation.accuracy, completeness: evaluation.completeness },
    summary: hardFail ? "本轮盲测存在失败项，Candidate Artifact Snapshot 仅供诊断，不建议发布。" : `Hidden Validation 实际执行的完整 Candidate Artifact（候选「${candidate.title || candidate.id}」）。`,
    artifacts: candidate.artifactSnapshots.map((artifact, index) => ({
      id: `vart-${Date.now()}-${index}`,
      name: artifact.name,
      sourceArtifactId: artifact.sourceArtifactId,
      content: artifact.content,
    })),
  };
  return {
    id: `validation-${Date.now()}`,
    status: "completed",
    validationMode: "full",
    plannedCases: suite.length,
    executedCases: suite.length,
    candidateId: candidate.id,
    evaluation: evaluationWithNotes,
    aiAdvice,
    settledAdvice,
    versionSnapshot,
    // 保留同卷两组执行明细，供验证页逐题回看候选与当前版本的差距来源
    runs,
    baselineRuns,
    // 当前版本同卷快照：万一后续要重跑验证，可复用省掉半程开销
    baselineEvaluation: baselineHoldout,
    baselineSuiteIds: suiteIds,baselineContextFingerprint:roundFingerprint,baselineObservedAt:Date.now(),
    // 补考轮保留上一轮分数，供验证页展示「旧 → 新」对比
    previousEvaluation: options?.retryFailedOnly ? prior.evaluation : undefined,
    checks,
    recommendation,
    summary: hardFail ? "存在已有 AI 语义、文件或运行证据的 Hard Gate 失败项，不能进入发布。" : evidenceIncomplete ? `当前成果未被判失败，但有 ${unverifiedHardCriteria.length} 个候选 Hard Gate、${unverifiedSoftCriteria.length} 个普通验收标准和 ${comparisonEvidenceGaps.length} 个同卷基线对照项缺少已验证证据；请补证后重新验证。` : ((review as { summary?: string }).summary || "完整隐藏验证已通过。"),
  };
}

/**
 * Cheap repair probe: after a targeted content repair, re-check only the criteria that were actually
 * changed. It cannot authorize release; a passing probe merely allows one authoritative full
 * Hidden Validation. This prevents Behavior Repair from repaying the whole holdout on every attempt.
 */
export async function runFocusedRepairValidation(project: EvolveProject, inputCandidate: Candidate, criterionIds: string[], onProgress?: (done: number, total: number, phase?: string) => void) {
  const parsed = EvolveProjectSchema.parse(project);
  const candidate = CandidateSchema.parse(inputCandidate);
  const targetIds = new Set(criterionIds);
  const focusedRubric = parsed.acceptanceRubric.filter((criterion) => targetIds.has(criterion.id));
  const suite = normalizeEvalSuiteForProject(parsed, [], parsed.hiddenEvalSuite).hiddenCases.filter((testCase) => testCase.criterionIds.some((id) => targetIds.has(id)));
  if (!focusedRubric.length || !suite.length) return { passed: false, failedCriterionIds: [], unverifiedCriterionIds: criterionIds, evaluation: undefined, runs: [] as TargetRunResult[] };
  const adapter = getTargetAdapter(parsed);
  const policy = effectiveExperimentPolicy(parsed);
  const runs = await executeCandidateAwareCaseSet({ adapter, project: parsed, testCases: suite, variant: candidate, batchSize: policy.batchArtifactRuntime ? policy.batchSize : 1, concurrency: 2, onProgress: (done,total)=>onProgress?.(done,total,"定向复核 · 只检查已修复标准") });
  const focusedProject = { ...parsed, acceptanceRubric: focusedRubric };
  const evaluation = applySupplementalEvidenceToEvaluation(focusedProject, candidate, await evaluateRuns({ testCases: suite, runs, context: { mode: "repair-focus", candidate, project: evaluationProjectContext(focusedProject) } }));
  const byId = indexScopedAcceptanceResults([{ requestedCriterionIds: focusedRubric.map((criterion) => criterion.id), results: evaluation.criterionScores ?? [] }]).byId;
  const failedCriterionIds = focusedRubric.filter((criterion) => { const score=byId.get(criterion.id); return score?.verificationStatus === "verified" && score.pass !== true; }).map((criterion)=>criterion.id);
  const unverifiedCriterionIds = focusedRubric.filter((criterion) => byId.get(criterion.id)?.verificationStatus !== "verified").map((criterion)=>criterion.id);
  return { passed: evaluation.safety !== "FAIL" && failedCriterionIds.length === 0 && unverifiedCriterionIds.length === 0, failedCriterionIds, unverifiedCriterionIds, evaluation, runs };
}

// V2.1: Candidate Artifact Snapshot 已在实验前完整构造；不再在验证后用 Patch 重新拼接另一份成果。

// ===== POST /api/v1/runner/release =====

const actions = ["shadow", "canary-5", "canary-20", "canary-50", "promote", "rollback"] as const;
type Action = typeof actions[number];

// shadow 的合法前态除了初始 idle，还包括上一轮发布周期的终态（promoted / rolled-back）：
// 旧版本已上线或已回滚后，新一轮候选从 Shadow 重新挑战是正常的新发布周期起点。
const requiredPrevious: Partial<Record<Action, string | string[]>> = {
  shadow: ["idle", "promoted", "rolled-back"],
  "canary-5": "shadow",
  "canary-20": "canary-5",
  "canary-50": "canary-20",
  promote: "canary-50",
};

export async function runRelease(project: EvolveProject, inputCandidate: Candidate, action: Action): Promise<ReleaseAdapterResult & { action: Action;outcomeTelemetry?:ReleaseOutcomeTelemetryStatus }> {
  const parsed = EvolveProjectSchema.parse(project);
  const candidate = CandidateSchema.parse(inputCandidate);
  if (!actions.includes(action)) throw new Error("Unsupported release action");
  const releaseMode = parsed.releaseTarget?.mode ?? "progressive";
  if (releaseMode === "preview-promote" && ["canary-5", "canary-20", "canary-50"].includes(action)) {
    throw new Error("当前发布平台使用 Preview → Promote，不支持 5% / 20% / 50% Canary。");
  }
  const requestedStatus = action === "promote" ? "promoted" : action === "rollback" ? "rolled-back" : action;
  const refreshingCurrentStage = parsed.release.status === requestedStatus;

  if (action !== "rollback") {
    const readiness = deliveryReadiness({ ...parsed, candidates: parsed.candidates.map((item) => item.id === candidate.id ? candidate : item) });
    if (!readiness.ready) throw new Error(readiness.reasons.join("；"));
  }
  const artifactGate = parsed.gates.find((gate) => gate.id === "artifact-ready");
  const releaseGate = parsed.gates.find((gate) => gate.id === "release-ready");
  if (action !== "rollback" && artifactGate?.status !== "approved") throw new Error("Artifact Ready gate is not approved");
  if (action !== "rollback" && parsed.artifactAcceptance.status !== "passed") throw new Error("Final Artifact has not passed Acceptance Gate");
  if (action !== "rollback" && releaseGate?.status !== "approved") throw new Error("Release Ready gate is not approved");
  if (action !== "rollback" && !refreshingCurrentStage && parsed.release.observationStatus === "observing") throw new Error("当前发布阶段仍在采集生产样本，请先刷新当前阶段指标，达到门槛后再推进流量。");
  if (action !== "rollback" && !refreshingCurrentStage && parsed.release.healthy === false) throw new Error("Current release KPI is unhealthy. Rollback or investigate before advancing traffic.");

  if (action !== "rollback") {
    const expected = releaseMode === "preview-promote"
      ? (action === "shadow" ? ["idle", "promoted", "rolled-back"] : action === "promote" ? "shadow" : undefined)
      : requiredPrevious[action];
    const expectedList = expected === undefined ? [] : Array.isArray(expected) ? expected : [expected];
    if (!refreshingCurrentStage && expectedList.length && !expectedList.includes(parsed.release.status)) {
      throw new Error(`Invalid release transition: ${parsed.release.status} → ${action}; expected previous state ${expectedList.join(" / ")}`);
    }
  } else if (parsed.release.status === "idle") {
    throw new Error("Nothing has been released, rollback is not available");
  }

  if (parsed.validationRun.recommendation !== "release" && action !== "rollback") throw new Error("Validation did not recommend release");
  if (parsed.experimentRun.winnerId !== candidate.id) throw new Error("Only the experiment winner can be released");
  if (action !== "rollback") {
    if (parsed.artifactAcceptance.candidateId !== candidate.id || !candidate.artifactSnapshots.length) throw new Error("待发布版本与已验收版本不一致。");
    for (const snapshot of candidate.artifactSnapshots) {
      const receipt = parsed.artifactAcceptance.frozenArtifacts?.find((item) => item.sourceArtifactId === snapshot.sourceArtifactId);
      await readFrozenArtifact(receipt, snapshot.content);
    }
  }

  let result: ReleaseAdapterResult & {outcomeTelemetry?:ReleaseOutcomeTelemetryStatus};
  const serverManagedOnlineRelease=productionRuntimeMode()!=="local"&&projectHasOnlineReleaseTarget(parsed);
  if (serverManagedOnlineRelease) {
    // Server API re-reads the Mission and durable approval before touching production.
    // Force the latest browser projection to the backend first so Winner/Gate/Artifact Hash cannot be stale.
    await getProductionRuntime().missions.save(parsed);
    result = await runServerReleaseAction({
      missionId: parsed.id,
      candidateId: candidate.id,
      action,
      deploymentId: action === "rollback" ? parsed.release.stableDeploymentId : parsed.release.deploymentId,
    });
  } else {
    if(parsed.releaseTarget?.provider==="connector"){
      throw new Error("Connector Production Release 只能由 Server Durable Workflow / Release API 执行；本地模式禁止直接触发生产副作用。");
    }
    const adapter = getTargetAdapter(parsed);
    if (!adapter.live) throw new Error("当前项目使用离线 Artifact/Mock Runner，不能执行真实 Shadow、Canary 或 Promote。请连接独立 Release Target 或真实 HTTP Target Runner。");
    if (!adapter.release) throw new Error("Target adapter does not implement release()");
    result = await adapter.release({ project: parsed, candidate, action });
  }
  if (result.evidenceMode !== "live") throw new Error("发布接口只返回了模拟结果，未声明 evidenceMode=live；本次不会写入 Shadow / Canary / Promote 状态。请让真实 Target Runner 返回生产证据类型后重试。");
  const durablePreviewPromote=releaseMode==="preview-promote"
    &&parsed.releaseTarget?.provider==="vercel"
    &&["shadow","promote","rollback"].includes(action);
  if (!result.ok&&!durablePreviewPromote) throw new Error(`真实发布平台拒绝了 ${action}：${result.note}`);
  const effectiveAction = result.effectiveAction ?? action;
  if (!actions.includes(effectiveAction)) throw new Error(`发布平台返回了不支持的 effectiveAction：${String(effectiveAction)}`);
  if (!result.deploymentId || !result.observedAt) throw new Error("真实发布回执缺少 deploymentId 或 observedAt，本次不会写入发布状态。");
  if (effectiveAction !== "rollback") {
    const expected = candidate.artifactSnapshots.filter((snapshot) => snapshot.contentHash).map((snapshot) => ({ sourceArtifactId: snapshot.sourceArtifactId, contentHash: snapshot.contentHash! }));
    const received = result.artifactHashes ?? (expected.length === 1 && result.artifactHash ? [{ sourceArtifactId: expected[0]!.sourceArtifactId, contentHash: result.artifactHash }] : []);
    if (!expected.length || expected.some((item) => !received.some((receipt) => receipt.sourceArtifactId === item.sourceArtifactId && receipt.contentHash === item.contentHash))) {
      throw new Error("线上发布回执的 Artifact Hash 与已验收快照不一致或不完整；禁止推进流量。");
    }
  }
  if (releaseMode !== "preview-promote" && ["canary-5", "canary-20", "canary-50", "promote"].includes(effectiveAction) && result.observationStatus !== "observing" && (!result.sampleSize || !result.windowMinutes)) {
    throw new Error("Canary/Promote 回执缺少有效 sampleSize 或 windowMinutes；样本和观察窗口不足时不能推进流量。");
  }
  return { ...result, action: effectiveAction };
}

// ===== GET /api/v1/runner/status =====

export function getRunnerStatus() {
  return { ai: getAiProviderStatus(), target: getTargetStatus() };
}
