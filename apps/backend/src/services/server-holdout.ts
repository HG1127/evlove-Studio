import {runServerHtmlArtifactBatch,serverHtmlArtifactTargetEnabled} from "./server-html-artifact-execution";
import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { runVercelSandboxCodebaseValidation } from "@evolution/adapters/sandbox";
import { runServerHoldout } from "@evolution/harness";
import { runServerAi, serverAiScoringRouteFingerprint } from "./ai-gateway";
import { getServerArtifactStore } from "./artifact-runtime";
import { runServerFrozenArtifactStaticEvidence } from "./server-static-artifact-evidence";
import { attachServerVisualEvidence } from "./server-visual-evidence";
import { runServerCurrentStoredEvidence } from "./server-current-stored-evidence";
import { buildServerCurrentSemanticArtifactContext } from "./server-current-semantic-context";
import { runServerHttpTargetBatch, serverHttpTargetEnabled } from "./server-http-target-execution";
import {runServerConnectorTargetBatch} from "./server-connector-target-execution";
import {serverConnectorTargetEnabled} from "./connector-target-source";
import { resolveServerBaselineCodebaseBinding } from "./server-baseline";
import { serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";
import { readServerHoldoutArtifactFingerprint } from "./server-holdout-artifact-binding";

function unavailable(testCase:TestCase,detail:string):TargetRunResult{
  return {
    testCaseId:testCase.id,output:`UNVERIFIED：${detail}`,latencyMs:0,cost:0,verificationStatus:"unverified",
    trace:[{id:`server-holdout-unavailable-${testCase.id}`,stage:testCase.executionMode,summary:"Hidden Holdout 缺少真实执行能力",status:"warning",detail}],
  };
}

function codebaseTarget(project:EvolveProject){
  return project.sourceArtifacts.find((artifact)=>artifact.role==="target"&&(
    artifact.artifactKind==="codebase"
    ||artifact.extension.toLowerCase()==="zip"
    ||artifact.artifactDescriptor?.family==="codebase"
    ||artifact.artifactDescriptor?.family==="package"
  ));
}

async function executeCurrentExternal(project:EvolveProject,testCases:TestCase[]){
  if(serverConnectorTargetEnabled(project))return runServerConnectorTargetBatch(project,testCases);
  if(serverHttpTargetEnabled(project))return runServerHttpTargetBatch(project,testCases);
  if(serverHtmlArtifactTargetEnabled(project))return runServerHtmlArtifactBatch(project,testCases);
  const binding=resolveServerBaselineCodebaseBinding(project);
  if(!binding.source||!binding.blobId)return testCases.map((testCase)=>unavailable(testCase,binding.reason??"当前版本 External Runner 尚未连接。"));
  try{
    const blob=await getServerArtifactStore().get(binding.blobId);
    if(!blob)return testCases.map((testCase)=>unavailable(testCase,`找不到当前版本 Artifact Blob ${binding.blobId}。`));
    const archive=await blob.arrayBuffer();
    if(binding.size!==undefined&&archive.byteLength!==binding.size){
      return testCases.map((testCase)=>unavailable(testCase,"当前版本 ZIP 大小与冻结凭证不一致。"));
    }
    if(binding.sha256&&await serverArtifactSha256(archive)!==binding.sha256){
      return testCases.map((testCase)=>unavailable(testCase,"当前版本 ZIP SHA-256 与冻结凭证不一致。"));
    }
    const response=await runVercelSandboxCodebaseValidation({
      id:`${project.id}-holdout-baseline-${binding.candidateId??"source"}`,
      archive:new Uint8Array(archive),
      expectedSha256:binding.sha256,
      testCases,
    });
    return attachServerVisualEvidence(project,testCases,response.results);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return testCases.map((testCase)=>unavailable(testCase,`Vercel Sandbox 未完成：${message}`));
  }
}

async function executeCandidateExternal(project:EvolveProject,candidate:Candidate,testCases:TestCase[]){
  if(serverConnectorTargetEnabled(project))return runServerConnectorTargetBatch(project,testCases,candidate);
  if(serverHttpTargetEnabled(project))return runServerHttpTargetBatch(project,testCases,candidate);
  if(serverHtmlArtifactTargetEnabled(project))return runServerHtmlArtifactBatch(project,testCases,candidate);
  const source=codebaseTarget(project);
  if(!source)return testCases.map((testCase)=>unavailable(testCase,"Candidate External Runner 当前仅支持 codebase/package ZIP Target。"));
  const snapshots=candidate.artifactSnapshots.filter((item)=>item.sourceArtifactId===source.id);
  if(snapshots.length!==1)return testCases.map((testCase)=>unavailable(testCase,"Candidate codebase Target 缺少唯一 Artifact Snapshot。"));
  const snapshot=snapshots[0]!;
  if(!snapshot?.frozenArtifact)return testCases.map((testCase)=>unavailable(testCase,"Candidate 没有 frozen codebase ZIP。"));
  try{
    const blob=await getServerArtifactStore().get(snapshot.frozenArtifact.blobId);
    if(!blob)return testCases.map((testCase)=>unavailable(testCase,`找不到 Candidate Blob ${snapshot.frozenArtifact!.blobId}。`));
    const archive=await blob.arrayBuffer();
    if(archive.byteLength!==snapshot.frozenArtifact.size){
      return testCases.map((testCase)=>unavailable(testCase,"Candidate ZIP 大小与冻结凭证不一致。"));
    }
    if(await serverArtifactSha256(archive)!==snapshot.frozenArtifact.sha256){
      return testCases.map((testCase)=>unavailable(testCase,"Candidate ZIP SHA-256 与冻结凭证不一致。"));
    }
    const response=await runVercelSandboxCodebaseValidation({
      id:`${project.id}-holdout-${candidate.id}`,
      archive:new Uint8Array(archive),
      expectedSha256:snapshot.frozenArtifact.sha256,
      testCases,
    });
    return attachServerVisualEvidence(project,testCases,response.results);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return testCases.map((testCase)=>unavailable(testCase,`Vercel Sandbox 未完成：${message}`));
  }
}

export async function runServerMissionHoldout(project:EvolveProject){
  return runServerHoldout(project,{
    scoringRouteFingerprint:serverAiScoringRouteFingerprint(),
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
      judge:(payload)=>runServerAi("evaluate",payload),
    },
    candidate:{
      executeSemanticBatch:({project:current,candidate,testCases,artifactContext})=>runServerAi("execute-artifact-batch",{
        project:{name:current.name,objectType:current.objectType,goal:current.goal,evolutionCommand:current.evolutionCommand,protectedItems:current.protectedItems,editableItems:current.editableItems,sourceArtifacts:artifactContext},
        testCases:testCases.map((testCase)=>({id:testCase.id,title:testCase.title,input:testCase.input,expected:testCase.expected,criterionIds:testCase.criterionIds,evidenceScope:testCase.evidenceScope})),
        evidenceInstruction:`Inspect only exact frozen Candidate ${candidate.id} on this hidden paper. Missing runtime evidence must be UNVERIFIED. Never use plan/designRationale as observed proof.`,
        variant:{id:candidate.id,artifactSnapshots:candidate.artifactSnapshots.map((snapshot)=>({id:snapshot.id,sourceArtifactId:snapshot.sourceArtifactId,name:snapshot.name,mimeType:snapshot.mimeType,contentHash:snapshot.contentHash,buildMode:snapshot.buildMode}))},
      }),
      verifyFrozenArtifact:verifyServerCandidateFrozenArtifact,
      executeFrozenStatic:runServerFrozenArtifactStaticEvidence,
      executeExternalBatch:({project:current,candidate,testCases})=>executeCandidateExternal(current,candidate,testCases),
      judge:(payload)=>runServerAi("evaluate",payload),
    },
    releaseReview:(payload)=>runServerAi("release-review",payload),
  });
}
