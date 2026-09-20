import type { Candidate, EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { runVercelSandboxCodebaseValidation } from "@evolution/adapters/sandbox";
import { runServerHoldout } from "@evolution/harness";
import { runServerAi } from "./ai-gateway";
import { getServerArtifactStore } from "./artifact-runtime";
import { resolveServerBaselineCodebaseBinding } from "./server-baseline";
import { serverArtifactSha256 } from "./server-experiment-artifacts";

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
  const binding=resolveServerBaselineCodebaseBinding(project);
  if(!binding.source||!binding.blobId)return testCases.map((testCase)=>unavailable(testCase,binding.reason??"当前版本 External Runner 尚未连接。"));
  try{
    const blob=await getServerArtifactStore().get(binding.blobId);
    if(!blob)return testCases.map((testCase)=>unavailable(testCase,`找不到当前版本 Artifact Blob ${binding.blobId}。`));
    if(binding.sha256&&await serverArtifactSha256(await blob.arrayBuffer())!==binding.sha256){
      return testCases.map((testCase)=>unavailable(testCase,"当前版本 ZIP SHA-256 与冻结凭证不一致。"));
    }
    const response=await runVercelSandboxCodebaseValidation({
      id:`${project.id}-holdout-baseline-${binding.candidateId??"source"}`,
      archive:new Uint8Array(await blob.arrayBuffer()),
      testCases,
    });
    return response.results;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return testCases.map((testCase)=>unavailable(testCase,`Vercel Sandbox 未完成：${message}`));
  }
}

async function executeCandidateExternal(project:EvolveProject,candidate:Candidate,testCases:TestCase[]){
  const source=codebaseTarget(project);
  if(!source)return testCases.map((testCase)=>unavailable(testCase,"Candidate External Runner 当前仅支持 codebase/package ZIP Target。"));
  const snapshot=candidate.artifactSnapshots.find((item)=>item.sourceArtifactId===source.id);
  if(!snapshot?.frozenArtifact)return testCases.map((testCase)=>unavailable(testCase,"Candidate 没有 frozen codebase ZIP。"));
  const blob=await getServerArtifactStore().get(snapshot.frozenArtifact.blobId);
  if(!blob)return testCases.map((testCase)=>unavailable(testCase,`找不到 Candidate Blob ${snapshot.frozenArtifact!.blobId}。`));
  if(await serverArtifactSha256(await blob.arrayBuffer())!==snapshot.frozenArtifact.sha256){
    return testCases.map((testCase)=>unavailable(testCase,"Candidate ZIP SHA-256 与冻结凭证不一致。"));
  }
  try{
    const response=await runVercelSandboxCodebaseValidation({
      id:`${project.id}-holdout-${candidate.id}`,
      archive:new Uint8Array(await blob.arrayBuffer()),
      expectedSha256:snapshot.frozenArtifact.sha256,
      testCases,
    });
    return response.results;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return testCases.map((testCase)=>unavailable(testCase,`Vercel Sandbox 未完成：${message}`));
  }
}

export async function runServerMissionHoldout(project:EvolveProject){
  return runServerHoldout(project,{
    current:{
      executeSemanticBatch:({project:current,testCases,artifactContext})=>runServerAi("execute-artifact-batch",{
        project:{name:current.name,objectType:current.objectType,goal:current.goal,evolutionCommand:current.evolutionCommand,protectedItems:current.protectedItems,editableItems:current.editableItems,sourceArtifacts:artifactContext},
        testCases:testCases.map((testCase)=>({id:testCase.id,title:testCase.title,input:testCase.input,expected:testCase.expected,criterionIds:testCase.criterionIds,evidenceScope:testCase.evidenceScope})),
        evidenceInstruction:"Inspect only the CURRENT VERSION on this frozen hidden paper. Missing runtime evidence must be UNVERIFIED. Never infer Candidate behavior.",
        variant:null,
      }),
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
      executeExternalBatch:({project:current,candidate,testCases})=>executeCandidateExternal(current,candidate,testCases),
      judge:(payload)=>runServerAi("evaluate",payload),
    },
    releaseReview:(payload)=>runServerAi("release-review",payload),
  });
}
