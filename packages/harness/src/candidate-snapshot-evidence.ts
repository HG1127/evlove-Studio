import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { criterionCanUseLocalSnapshotEvidence, fastHash } from "@evolution/core";
import { retrieveTextContext } from "./context-retrieval";

const LOCALLY_ROUNDTRIPPABLE_TEXT = /^(txt|md|markdown|csv|json|yaml|yml|css|js|jsx|ts|tsx)$/i;

function staticSnapshotText(content: string) {
  try {
    const parsed = JSON.parse(content) as { files?: Array<{ path?: unknown; content?: unknown }> };
    if (parsed.files !== undefined) {
      if (!Array.isArray(parsed.files) || !parsed.files.length) return undefined;
      const paths = new Set<string>();
      const files: string[] = [];
      for (const item of parsed.files) {
        if (typeof item?.path !== "string" || !item.path.trim() || typeof item?.content !== "string" || paths.has(item.path)) return undefined;
        paths.add(item.path);
        files.push(`FILE: ${item.path}\n${item.content}`);
      }
      return files.join("\n\n");
    }
  } catch {
    // Plain-text and non-package snapshots are already directly reviewable.
  }
  return content;
}

function docxCandidateText(source: EvolveProject["sourceArtifacts"][number], content: string) {
  try {
    const original = source.structuredContent as { parts?: Array<{ path?: unknown; textRuns?: Array<{ index?: unknown; text?: unknown }> }> } | undefined;
    const candidate = JSON.parse(content) as { parts?: Array<{ path?: unknown; textRuns?: Array<string | { index?: unknown; text?: unknown }> }> };
    if (!Array.isArray(original?.parts) || !original.parts.length || !Array.isArray(candidate.parts) || !candidate.parts.length) return undefined;
    const replacements = new Map<string, string[]>();
    for (const part of candidate.parts) {
      if (typeof part.path !== "string" || !part.path || !Array.isArray(part.textRuns) || replacements.has(part.path)) return undefined;
      const sourcePart = original.parts.find((item) => item.path === part.path);
      if (!sourcePart || !Array.isArray(sourcePart.textRuns)) return undefined;
      const runs = sourcePart.textRuns.map((item) => item.text);
      if (runs.some((item) => typeof item !== "string")) return undefined;
      const updated = runs as string[];
      const seen = new Set<number>();
      for (const [position, run] of part.textRuns.entries()) {
        const index = typeof run === "string" ? position : run.index;
        const text = typeof run === "string" ? run : run.text;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= updated.length || typeof text !== "string" || seen.has(index)) return undefined;
        seen.add(index);
        updated[index] = text;
      }
      replacements.set(part.path, updated);
    }
    if (original.parts.some((part) => typeof part.path !== "string" || !Array.isArray(part.textRuns) || part.textRuns.some((run) => typeof run.text !== "string"))) return undefined;
    const text = original.parts.map((part) => {
      const path = part.path as string;
      const runs = replacements.get(path) ?? part.textRuns!.map((run) => run.text as string);
      return `PART: ${path}\n${runs.join("")}`;
    }).join("\n\n");
    return text.trim() ? text : undefined;
  } catch {
    return undefined;
  }
}

function isCodebaseOverlay(content: string) {
  try {
    const parsed = JSON.parse(content) as { overlay?: unknown };
    return parsed?.overlay === true;
  } catch {
    return false;
  }
}
function htmlCandidateText(content: string) {
  if (!/<html\b[^>]*>/i.test(content) || !/<\/html\s*>/i.test(content)
    || !/<body\b[^>]*>/i.test(content) || !/<\/body\s*>/i.test(content)) return undefined;
  return content;
}

/**
 * Bind locally provable validation evidence to the exact Candidate snapshot.
 *
 * This is execution mechanics, not a verdict:
 * - deterministic text roundtrip can be marked verified here;
 * - semantic/user-scenario snapshot evidence only exposes the current artifact to an
 *   independent evaluator and never decides whether the rubric requirement passed.
 *
 * The function is browser/infrastructure independent so both the local runtime and
 * durable server workflow can reuse the exact same evidence route.
 */
export function normalizeLocallyVerifiableCandidateRuns(
  project: EvolveProject,
  candidate: Candidate,
  testCases: TestCase[],
  runs: TargetRunResult[],
  options?: { semanticProviderLive?: boolean },
): TargetRunResult[] {
  // Compatibility-only option retained for migrated callers. Snapshot evidence no longer depends
  // on a second execution-model connection.
  void options;
  const tests = new Map(testCases.map((testCase) => [testCase.id, testCase]));
  const criteria = new Map(project.acceptanceRubric.map((criterion) => [criterion.id, criterion]));
  const sources = new Map(project.sourceArtifacts.map((artifact) => [artifact.id, artifact]));

  return runs.map((run) => {
    if (run.error) return run;
    const testCase = tests.get(run.testCaseId);
    if (!testCase) return run;
    const mapped = testCase.criterionIds.flatMap((id) => {
      const criterion = criteria.get(id);
      return criterion ? [criterion] : [];
    });
    if (!mapped.length) return run;

    // Server roundtrip evidence is backed by a fresh Blob read. Do not let the legacy
    // text-only UTF-8 shortcut replace a missing or stale frozen-file result.
    if (testCase.executionMode === "roundtrip" && run.trace.some((step) => step.id === `server-frozen-roundtrip-${testCase.id}`)) {
      if (run.verificationStatus === "unverified") return run;
      const scopedIds = new Set(mapped.flatMap((criterion) => criterion.artifactIds));
      const targetIds = project.sourceArtifacts.filter((source) => source.role === "target").map((source) => source.id);
      const expectedIds = scopedIds.size ? [...scopedIds] : targetIds;
      const snapshots = candidate.artifactSnapshots.filter((snapshot) => expectedIds.includes(snapshot.sourceArtifactId));
      const exactCoverage = expectedIds.length > 0
        && new Set(targetIds).size === targetIds.length
        && snapshots.length === expectedIds.length
        && new Set(snapshots.map((snapshot) => snapshot.sourceArtifactId)).size === snapshots.length
        && snapshots.every((snapshot) => snapshot.frozenArtifact?.sourceArtifactId === snapshot.sourceArtifactId);
      const signature = JSON.stringify(snapshots.map((snapshot) => [snapshot.sourceArtifactId, snapshot.frozenArtifact?.sha256, fastHash(snapshot.content)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
      const bound = exactCoverage && run.verificationStatus === "verified"
        && (snapshots.length !== 1 || run.artifactHash === snapshots[0]!.frozenArtifact?.sha256)
        && run.trace.some((step) => step.id === `server-frozen-roundtrip-${testCase.id}` && step.status === "pass" && step.detail === signature);
      return bound ? run : {
        ...run,
        output: "UNVERIFIED：Server 格式往返证据与当前冻结文件集合不一致。",
        verificationStatus: "unverified",
        artifactHash: undefined,
        trace: [...run.trace, { id: `server-frozen-binding-${testCase.id}`, stage: "format-roundtrip", summary: "冻结文件往返绑定失效", status: "warning" }],
      };
    }
    // The Target adapter has already read and hashed the materialized ZIP. Keep that exact
    // result instead of replacing it with the Candidate overlay's partial text evidence.
    if (testCase.executionMode === "static-evidence" && run.trace.some((step) => step.id === `candidate-zip-static-${testCase.id}` && step.stage === "candidate-static-evidence")) {
      if (run.verificationStatus === "unverified") return run;
      const scopedIds = new Set(mapped.flatMap((criterion) => criterion.artifactIds));
      const targets = project.sourceArtifacts.filter((source) => source.role === "target" && source.artifactKind === "codebase" && (!scopedIds.size || scopedIds.has(source.id)));
      const snapshots = targets.length === 1 ? candidate.artifactSnapshots.filter((snapshot) => snapshot.sourceArtifactId === targets[0]!.id) : [];
      const receipt = snapshots.length === 1 ? snapshots[0]!.frozenArtifact : undefined;
      const bound = receipt?.sourceArtifactId === targets[0]?.id
        && run.artifactHash === receipt.sha256
        && run.trace.some((step) => step.id === `candidate-zip-static-${testCase.id}` && step.stage === "candidate-static-evidence" && step.status === "pass" && step.detail === receipt.sha256)
        && (testCase.evidenceScope !== "product-behavior" || run.verificationStatus !== "verified");
      return bound ? run : {
        ...run,
        output: "UNVERIFIED：冻结代码包证据与当前 Candidate Snapshot 的 Target 或 SHA-256 不一致。",
        verificationStatus: "unverified",
        artifactHash: undefined,
        trace: [...run.trace, { id: `candidate-zip-binding-${testCase.id}`, stage: "candidate-static-evidence", summary: "冻结代码包绑定失效", status: "warning" }],
      };
    }

    if (testCase.criterionIds.length > 0 && testCase.criterionIds.every((id) => id === "SYS-PAIRWISE")) {
      const scopedIds = new Set(mapped.flatMap((criterion) => criterion.artifactIds));
      const snapshots = candidate.artifactSnapshots.filter((snapshot) => !scopedIds.size || scopedIds.has(snapshot.sourceArtifactId));
      const query = `${project.evolutionCommand}\n${testCase.title}\n${testCase.input}\n${testCase.expected.join(" ")}`;
      const maxSideChars = 28_000;
      const pairs = snapshots.flatMap((snapshot) => {
        const source = sources.get(snapshot.sourceArtifactId);
        if (!source || !snapshot.content) return [];
        let structured = "";
        if (!source.textContent && source.structuredContent !== undefined) {
          try { structured = JSON.stringify(source.structuredContent); } catch { structured = ""; }
        }
        const originalFull = source.textContent || structured;
        const originalAvailable = originalFull || source.textExcerpt || "";
        if (!originalAvailable) return [];
        const originalComplete = Boolean(originalFull) && originalAvailable.length <= maxSideChars;
        const evolvedComplete = snapshot.content.length <= maxSideChars;
        const originalEvidence = originalAvailable.length <= maxSideChars
          ? originalAvailable
          : retrieveTextContext(originalAvailable, query, { maxChars: maxSideChars, maxChunks: 6 });
        const evolvedEvidence = snapshot.content.length <= maxSideChars
          ? snapshot.content
          : retrieveTextContext(snapshot.content, query, { maxChars: maxSideChars, maxChunks: 6 });
        return [{
          name: snapshot.name,
          sourceArtifactId: snapshot.sourceArtifactId,
          originalEvidence,
          evolvedEvidence,
          originalComplete,
          evolvedComplete,
          originalLength: originalAvailable.length,
          evolvedLength: snapshot.content.length,
        }];
      });
      if (pairs.length) {
        const complete = pairs.length === snapshots.length && pairs.every((pair) => pair.originalComplete && pair.evolvedComplete);
        return {
          ...run,
          output: [
            "ORIGINAL VS EVOLVED SNAPSHOT EVIDENCE",
            `验收目标：${testCase.title}`,
            `用户进化目标：${project.evolutionCommand}`,
            ...pairs.flatMap((pair) => [
              `--- ${pair.name} (${pair.sourceArtifactId}) ---`,
              `ORIGINAL (${pair.originalLength} chars${pair.originalComplete ? ", complete" : ", retrieved context"}):\n${pair.originalEvidence}`,
              `EVOLVED (${pair.evolvedLength} chars${pair.evolvedComplete ? ", complete" : ", retrieved context"}):\n${pair.evolvedEvidence}`,
            ]),
            "证据说明：以上只提供真实原版与当前 Candidate 的同题对照；是否达到“更好”仍由独立 Rubric evaluator 判定。",
          ].join("\n\n"),
          verificationStatus: complete ? "verified" : "partial",
          trace: [...run.trace, {
            id: `pairwise-snapshot-${testCase.id}`,
            stage: "pairwise-snapshot",
            summary: complete ? "已提供完整原版与 Candidate 双快照" : "已提供原版与 Candidate 对照上下文",
            status: complete ? "pass" : "warning",
            detail: pairs.map((pair) => `${pair.name}: ${pair.originalLength}→${pair.evolvedLength}`).join("；"),
          }],
        };
      }
    }

    if (testCase.executionMode === "roundtrip" && mapped.every((criterion) => criterion.validationMethod === "format-roundtrip")) {
      const scopedIds = new Set(mapped.flatMap((criterion) => criterion.artifactIds));
      const snapshots = candidate.artifactSnapshots.filter((snapshot) => !scopedIds.size || scopedIds.has(snapshot.sourceArtifactId));
      const details: string[] = [];
      const verified = snapshots.length > 0 && snapshots.every((snapshot) => {
        const source = sources.get(snapshot.sourceArtifactId);
        const extension = (source?.extension || snapshot.name.split(".").pop() || "").toLowerCase();
        if (!LOCALLY_ROUNDTRIPPABLE_TEXT.test(extension)) return false;
        try {
          const bytes = new TextEncoder().encode(snapshot.content);
          const restored = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          const preserved = restored === snapshot.content;
          details.push(`${snapshot.name}: .${extension} / ${bytes.length} bytes / preserved=${preserved}`);
          return preserved;
        } catch {
          return false;
        }
      });
      if (verified) return {
        ...run,
        output: `CANDIDATE TEXT FORMAT ROUNDTRIP VERIFIED\n${details.join("\n")}\n验证对象为当前 Candidate Artifact Snapshot；已执行真实 UTF-8 编码→解码并逐字比较。`,
        verificationStatus: "verified",
        trace: [...run.trace, {
          id: `candidate-text-roundtrip-${testCase.id}`,
          stage: "format-roundtrip",
          summary: "当前候选文本原格式往返一致",
          status: "pass",
          detail: details.join("；"),
        }],
      };
    }

    if (
      (testCase.executionMode === "artifact-runtime" || testCase.executionMode === "static-evidence")
      && mapped.every((criterion) => criterion.validationMethod === "semantic-judge" || criterionCanUseLocalSnapshotEvidence(project, criterion))
      && candidate.artifactSnapshots.length > 0
    ) {
      const scopedIds = new Set(mapped.flatMap((criterion) => criterion.artifactIds));
      const snapshots = candidate.artifactSnapshots.filter((snapshot) => !scopedIds.size || scopedIds.has(snapshot.sourceArtifactId));
      const query = `${project.evolutionCommand}\n${testCase.title}\n${testCase.input}\n${testCase.expected.join(" ")}`;
      const maxSideChars = 28_000;
      const evidence = snapshots.filter((snapshot) => snapshot.content.length > 0).flatMap((snapshot) => {
        const source = sources.get(snapshot.sourceArtifactId);
        const docx = source?.extension.toLowerCase() === "docx"
          && (!source.artifactDescriptor || source.artifactDescriptor.adapterId === "document-docx-ooxml");
        const html = source && /^(html|htm)$/i.test(source.extension);
        const reviewable = docx
          ? docxCandidateText(source, snapshot.content)
          : html ? htmlCandidateText(snapshot.content)
          : testCase.executionMode === "static-evidence" ? staticSnapshotText(snapshot.content) : snapshot.content;
        if (!reviewable) return [];
        const overlay = source?.artifactKind === "codebase" && isCodebaseOverlay(snapshot.content);
        return [{
          name: snapshot.name,
          sourceArtifactId: snapshot.sourceArtifactId,
          length: reviewable.length,
          complete: reviewable.length <= maxSideChars && !overlay,
          overlay,
          content: reviewable.length <= maxSideChars
            ? reviewable
            : retrieveTextContext(reviewable, query, { maxChars: maxSideChars, maxChunks: 6 }),
        }];
      });
      if (evidence.length) {
        // A retrieved excerpt is useful context, but it cannot prove the complete Candidate.
        const complete = evidence.length === snapshots.length && evidence.every((item) => item.complete);
        return {
          ...run,
          output: [
            testCase.executionMode === "static-evidence"
              ? "CURRENT CANDIDATE STATIC SNAPSHOT EVIDENCE"
              : "CURRENT CANDIDATE SNAPSHOT EVIDENCE",
            `验收目标：${testCase.title}`,

            ...evidence.flatMap((item) => [
              `--- ${item.name} (${item.sourceArtifactId}) · ${item.length} chars${item.overlay ? ", overlay only" : item.complete ? ", complete" : ", retrieved context"} ---`,
              item.content,
            ]),
            "证据说明：以上内容直接来自当前 Candidate Artifact Snapshot；代码库 overlay 只包含候选修改，不能代替完整包验证。Runtime 只提供当前成果证据，是否满足验收要求仍由独立 Rubric evaluator 判定。",
          ].join("\n\n"),
          verificationStatus: complete ? "verified" : "partial",
          trace: [...run.trace, {
            id: `${testCase.executionMode === "static-evidence" ? "candidate-static" : "candidate-semantic"}-snapshot-${testCase.id}`,
            stage: testCase.executionMode === "static-evidence" ? "candidate-static-evidence" : "semantic-evidence",
            summary: testCase.executionMode === "static-evidence"
              ? "已绑定当前 Candidate 的静态文件证据"
              : complete ? "已提供当前 Candidate 可审阅内容" : "已提供当前 Candidate 相关内容上下文",
            status: complete ? "pass" : "warning",
            detail: evidence.map((item) => `${item.name}:${item.length}`).join("；"),
          }],
        };
      }
    }

    return run;
  });
}
