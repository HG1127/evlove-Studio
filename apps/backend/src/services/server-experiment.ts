import {withServerAiConnection} from "./server-ai-connection";
import {runServerHtmlArtifactBatch,serverHtmlArtifactTargetEnabled} from "./server-html-artifact-execution";
import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { runVercelSandboxCodebaseValidation } from "@evolution/adapters/sandbox";
import { runServerExperiment, SERVER_SEMANTIC_CONTEXT_VERSION } from "@evolution/harness";
import { runServerAi, serverAiScoringRouteFingerprint } from "./ai-gateway";
import { readServerHoldoutArtifactFingerprint as readExecutionArtifactFingerprint } from "./server-holdout-artifact-binding";
import { getServerArtifactStore } from "./artifact-runtime";
import { runServerFrozenArtifactStaticEvidence } from "./server-static-artifact-evidence";
import { attachServerVisualEvidence } from "./server-visual-evidence";
import { runServerHttpTargetBatch, serverHttpTargetEnabled } from "./server-http-target-execution";
import {runServerConnectorTargetBatch,stageServerConnectorCandidate} from "./server-connector-target-execution";
import {serverConnectorTargetEnabled} from "./connector-target-source";
import {
  buildServerExperimentCandidate,
  serverArtifactSha256,
  verifyServerCandidateFrozenArtifact,
} from "./server-experiment-artifacts";

export {
  applyServerCodebaseOverlay,
  composeServerCodebaseOverlay,
  resolveServerExperimentParentBinding,
} from "./server-experiment-artifacts";

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

function unavailableExternal(testCase: TestCase, detail: string): TargetRunResult {
  return {
    testCaseId: testCase.id,
    output: `UNVERIFIED：${detail}`,
    latencyMs: 0,
    cost: 0,
    verificationStatus: "unverified",
    trace: [{
      id: `server-candidate-external-${testCase.id}`,
      stage: "external-runner",
      summary: "Candidate External Runner 未完成",
      status: "warning",
      detail,
    }],
  };
}

async function executeServerCandidateExternal(project: EvolveProject, candidate: Candidate, testCases: TestCase[]) {
  if(serverConnectorTargetEnabled(project))return runServerConnectorTargetBatch(project,testCases,candidate);
  if(serverHtmlArtifactTargetEnabled(project))return runServerHtmlArtifactBatch(project,testCases,candidate);
  if (serverHttpTargetEnabled(project)) return runServerHttpTargetBatch(project, testCases, candidate);
  const source = codebaseTarget(project);
  if (!source) return testCases.map((testCase) => unavailableExternal(testCase, "当前 Server External Runner 仅支持 codebase/package ZIP Target。"));
  const snapshots = candidate.artifactSnapshots.filter((item) => item.sourceArtifactId === source.id);
  if (snapshots.length !== 1) return testCases.map((testCase) => unavailableExternal(testCase, "Candidate codebase Target 缺少唯一 Artifact Snapshot。"));
  const snapshot = snapshots[0]!;
  if (!snapshot?.frozenArtifact) return testCases.map((testCase) => unavailableExternal(testCase, "Candidate codebase 尚未冻结实际 ZIP。"));
  try {
    const blob = await getServerArtifactStore().get(snapshot.frozenArtifact.blobId);
    if (!blob) return testCases.map((testCase) => unavailableExternal(testCase, `找不到 Candidate Blob ${snapshot.frozenArtifact!.blobId}。`));
    const archive = await blob.arrayBuffer();
    if (archive.byteLength !== snapshot.frozenArtifact.size) {
      return testCases.map((testCase) => unavailableExternal(testCase, "Candidate ZIP 大小与冻结凭证不一致。"));
    }
    if (await serverArtifactSha256(archive) !== snapshot.frozenArtifact.sha256) {
      return testCases.map((testCase) => unavailableExternal(testCase, "Candidate ZIP SHA-256 与冻结凭证不一致。"));
    }
    const result = await runVercelSandboxCodebaseValidation({
      id: `${project.id}-experiment-${candidate.id}`,
      archive: new Uint8Array(archive),
      expectedSha256: snapshot.frozenArtifact.sha256,
      testCases,
    });
    return attachServerVisualEvidence(project, testCases, result.results);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return testCases.map((testCase) => unavailableExternal(testCase, `Vercel Sandbox 未完成：${message}`));
  }
}

/** Production composition root for the server-native Candidate Experiment. */
export async function runServerMissionExperiment(project: EvolveProject) {
  return withServerAiConnection(async()=>{
  return runServerExperiment(project, {
    fingerprint: (wire) => serverArtifactSha256(new TextEncoder().encode(wire)),
    readExecutionArtifactFingerprint,
    scoringRouteFingerprint: await serverAiScoringRouteFingerprint(),
    executionRuntimeFingerprint: JSON.stringify([process.env.VERCEL_GIT_COMMIT_SHA ?? "local", SERVER_SEMANTIC_CONTEXT_VERSION]),
    buildCandidate: async({ project: current, candidate }) => {
      const built=await buildServerExperimentCandidate(current,candidate);
      return serverConnectorTargetEnabled(current)
        ?stageServerConnectorCandidate(current,built)
        :built;
    },
    executeSemanticBatch: ({ project: current, candidate, testCases, artifactContext }) => runServerAi("execute-artifact-batch", {
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
      evidenceInstruction: `Inspect Candidate ${candidate.id} exact artifact snapshots only. Absent requirements in complete readable document content are observed product deficiencies. Use UNVERIFIED only for unavailable relevant content or runtime evidence. Never use plan/designRationale as observed proof.`,
      variant: {
        id: candidate.id,
        artifactSnapshots: candidate.artifactSnapshots.map((snapshot) => ({
          id: snapshot.id,
          sourceArtifactId: snapshot.sourceArtifactId,
          name: snapshot.name,
          mimeType: snapshot.mimeType,
          contentHash: snapshot.contentHash,
          buildMode: snapshot.buildMode,
        })),
      },
    }),
    verifyFrozenArtifact: (snapshot) => {
      const source=project.sourceArtifacts.find((item)=>item.id===snapshot.sourceArtifactId);
      return source?verifyServerCandidateFrozenArtifact(snapshot,source):Promise.resolve(false);
    },
    executeFrozenStatic: runServerFrozenArtifactStaticEvidence,
    executeExternalBatch: ({ project: current, candidate, testCases }) => executeServerCandidateExternal(current, candidate, testCases),
    judge: (payload) => runServerAi("evaluate", payload),
  });
  });
}
