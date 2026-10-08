import {runServerHtmlArtifactBatch,serverHtmlArtifactTargetEnabled} from "./server-html-artifact-execution";
import type { EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { runVercelSandboxCodebaseValidation } from "@evolution/adapters/sandbox";
import { runServerBaseline, trustedServerBaselineChampion } from "@evolution/harness";
import { runServerAi, serverAiScoringRouteFingerprint } from "./ai-gateway";
import { getServerArtifactStore } from "./artifact-runtime";
import { attachServerVisualEvidence } from "./server-visual-evidence";
import { runServerCurrentStoredEvidence } from "./server-current-stored-evidence";
import { buildServerCurrentSemanticArtifactContext } from "./server-current-semantic-context";
import { serverArtifactSha256 } from "./server-experiment-artifacts";
import { runServerHttpTargetBatch, serverHttpTargetEnabled } from "./server-http-target-execution";
import {runServerConnectorTargetBatch} from "./server-connector-target-execution";
import {serverConnectorTargetEnabled} from "./connector-target-source";

function codebaseTarget(project: EvolveProject) {
  return project.sourceArtifacts.find((artifact) =>
    artifact.role === "target"
    && (
      artifact.artifactKind === "codebase"
      || artifact.extension.toLowerCase() === "zip"
      || artifact.artifactDescriptor?.family === "codebase"
      || artifact.artifactDescriptor?.family === "package"
    ));
}

export function resolveServerBaselineCodebaseBinding(project: EvolveProject) {
  const source = codebaseTarget(project);
  if (!source) return { source: undefined, blobId: undefined, candidateId: undefined, reason: "当前 Mission 没有 codebase/package Target。" };
  const champion = trustedServerBaselineChampion(project);
  const snapshots = champion?.artifactSnapshots.filter((item) => item.sourceArtifactId === source.id) ?? [];
  const snapshot = snapshots[0];
  if (project.searchChampion && snapshots.length !== 1) {
    return {
      source,
      blobId: undefined,
      candidateId: champion?.id,
      reason: "当前 Search Champion 缺少唯一可信的 codebase Target Artifact Snapshot，不能回退原 Source ZIP 代替执行。",
    };
  }
  if (snapshot && !snapshot.frozenArtifact) {
    return {
      source,
      blobId: undefined,
      candidateId: champion?.id,
      reason: `当前 Search Champion ${project.searchChampion?.versionLabel ?? champion?.id} 的代码成果尚未冻结为实际 ZIP，不能回退原 Source ZIP 代替执行。`,
    };
  }
  return {
    source,
    blobId: snapshot?.frozenArtifact?.blobId ?? (source.storageRef?.trim() || source.id),
    candidateId: snapshot ? champion?.id : undefined,
    sha256: snapshot?.frozenArtifact?.sha256,
    size: snapshot?.frozenArtifact?.size,
    reason: undefined,
  };
}

function unavailableExternal(testCase: TestCase, detail: string): TargetRunResult {
  return {
    testCaseId: testCase.id,
    output: `UNVERIFIED：${detail}`,
    latencyMs: 0,
    cost: 0,
    verificationStatus: "unverified",
    trace: [{
      id: `server-external-unavailable-${testCase.id}`,
      stage: "external-runner",
      summary: "Server External Runner 未完成",
      status: "warning",
      detail,
    }],
  };
}

export async function executeServerBaselineExternal(current:EvolveProject,testCases:TestCase[]){
  if(serverConnectorTargetEnabled(current))return runServerConnectorTargetBatch(current,testCases);
  if (serverHttpTargetEnabled(current)) return runServerHttpTargetBatch(current, testCases);
  if(serverHtmlArtifactTargetEnabled(current))return runServerHtmlArtifactBatch(current,testCases);
  const binding = resolveServerBaselineCodebaseBinding(current);
  if (!binding.source || !binding.blobId) {
    return testCases.map((testCase) => unavailableExternal(
      testCase,
      binding.reason ?? "当前 Server Baseline 没有可用的 HTTP Target 或冻结源码包/codebase。",
    ));
  }
  try {
    const blob = await getServerArtifactStore().get(binding.blobId);
    if (!blob) {
      return testCases.map((testCase) => unavailableExternal(
        testCase,
        `找不到当前 Baseline Artifact Blob ${binding.blobId}，不能回退其他版本冒充真实代码执行。`,
      ));
    }
    const archive = await blob.arrayBuffer();
    if (binding.size !== undefined && archive.byteLength !== binding.size) {
      return testCases.map((testCase) => unavailableExternal(
        testCase,
        `当前 Baseline ZIP 大小与冻结凭证不一致：${archive.byteLength} != ${binding.size}。`,
      ));
    }
    if (binding.sha256 && await serverArtifactSha256(archive) !== binding.sha256) {
      return testCases.map((testCase) => unavailableExternal(
        testCase,
        "当前 Baseline ZIP SHA-256 与冻结凭证不一致。",
      ));
    }
    const response = await runVercelSandboxCodebaseValidation({
      id: `${current.id}-baseline-${binding.candidateId ?? "source"}`,
      archive: new Uint8Array(archive),
      expectedSha256: binding.sha256,
      testCases,
    });
    return attachServerVisualEvidence(current, testCases, response.results);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return testCases.map((testCase) => unavailableExternal(
      testCase,
      `Vercel Sandbox 未完成：${message}`,
    ));
  }
}

/** Composition root: wires Harness Baseline ports to production Server AI + Artifact Store + Vercel Sandbox. */
export async function runServerMissionBaseline(project: EvolveProject) {
  return runServerBaseline(project, {
    scoringRouteFingerprint: serverAiScoringRouteFingerprint(),
    executeSemanticBatch: async ({ project: current, testCases, artifactContext }) => runServerAi("execute-artifact-batch", {
      project: {
        name: current.name,
        objectType: current.objectType,
        goal: current.goal,
        evolutionCommand: current.evolutionCommand,
        protectedItems: current.protectedItems,
        editableItems: current.editableItems,
        sourceArtifacts: artifactContext,
      },
      testCases: testCases.map((testCase) => ({
        id: testCase.id,
        title: testCase.title,
        input: testCase.input,
        expected: testCase.expected,
        criterionIds: testCase.criterionIds,
        evidenceScope: testCase.evidenceScope,
      })),
      evidenceInstruction: "Inspect the current Baseline artifact only. Missing evidence must be reported as UNVERIFIED; never infer future Candidate behavior.",
      variant: null,
    }),
    executeStoredEvidence: runServerCurrentStoredEvidence,
    buildCurrentArtifactContext: buildServerCurrentSemanticArtifactContext,
    executeExternalBatch: ({ project: current, testCases }) => executeServerBaselineExternal(current,testCases),
    judge: (payload) => runServerAi("evaluate", payload),
  });
}
