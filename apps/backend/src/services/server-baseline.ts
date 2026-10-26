import {withServerAiConnection} from "./server-ai-connection";
import {executeServerArtifactExternal,resolveServerZipTargetBinding} from "./server-artifact-external";
import {isZipArtifact} from "@evolution/core";
import type { EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";

import { canReuseServerBaseline, runServerBaseline } from "@evolution/harness";
import {HTML_NATIVE_KERNEL_SHA256} from "@evolution/adapters/sandbox";
import { runServerAi, serverAiScoringRouteFingerprint } from "./ai-gateway";
import {runServerEvidenceJudge} from "./server-evidence-judge";


import { runServerCurrentStoredEvidence } from "./server-current-stored-evidence";
import { buildServerCurrentSemanticArtifactContext } from "./server-current-semantic-context";

import { runServerHttpTargetBatch, serverHttpTargetEnabled } from "./server-http-target-execution";
import {runServerConnectorTargetBatch} from "./server-connector-target-execution";
import {serverConnectorTargetEnabled} from "./connector-target-source";
import {executeServerHtmlNativeBatch} from "./server-html-native-execution";

/** Native text from an older, unverified wire must not be reused as the Original comparison. */
export function canReuseServerMissionBaseline(project:EvolveProject,routeFingerprint?:string){
  return project.baselineRun.runs.every(run=>!run.nativeHtmlProof||run.nativeHtmlProof.observation.kernelSha256===HTML_NATIVE_KERNEL_SHA256)
    &&canReuseServerBaseline(project,routeFingerprint);
}

export function resolveServerBaselineCodebaseBinding(project:EvolveProject){
  const sources=project.sourceArtifacts.filter(source=>source.role==="target"&&isZipArtifact(source));
  if(sources.length!==1)return{source:undefined,blobId:undefined,candidateId:undefined,reason:"当前 Mission 没有唯一的 codebase/package ZIP Target。"};
  return resolveServerZipTargetBinding(project,sources[0]!);
}

export async function executeServerBaselineExternal(current:EvolveProject,testCases:TestCase[]):Promise<TargetRunResult[]>{
  if(serverConnectorTargetEnabled(current))return runServerConnectorTargetBatch(current,testCases);
  if(serverHttpTargetEnabled(current))return runServerHttpTargetBatch(current,testCases);
  return executeServerArtifactExternal(current,testCases,"baseline");
}

/** Composition root: wires Harness Baseline ports to production Server AI + Artifact Store + Vercel Sandbox. */
export async function runServerMissionBaseline(project: EvolveProject) {
  return withServerAiConnection(async()=>{
  return runServerBaseline(project, {
    executeNativeHtmlBatch:executeServerHtmlNativeBatch,
    scoringRouteFingerprint: await serverAiScoringRouteFingerprint(),
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
    judge: (payload) => runServerEvidenceJudge(payload),
  });
  });
}
