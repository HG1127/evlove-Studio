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

type TargetArtifact=EvolveProject["sourceArtifacts"][number];

function targetForTest(project:EvolveProject,testCase:TestCase):TargetArtifact|undefined{
  const targets=targetArtifacts(project);
  if(!targets.length)return undefined;
  const criteria=new Set(testCase.criterionIds);
  const scopedIds=new Set((project.acceptanceRubric??[])
    .filter((criterion)=>criteria.has(criterion.id))
    .flatMap((criterion)=>criterion.artifactIds));
  const selected=scopedIds.size?targets.filter((artifact)=>scopedIds.has(artifact.id)):targets;
  if(selected.length!==1){
    throw new Error(`HTTP Test Case ${testCase.id} 没有唯一的 Target Artifact 绑定，不能选用首个 Source。`);
  }
  return selected[0];
}

function isArchiveTarget(artifact:TargetArtifact){
  return artifact.extension.toLowerCase()==="zip"
    ||artifact.artifactKind==="codebase"
    ||artifact.artifactDescriptor?.family==="codebase"
    ||artifact.artifactDescriptor?.family==="package";
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
  target:TargetArtifact|undefined,
  getArtifact:(id:string)=>Promise<Blob|undefined>,
):Promise<TargetBinding>{
  const current=candidate??exactCurrentCandidate(project);
  if(!target)return{};
  if(/^(html|htm)$/i.test(target.extension)){
    const html=target;
    const snapshots=current?.artifactSnapshots.filter((item)=>item.sourceArtifactId===html.id)??[];
    const snapshot=snapshots[0];
    if(current&&snapshots.length!==1){
      throw new Error(`当前版本 ${current.id} 没有唯一的 HTML Target ${html.id} exact Artifact Snapshot，不能回退原版。`);
    }
    let content:string|undefined;
    let expectedHash:string|undefined;
    if(snapshot){
      const frozen=snapshot.frozenArtifact;
      if(!frozen)throw new Error(`当前版本 ${current?.id??"candidate"} 的 HTML Target 尚未冻结真实文件。`);
      if(frozen.sourceArtifactId!==html.id||frozen.snapshotHash!==snapshot.contentHash||frozen.name!==snapshot.name||frozen.mimeType!==snapshot.mimeType){
        throw new Error("HTTP Target HTML 冻结凭证与 Candidate Snapshot 身份不一致。");
      }
      const blob=await getArtifact(frozen.blobId);
      if(!blob)throw new Error(`找不到 HTTP Target 冻结 HTML Blob ${frozen.blobId}。`);
      const bytes=new Uint8Array(await blob.arrayBuffer());
      if(bytes.byteLength!==frozen.size)throw new Error("HTTP Target HTML 大小与冻结凭证不一致。");
      if(digest(bytes)!==frozen.sha256)throw new Error("HTTP Target HTML SHA-256 与冻结凭证不一致。");
      content=new TextDecoder().decode(bytes);
      if(content!==snapshot.content||digest(content)!==frozen.sha256){
        throw new Error("HTTP Target HTML 冻结字节与 Candidate Snapshot 不一致。");
      }
      expectedHash=frozen.sha256;
    }else if(html.storageRef?.trim()){
      const blob=await getArtifact(html.storageRef.trim());
      if(!blob)throw new Error(`找不到 HTTP Target 原始 HTML Blob ${html.storageRef.trim()}。`);
      const bytes=new Uint8Array(await blob.arrayBuffer());
      content=new TextDecoder().decode(bytes);
      if(digest(content)!==digest(bytes))throw new Error("HTTP Target 原始 HTML 不是可逐字节还原的 UTF-8 文本。");
      expectedHash=digest(bytes);
    }else{
      content=html.textContent;
      expectedHash=content?digest(content):undefined;
    }
    if(!content?.trim()||!expectedHash)throw new Error(`HTML Target ${html.id} 没有可执行的完整内容。`);
    return{artifact:{name:snapshot?.name??html.name,content},expectedHash};
  }

  if(isArchiveTarget(target)){
    const archive=target;
    const snapshots=current?.artifactSnapshots.filter((item)=>item.sourceArtifactId===archive.id)??[];
    const snapshot=snapshots[0];
    if(current&&snapshots.length!==1){
      throw new Error(`当前版本 ${current.id} 没有唯一的 ZIP Target ${archive.id} exact Artifact Snapshot，不能回退原版。`);
    }
    if(snapshot&&!snapshot.frozenArtifact){
      throw new Error(`当前版本 ${current?.id??"candidate"} 的 ZIP Target 尚未冻结真实文件，不能回退原 Source ZIP。`);
    }
    const blobId=snapshot?.frozenArtifact?.blobId??(archive.storageRef?.trim()||archive.id);
    const blob=await getArtifact(blobId);
    if(!blob)throw new Error(`找不到 HTTP Target Artifact Blob ${blobId}。`);
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(snapshot?.frozenArtifact&&bytes.byteLength!==snapshot.frozenArtifact.size)throw new Error("HTTP Target ZIP 大小与冻结凭证不一致。");
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
  const bindings=new Map<string,Promise<TargetBinding>>();
  const results=await Promise.all(testCases.map(async(testCase):Promise<TargetRunResult>=>{
    let binding:TargetBinding;
    try{
      const target=targetForTest(project,testCase);
      const key=target?.id??"no-target";
      let pending=bindings.get(key);
      if(!pending){
        pending=bindingFor(project,candidate,target,getArtifact);
        bindings.set(key,pending);
      }
      binding=await pending;
    }catch(error){
      return evidenceUnavailable(testCase,error instanceof Error?error.message:String(error));
    }
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
