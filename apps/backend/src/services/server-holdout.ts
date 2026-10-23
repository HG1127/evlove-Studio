import {withServerAiConnection} from "./server-ai-connection";
import {executeServerArtifactExternal} from "./server-artifact-external";
import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";

import { runServerHoldout } from "@evolution/harness";
import { runServerAi, serverAiScoringRouteFingerprint } from "./ai-gateway";
import {runServerEvidenceJudge} from "./server-evidence-judge";
import {HTML_PRESERVATION_EXECUTION_VERSION} from "./server-html-preservation-observation";

import { runServerFrozenArtifactStaticEvidence } from "./server-static-artifact-evidence";
import {verifyServerCandidateNativeFormats} from "./server-candidate-native-roundtrip";

import { runServerCurrentStoredEvidence } from "./server-current-stored-evidence";
import { buildServerCurrentSemanticArtifactContext } from "./server-current-semantic-context";
import { runServerHttpTargetBatch, serverHttpTargetEnabled } from "./server-http-target-execution";
import {runServerConnectorTargetBatch} from "./server-connector-target-execution";
import {serverConnectorTargetEnabled} from "./connector-target-source";

import { verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";
import { readServerHoldoutArtifactFingerprint } from "./server-holdout-artifact-binding";

async function executeCurrentExternal(project:EvolveProject,testCases:TestCase[]):Promise<TargetRunResult[]>{
  if(serverConnectorTargetEnabled(project))return runServerConnectorTargetBatch(project,testCases);
  if(serverHttpTargetEnabled(project))return runServerHttpTargetBatch(project,testCases);
  return executeServerArtifactExternal(project,testCases,"holdout-baseline");
}
async function executeCandidateExternal(project:EvolveProject,candidate:Candidate,testCases:TestCase[]):Promise<TargetRunResult[]>{
  if(serverConnectorTargetEnabled(project))return runServerConnectorTargetBatch(project,testCases,candidate);
  if(serverHttpTargetEnabled(project))return runServerHttpTargetBatch(project,testCases,candidate);
  return executeServerArtifactExternal(project,testCases,"holdout",candidate);
}

export async function runServerMissionHoldout(project:EvolveProject){
  return withServerAiConnection(async()=>{
  return runServerHoldout(project,{
    scoringRouteFingerprint:await serverAiScoringRouteFingerprint(),
    executionRuntimeFingerprint:HTML_PRESERVATION_EXECUTION_VERSION,
    readArtifactFingerprint:readServerHoldoutArtifactFingerprint,
    current:{
      executeSemanticBatch:({project:current,testCases,artifactContext})=>runServerAi("execute-artifact-batch",{
        project:{name:current.name,objectType:current.objectType,goal:current.goal,evolutionCommand:current.evolutionCommand,protectedItems:current.protectedItems,editableItems:current.editableItems,sourceArtifacts:artifactContext},
        testCases:testCases.map((testCase)=>({id:testCase.id,title:testCase.title,input:testCase.input,expected:testCase.expected,criterionIds:testCase.criterionIds,evidenceScope:testCase.evidenceScope})),
        evidenceInstruction:"Inspect only the CURRENT VERSION on this frozen hidden paper. Missing runtime evidence must be UNVERIFIED. Never infer Candidate behavior.",
        variant:null,
      }),
      executeStoredEvidence:runServerCurrentStoredEvidence,
      buildCurrentArtifactContext:buildServerCurrentSemanticArtifactContext,
      executeExternalBatch:({project:current,testCases})=>executeCurrentExternal(current,testCases),
      judge:(payload)=>runServerEvidenceJudge(payload),
    },
    candidate:{
      executeSemanticBatch:({project:current,candidate,testCases,artifactContext})=>runServerAi("execute-artifact-batch",{
        project:{name:current.name,objectType:current.objectType,goal:current.goal,evolutionCommand:current.evolutionCommand,protectedItems:current.protectedItems,editableItems:current.editableItems,sourceArtifacts:artifactContext},
        testCases:testCases.map((testCase)=>({id:testCase.id,title:testCase.title,input:testCase.input,expected:testCase.expected,criterionIds:testCase.criterionIds,evidenceScope:testCase.evidenceScope})),
        evidenceInstruction:`Inspect only exact frozen Candidate ${candidate.id} on this hidden paper. Missing runtime evidence must be UNVERIFIED. Never use plan/designRationale as observed proof.`,
        variant:{id:candidate.id,artifactSnapshots:candidate.artifactSnapshots.map((snapshot)=>({id:snapshot.id,sourceArtifactId:snapshot.sourceArtifactId,name:snapshot.name,mimeType:snapshot.mimeType,contentHash:snapshot.contentHash,buildMode:snapshot.buildMode}))},
      }),
      verifyFrozenArtifact:verifyServerCandidateFrozenArtifact,
      verifyNativeFormat:verifyServerCandidateNativeFormats,
      executeFrozenStatic:runServerFrozenArtifactStaticEvidence,
      executeExternalBatch:({project:current,candidate,testCases})=>executeCandidateExternal(current,candidate,testCases),
      judge:(payload)=>runServerEvidenceJudge(payload),
    },
    releaseReview:(payload)=>runServerAi("release-review",payload),
  });
  });
}
