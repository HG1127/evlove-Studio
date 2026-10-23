import type { EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { campaignScoringInputFingerprint, citesHistoricalEvidence, fastHash, isTextArtifactExtension, isZipArtifact, requiresIndependentFormatValidation } from "@evolution/core";

import { compactServerSourceText, serverSemanticContextQuery, SERVER_SEMANTIC_CONTEXT_VERSION } from "./server-source-context";

// Delimited files are structured spreadsheets, not text snapshots that prove format.

export function trustedServerBaselineChampion(project: EvolveProject) {
  const champion = project.searchChampion;
  const candidate = champion?.candidate;
  if (!candidate?.artifactSnapshots.length) return undefined;
  if (champion?.validation?.status !== "completed" || champion.validation.recommendation !== "release") return undefined;
  if (champion.artifactAcceptance?.status !== "passed" || champion.artifactAcceptance.candidateId !== candidate.id) return undefined;
  return candidate;
}

function structuredFamily(artifact: EvolveProject["sourceArtifacts"][number]) {
  return artifact.artifactKind === "presentation"
    || artifact.artifactKind === "spreadsheet"
    || isZipArtifact(artifact)
    || artifact.artifactDescriptor?.adapterId === "document-docx-ooxml"
    || artifact.artifactDescriptor?.family === "spreadsheet";
}

function trustedSnapshot(project: EvolveProject, sourceArtifactId: string) {
  return trustedServerBaselineChampion(project)?.artifactSnapshots.find((snapshot) => snapshot.sourceArtifactId === sourceArtifactId);
}

export function semanticEvidenceStatus(output: string): TargetRunResult["verificationStatus"] {
  if (!output.trim() || /^\s*UNVERIFIED\b/i.test(output) || citesHistoricalEvidence(output)) return "unverified";
  if (/\bUNVERIFIED\b/i.test(output)) return "partial";
  return "verified";
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function artifactText(project: EvolveProject, artifact: EvolveProject["sourceArtifacts"][number]) {
  const snapshot = trustedSnapshot(project, artifact.id);
  if (snapshot && !structuredFamily(artifact)) return snapshot.content;
  if (artifact.textContent?.trim()) return artifact.textContent;
  if (artifact.textExcerpt?.trim()) return artifact.textExcerpt;
  const structured = artifact.structuredContent as Record<string, unknown> | undefined;
  const entryText = records(structured?.entries)
    .slice(0, 180)
    .map((entry) => typeof entry.content === "string" ? `[${String(entry.path ?? "")}]\n${entry.content}` : "")
    .filter(Boolean)
    .join("\n\n");
  return entryText || artifact.structure.slice(0, 300).join("\n");
}

export function boundedBaselineArtifacts(project: EvolveProject, budget = 56_000, testCases: TestCase[] = project.evalSuite) {
  const ordered = [...project.sourceArtifacts].sort((a, b) => Number(b.role === "target") - Number(a.role === "target"));
  const query = serverSemanticContextQuery(project, testCases);
  let remaining = budget;
  return ordered.slice(0, 12).map((artifact) => {
    const snapshot = trustedSnapshot(project, artifact.id);
    const source = artifactText(project, artifact);
    const allowance = Math.max(0, Math.min(18_000, remaining));
    const html = /^(html|htm)$/i.test(artifact.extension) || /^text\/html(?:;|$)/i.test(artifact.mimeType);
    const content = compactServerSourceText(source, query, allowance, html);
    remaining = Math.max(0, remaining - content.length);
    return {
      id: artifact.id,
      name: artifact.name,
      role: artifact.role,
      mimeType: artifact.mimeType,
      artifactKind: artifact.artifactKind,
      extension: artifact.extension,
      structure: artifact.structure.slice(0, 80),
      content,
      currentVersion: snapshot ? (project.searchChampion?.versionLabel ?? project.searchChampion?.id) : project.version,
      snapshotHash: snapshot?.contentHash,
      originalChars: source.length,
      truncated: content !== source || (!snapshot && !artifact.textContent && Boolean(artifact.textExcerpt)),
    };
  });
}

export async function currentSemanticArtifactContext(
  project: EvolveProject,
  build?: (args: { project: EvolveProject; testCases?: TestCase[] }) => Promise<Array<Record<string, unknown>>>,
  testCases: TestCase[] = project.evalSuite,
): Promise<Array<Record<string, unknown>>> {
  const stored = Boolean(project.searchChampion) || project.sourceArtifacts.some((artifact) => Boolean(artifact.storageRef?.trim())
    || artifact.inputMode === "upload" || artifact.inputMode === "remote");
  if (!stored) return boundedBaselineArtifacts(project, 56_000, testCases);
  if (!build) throw new Error("当前版本缺少实际文件语义上下文端口，不能让过期解析索引产生 VERIFIED 结论。");
  const context = await build({ project, testCases });
  const targets = project.sourceArtifacts.filter((artifact) => artifact.role === "target");
  if (!Array.isArray(context) || !targets.length || targets.some((target) => context.filter((item) => item.id === target.id).length !== 1)) {
    throw new Error("当前版本语义上下文没有覆盖全部唯一 Target。");
  }
  return context;
}
export function serverBaselineCurrentViewGap(project: EvolveProject, testCase: TestCase) {
  const candidate = trustedServerBaselineChampion(project);
  if (!candidate) return undefined;
  if (testCase.executionMode !== "artifact-runtime" && testCase.executionMode !== "static-evidence") return undefined;
  const affectedIds = new Set(
    project.acceptanceRubric
      .filter((criterion) => testCase.criterionIds.includes(criterion.id))
      .flatMap((criterion) => criterion.artifactIds),
  );
  const targets = project.sourceArtifacts.filter((artifact) =>
    artifact.role === "target"
    && (!affectedIds.size || affectedIds.has(artifact.id))
    && candidate.artifactSnapshots.some((snapshot) => snapshot.sourceArtifactId === artifact.id));
  const unsupported = targets.filter(structuredFamily);
  if (!unsupported.length) return undefined;
  return `当前已验收 Search Champion ${project.searchChampion?.versionLabel ?? candidate.id} 包含结构化成果 ${unsupported.map((artifact) => artifact.name).join("、")}；Server 尚未把该 Champion 的结构化 Snapshot 重新物化为可精确读取的当前成果，不能退回原版充当 Baseline。`;
}

export function unavailableBaselineRun(testCase: TestCase, detail: string): TargetRunResult {
  return {
    testCaseId: testCase.id,
    output: `UNVERIFIED：${detail}`,
    latencyMs: 0,
    cost: 0,
    verificationStatus: "unverified",
    trace: [{
      id: `server-unverified-${testCase.id}`,
      stage: testCase.executionMode,
      summary: "Server Baseline 当前缺少该证据能力",
      status: "warning",
      detail,
    }],
  };
}

export async function storedBaselineEvidence(
  project: EvolveProject,
  testCase: TestCase,
  execute?: (args: { project: EvolveProject; testCase: TestCase }) => Promise<TargetRunResult>,
): Promise<TargetRunResult | undefined> {
  if (testCase.executionMode !== "static-evidence" && testCase.executionMode !== "roundtrip") return undefined;
  if (testCase.criterionIds.length && testCase.criterionIds.every((id) => id === "SYS-PAIRWISE")) return unavailableBaselineRun(testCase, "原版是 Pairwise 比较起点；相对改进只能在 Candidate 实验中验证。");
  if (!project.searchChampion && !project.sourceArtifacts.some((artifact) => artifact.role === "target" && (Boolean(artifact.storageRef?.trim()) || artifact.inputMode === "upload" || artifact.inputMode === "remote"))) return undefined;
  if (!execute) return unavailableBaselineRun(testCase, "Server 当前版本缺少实际文件读取端口，不能用解析索引代替冻结字节。");
  try {
    const result = await execute({ project, testCase });
    return result.testCaseId === testCase.id ? result : unavailableBaselineRun(testCase, "当前版本文件证据返回了错误的 Test Case ID。");
  } catch (error) {
    return unavailableBaselineRun(testCase, `当前版本文件读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
export function baselineLocalEvidence(project: EvolveProject, testCase: TestCase): TargetRunResult | undefined {
  if (testCase.criterionIds.length > 0 && testCase.criterionIds.every((id) => id === "SYS-PAIRWISE")) {
    return unavailableBaselineRun(testCase, "原版是 Pairwise 比较起点；相对改进只能在 Candidate 实验中验证。");
  }
  if (testCase.executionMode === "manual") {
    return unavailableBaselineRun(testCase, "需要人工验收证据，Server Baseline 不会用 AI 模拟替代。");
  }
  if (testCase.executionMode === "roundtrip") {
    if(testCase.evidenceScope==="product-behavior")return unavailableBaselineRun(testCase,
      "格式往返不能证明实际产品行为；请使用独立 Runner。");
    const started = Date.now();
    const targets = project.sourceArtifacts.filter((artifact) => artifact.role === "target");
    const currentTexts = targets.map((artifact) => ({
      artifact,
      snapshot: trustedSnapshot(project, artifact.id),
      content: artifactText(project, artifact),
    }));
    if (
      currentTexts.length
      && currentTexts.every(({ artifact, content }) => !structuredFamily(artifact)
        && isTextArtifactExtension(artifact.extension)
        && !requiresIndependentFormatValidation(artifact.extension)
        && content.length > 0)
    ) {
      const details = currentTexts.map(({ artifact, snapshot, content }) => {
        const bytes = new TextEncoder().encode(content);
        const restored = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return {
          name: artifact.name,
          format: artifact.extension,
          bytes: bytes.length,
          preserved: restored === content,
          currentVersion: snapshot ? (project.searchChampion?.versionLabel ?? project.searchChampion?.id) : project.version,
        };
      });
      const preserved = details.every((item) => item.preserved);
      return {
        testCaseId: testCase.id,
        output: `TEXT FORMAT ROUNDTRIP\n${JSON.stringify(details)}\nServer 对当前 Baseline 完整文本执行 UTF-8 编码→解码并逐字比较。`,
        latencyMs: Date.now() - started,
        cost: 0,
        verificationStatus: preserved ? "verified" : "partial",
        trace: [{
          id: `server-roundtrip-${testCase.id}`,
          stage: "format-roundtrip",
          summary: preserved ? "Baseline 文本实际编解码一致" : "Baseline 文本编解码不一致",
          status: preserved ? "pass" : "warning",
        }],
      };
    }
    const details = targets.map((artifact) => ({
      name: artifact.name,
      format: artifact.extension,
      adapter: artifact.artifactDescriptor?.adapterId,
      preservation: artifact.artifactDescriptor?.preservationMode,
      materialize: artifact.artifactDescriptor?.capabilities.materialize,
      structureNodes: artifact.structure.length,
    }));
    return {
      testCaseId: testCase.id,
      output: `FORMAT / ROUNDTRIP CAPABILITY EVIDENCE\n${JSON.stringify(details, null, 2)}\n当前仅能证明格式适配能力，尚未在 Server 重新物化二进制成果。`,
      latencyMs: Date.now() - started,
      cost: 0,
      verificationStatus: details.length && details.every((item) => item.materialize) ? "partial" : "unverified",
      trace: [{
        id: `server-roundtrip-capability-${testCase.id}`,
        stage: "format-roundtrip",
        summary: "检查 Baseline 原格式适配/物化能力",
        status: details.length && details.every((item) => item.materialize) ? "pass" : "warning",
      }],
    };
  }
  if (testCase.executionMode === "static-evidence") {
    const started = Date.now();
    const targets = project.sourceArtifacts.filter((artifact) => artifact.role === "target");
    const blocks = targets.flatMap((artifact) => {
      const text = artifactText(project, artifact);
      const structure = artifact.structure.slice(0, 120);
      if (!text && !structure.length) return [];
      return [{
        name: artifact.name,
        artifactKind: artifact.artifactKind,
        structure,
        content: text.slice(0, 14_000),
        originalChars: text.length,
      }];
    });
    if (!blocks.length) return unavailableBaselineRun(testCase, "当前 Mission 没有可定位的文本/结构索引，无法形成静态证据。");
    const productBehavior = testCase.evidenceScope === "product-behavior";
    return {
      testCaseId: testCase.id,
      output: [
        "SERVER STATIC ARTIFACT EVIDENCE",
        `验收目标：${testCase.title}`,
        ...blocks.map((block) => `--- ${block.name} · ${block.artifactKind} · ${block.originalChars} chars ---\nStructure: ${block.structure.join(" | ") || "none"}\n${block.content}`),
        productBehavior
          ? "说明：以上是真实静态成果证据，但不能单独证明用户行为/E2E 已通过。"
          : "说明：以上内容来自当前 Baseline 成果/结构索引，可用于实现与结构级验收。",
      ].join("\n\n"),
      latencyMs: Date.now() - started,
      cost: 0,
      verificationStatus: productBehavior ? "partial" : "verified",
      trace: [{
        id: `server-static-${testCase.id}`,
        stage: "static-evidence",
        summary: `读取 ${blocks.length} 个 Target 的静态内容/结构证据`,
        status: productBehavior ? "warning" : "pass",
        detail: blocks.map((block) => block.name).join("；"),
      }],
    };
  }
  return undefined;
}

export function compactBaselineRunOutput(text: string, query: string, maxChars = 6000) {
  if (text.length <= maxChars) return text;
  const lower = text.toLowerCase();
  const terms = query.toLowerCase().match(/[a-z0-9._/-]{4,}|\p{Script=Han}{2,}/gu) ?? [];
  const position = terms.map((term) => lower.indexOf(term)).find((index) => index >= 0) ?? Math.floor(text.length / 2);
  const middleBudget = Math.floor(maxChars * 0.5);
  const around = text.slice(Math.max(0, position - Math.floor(middleBudget / 2)), position + Math.ceil(middleBudget / 2));
  const edge = Math.floor((maxChars - around.length) / 2);
  return [text.slice(0, edge), around, text.slice(-edge)]
    .filter(Boolean)
    .join("\n\n--- server evidence slice ---\n\n")
    .slice(0, maxChars);
}

export function serverBaselineFingerprint(project: EvolveProject, scoringRouteFingerprint?: string) {
  const champion = project.searchChampion;
  const trustedChampion = champion?.candidate
    && champion.validation?.status === "completed"
    && champion.validation.recommendation === "release"
    && champion.artifactAcceptance?.status === "passed"
    && champion.artifactAcceptance.candidateId === champion.candidate.id
      ? champion.candidate
      : undefined;
  return fastHash({
    version: "server-baseline-v3",
    semanticContextVersion: SERVER_SEMANTIC_CONTEXT_VERSION,
    scoringInputFingerprint: campaignScoringInputFingerprint(project),
    scoringRouteFingerprint,
    goal: project.goal,
    command: project.evolutionCommand,
    rubric: project.acceptanceRubric,
    evalSuite: project.evalSuite,
    hiddenEvalSuite: project.hiddenEvalSuite,
    protectedItems: project.protectedItems,
    clarifications: project.inputClarifications,
    metrics: project.metrics.map(({ key, target, direction }) => ({ key, target, direction })),
    targets: project.sourceArtifacts.map((artifact) => ({
      id: artifact.id,
      role: artifact.role,
      text: artifact.textContent ?? artifact.textExcerpt ?? "",
      structure: artifact.structure,
      descriptor: artifact.artifactDescriptor,
    })),
    champion: trustedChampion?.artifactSnapshots.map((snapshot) => ({
      sourceArtifactId: snapshot.sourceArtifactId,
      contentHash: snapshot.contentHash,
      content: snapshot.content,
    })),
  });
}
