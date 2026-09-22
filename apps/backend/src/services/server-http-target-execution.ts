import {createHash} from "node:crypto";
import type {Candidate,EvolveProject,TargetRunResult,TestCase} from "@evolution/contracts";
import {trustedServerBaselineChampion} from "@evolution/harness";
import {getServerArtifactStore} from "./artifact-runtime";
import {runHttpTarget} from "./http-target-gateway";
import {attachServerVisualEvidence} from "./server-visual-evidence";

type ServerHttpTargetPorts={
  runTarget?:(raw:unknown)=>Promise<TargetRunResult>;
  getArtifact?:(id:string)=>Promise<Blob|undefined>;
  attachVisual?:(project:EvolveProject,testCases:TestCase[],runs:TargetRunResult[])=>Promise<TargetRunResult[]>;
};

type TargetBinding={
  artifact?:{name:string;content:string};
  archiveBase64?:string;
  expectedHash?:string;
};

function digest(bytes:Uint8Array|string){
  return createHash("sha256").update(bytes).digest("hex");
}

function targetArtifacts(project:EvolveProject){
  return project.sourceArtifacts.filter((artifact)=>artifact.role==="target");
}

function htmlTarget(project:EvolveProject){
  return targetArtifacts(project).find((artifact)=>/^(html|htm)$/i.test(artifact.extension));
}

function archiveTarget(project:EvolveProject){
  return targetArtifacts(project).find((artifact)=>
    artifact.extension.toLowerCase()==="zip"
    ||artifact.artifactKind==="codebase"
    ||artifact.artifactDescriptor?.family==="codebase"
    ||artifact.artifactDescriptor?.family==="package");
}

function exactCurrentCandidate(project:EvolveProject){
  const candidate=trustedServerBaselineChampion(project);
  if(project.searchChampion&&!candidate){
    throw new Error(`当前 Search Champion ${project.searchChampion.versionLabel??project.searchChampion.id} 缺少可信验收或 exact Artifact Snapshot，不能回退原版。`);
  }
  return candidate;
}

function evidenceUnavailable(testCase:TestCase,detail:string):TargetRunResult{
  return{
    testCaseId:testCase.id,
    output:`UNVERIFIED：${detail}`,
    latencyMs:0,
    cost:0,
    verificationStatus:"unverified",
    trace:[{id:`server-http-target-unavailable-${testCase.id}`,stage:"external-runner",summary:"Server HTTP Target 证据未完成",status:"warning",detail}],
  };
}

async function bindingFor(
  project:EvolveProject,
  candidate:Candidate|undefined,
  getArtifact:(id:string)=>Promise<Blob|undefined>,
):Promise<TargetBinding>{
  const html=htmlTarget(project);
  const current=candidate??exactCurrentCandidate(project);
  if(html){
    const snapshot=current?.artifactSnapshots.find((item)=>item.sourceArtifactId===html.id);
    if(current&&!snapshot){
      throw new Error(`当前版本 ${current.id} 没有 HTML Target ${html.id} 的 exact Artifact Snapshot，不能回退原版。`);
    }
    const content=snapshot?.content??html.textContent;
    if(!content?.trim())throw new Error(`HTML Target ${html.id} 没有可执行的完整内容。`);
    return{artifact:{name:snapshot?.name??html.name,content},expectedHash:digest(content)};
  }

  const archive=archiveTarget(project);
  if(archive){
    const snapshot=current?.artifactSnapshots.find((item)=>item.sourceArtifactId===archive.id);
    if(current&&!snapshot){
      throw new Error(`当前版本 ${current.id} 没有 ZIP Target ${archive.id} 的 exact Artifact Snapshot，不能回退原版。`);
    }
    if(snapshot&&!snapshot.frozenArtifact){
      throw new Error(`当前版本 ${current?.id??"candidate"} 的 ZIP Target 尚未冻结真实文件，不能回退原 Source ZIP。`);
    }
    const blobId=snapshot?.frozenArtifact?.blobId??archive.id;
    const blob=await getArtifact(blobId);
    if(!blob)throw new Error(`找不到 HTTP Target Artifact Blob ${blobId}。`);
    const bytes=new Uint8Array(await blob.arrayBuffer());
    const actualHash=digest(bytes);
    const expected=snapshot?.frozenArtifact?.sha256;
    if(expected&&actualHash!==expected)throw new Error("HTTP Target ZIP SHA-256 与冻结凭证不一致。");
    return{archiveBase64:Buffer.from(bytes).toString("base64"),expectedHash:actualHash};
  }

  return{};
}

export function serverHttpTargetEnabled(project:EvolveProject){
  return project.targetConnection.adapter==="http"&&project.targetConnection.status==="connected";
}

export async function runServerHttpTargetBatch(
  project:EvolveProject,
  testCases:TestCase[],
  candidate?:Candidate,
  ports:ServerHttpTargetPorts={},
):Promise<TargetRunResult[]>{
  if(!serverHttpTargetEnabled(project)){
    return testCases.map((testCase)=>evidenceUnavailable(testCase,"Mission 未连接 HTTP Target Adapter。"));
  }
  const runTarget=ports.runTarget??runHttpTarget;
  const getArtifact=ports.getArtifact??((id:string)=>getServerArtifactStore().get(id));
  const attachVisual=ports.attachVisual??attachServerVisualEvidence;
  let binding:TargetBinding;
  try{
    binding=await bindingFor(project,candidate,getArtifact);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return testCases.map((testCase)=>evidenceUnavailable(testCase,message));
  }

  const results=await Promise.all(testCases.map(async(testCase):Promise<TargetRunResult>=>{
    try{
      const result=await runTarget({
        projectId:project.id,
        connectionId:project.targetConnection.connectionId,
        testCase,
        ...(binding.artifact?{artifact:binding.artifact}:{}),
        ...(binding.archiveBase64?{archiveBase64:binding.archiveBase64}:{}),
        variant:candidate??null,
      });
      if(binding.expectedHash&&result.verificationStatus!=="unverified"&&result.artifactHash!==binding.expectedHash){
        return evidenceUnavailable(testCase,`HTTP Target 返回的 Artifact 指纹不一致：expected=${binding.expectedHash} observed=${result.artifactHash??"missing"}。`);
      }
      return result;
    }catch(error){
      return evidenceUnavailable(testCase,`HTTP Target Runner 未完成：${error instanceof Error?error.message:String(error)}`);
    }
  }));
  return attachVisual(project,testCases,results);
}
