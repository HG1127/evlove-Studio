import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { criterionCanUseLocalSnapshotEvidence } from "@evolution/core";
import { retrieveTextContext } from "./context-retrieval";

const LOCALLY_ROUNDTRIPPABLE_TEXT = /^(txt|md|markdown|csv|json|yaml|yml|css|js|jsx|ts|tsx)$/i;

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
      testCase.executionMode === "artifact-runtime"
      && mapped.every((criterion) => criterion.validationMethod === "semantic-judge" || criterionCanUseLocalSnapshotEvidence(project, criterion))
      && candidate.artifactSnapshots.length > 0
    ) {
      const scopedIds = new Set(mapped.flatMap((criterion) => criterion.artifactIds));
      const snapshots = candidate.artifactSnapshots.filter((snapshot) => !scopedIds.size || scopedIds.has(snapshot.sourceArtifactId));
      const query = `${project.evolutionCommand}\n${testCase.title}\n${testCase.input}\n${testCase.expected.join(" ")}`;
      const maxSideChars = 28_000;
      const evidence = snapshots.filter((snapshot) => snapshot.content.length > 0).map((snapshot) => ({
        name: snapshot.name,
        sourceArtifactId: snapshot.sourceArtifactId,
        length: snapshot.content.length,
        complete: snapshot.content.length <= maxSideChars,
        content: snapshot.content.length <= maxSideChars
          ? snapshot.content
          : retrieveTextContext(snapshot.content, query, { maxChars: maxSideChars, maxChunks: 6 }),
      }));
      if (evidence.length) {
        const complete = evidence.length === snapshots.length && evidence.every((item) => item.complete);
        return {
          ...run,
          output: [
            "CURRENT CANDIDATE SNAPSHOT EVIDENCE",
            `验收目标：${testCase.title}`,
            ...evidence.flatMap((item) => [
              `--- ${item.name} (${item.sourceArtifactId}) · ${item.length} chars${item.complete ? ", complete" : ", retrieved context"} ---`,
              item.content,
            ]),
            "证据说明：以上内容直接来自当前 Candidate Artifact Snapshot；Runtime 只提供当前成果证据，是否满足验收要求仍由独立 Rubric evaluator 判定。",
          ].join("\n\n"),
          verificationStatus: complete ? "verified" : "partial",
          trace: [...run.trace, {
            id: `candidate-semantic-snapshot-${testCase.id}`,
            stage: "semantic-evidence",
            summary: complete ? "已提供当前 Candidate 完整快照" : "已提供当前 Candidate 相关内容上下文",
            status: complete ? "pass" : "warning",
            detail: evidence.map((item) => `${item.name}:${item.length}`).join("；"),
          }],
        };
      }
    }

    return run;
  });
}
