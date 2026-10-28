import {withServerAiConnection} from "./server-ai-connection";
import {executeServerArtifactExternal} from "./server-artifact-external";
import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import {HTML_BUILD_BODY_CONTEXT_VERSION} from "@evolution/contracts";

import { runServerExperiment, SERVER_SEMANTIC_CONTEXT_VERSION, SERVER_MEASURED_REVIEW_VERSION } from "@evolution/harness";
import { runServerAi, serverAiScoringRouteFingerprint } from "./ai-gateway";
import {runServerEvidenceJudge} from "./server-evidence-judge";
import {HTML_PRESERVATION_EXECUTION_VERSION} from "./server-html-preservation-observation";
import {executeServerHtmlNativeBatch} from "./server-html-native-execution";
import {HTML_NATIVE_KERNEL_SHA256} from "@evolution/adapters/sandbox";
import {EXPERIMENT_EVIDENCE_ADMISSION_VERSION,HTML_NATIVE_EVIDENCE_POLICY_VERSION} from "@evolution/core";
import { readServerHoldoutArtifactFingerprint as readExecutionArtifactFingerprint } from "./server-holdout-artifact-binding";

import { runServerFrozenArtifactStaticEvidence } from "./server-static-artifact-evidence";
import {verifyServerCandidateNativeFormats} from "./server-candidate-native-roundtrip";

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

async function executeServerCandidateExternal(project:EvolveProject,candidate:Candidate,testCases:TestCase[]):Promise<TargetRunResult[]>{
  if(serverConnectorTargetEnabled(project))return runServerConnectorTargetBatch(project,testCases,candidate);
  if(serverHttpTargetEnabled(project))return runServerHttpTargetBatch(project,testCases,candidate);
  return executeServerArtifactExternal(project,testCases,"experiment",candidate);
}

/** Production composition root for the server-native Candidate Experiment. */
export async function runServerMissionExperiment(project: EvolveProject) {
  return withServerAiConnection(async()=>{
  return runServerExperiment(project, {
    executeNativeHtmlBatch:executeServerHtmlNativeBatch,
    fingerprint: (wire) => serverArtifactSha256(new TextEncoder().encode(wire)),
    readExecutionArtifactFingerprint,
    scoringRouteFingerprint: await serverAiScoringRouteFingerprint(),
    executionRuntimeFingerprint: JSON.stringify([process.env.VERCEL_GIT_COMMIT_SHA ?? "local", SERVER_SEMANTIC_CONTEXT_VERSION, SERVER_MEASURED_REVIEW_VERSION, HTML_PRESERVATION_EXECUTION_VERSION,HTML_NATIVE_KERNEL_SHA256,HTML_NATIVE_EVIDENCE_POLICY_VERSION,HTML_BUILD_BODY_CONTEXT_VERSION,EXPERIMENT_EVIDENCE_ADMISSION_VERSION]),
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
      evidenceInstruction: `Inspect Candidate ${candidate.id} exact artifact snapshots only. Missing runtime evidence must be UNVERIFIED. Never use plan/designRationale as observed proof.`,
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
    verifyFrozenArtifact: verifyServerCandidateFrozenArtifact,
    verifyNativeFormat:verifyServerCandidateNativeFormats,
    executeFrozenStatic: runServerFrozenArtifactStaticEvidence,
    executeExternalBatch: ({ project: current, candidate, testCases }) => executeServerCandidateExternal(current, candidate, testCases),
    judge: (payload) => runServerEvidenceJudge(payload),
  });
  });
}
