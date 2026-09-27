import type {EvolveProject,FrozenArtifact,TargetRunFile} from "@evolution/contracts";
import {getArtifactBlob} from "../runtime/artifact-blob-store";
import {readFrozenArtifact,sha256} from "../runtime/frozen-artifact";
import type {TargetVariant} from "./types";

type Source=EvolveProject["sourceArtifacts"][number];

function base64(bytes:Uint8Array){
  let binary="";
  for(let offset=0;offset<bytes.length;offset+=32768){
    binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  }
  return btoa(binary);
}

/** Browser-local binary execution uses stored bytes, never parsed or AI-supplied text. */
export async function prepareBrowserHttpRunFile(
  source:Source,
  variant?:TargetVariant,
  ports:{get:(id:string)=>Promise<Blob|undefined>;read:(receipt:FrozenArtifact|undefined,content:string)=>Promise<Blob>}={get:getArtifactBlob,read:readFrozenArtifact},
):Promise<TargetRunFile>{
  const snapshots=variant?.artifactSnapshots.filter((item)=>item.sourceArtifactId===source.id)??[];
  if(variant&&snapshots.length!==1)throw new Error(`HTTP Target ${source.id} 没有唯一的 Candidate Snapshot。`);
  const snapshot=snapshots[0];
  const frozen=snapshot?.frozenArtifact;
  if(snapshot&&(!frozen||frozen.sourceArtifactId!==source.id||frozen.snapshotHash!==snapshot.contentHash
    ||frozen.name!==snapshot.name||frozen.mimeType!==snapshot.mimeType)){
    throw new Error(`HTTP Target ${source.id} 的冻结凭证与 Candidate Snapshot 身份不一致。`);
  }
  const blob=snapshot?await ports.read(frozen,snapshot.content):await ports.get(source.storageRef?.trim()||source.id);
  if(!blob)throw new Error(`HTTP Target ${source.id} 的原始文件不在当前浏览器。`);
  const buffer=await blob.arrayBuffer();
  const bytes=new Uint8Array(buffer);
  const hash=await sha256(buffer);
  if(frozen&&(bytes.byteLength!==frozen.size||hash!==frozen.sha256)){
    throw new Error(`HTTP Target ${source.id} 的文件字节与冻结凭证不一致。`);
  }
  return{sourceArtifactId:source.id,snapshotHash:snapshot?.contentHash,name:snapshot?.name??source.name,
    mimeType:snapshot?.mimeType??source.mimeType,sha256:hash,size:bytes.byteLength,contentBase64:base64(bytes)};
}
/** HTML keeps the legacy Runner text field, but only after exact byte readback. */
export async function prepareBrowserHttpRunHtml(
  source:Source,
  variant?:TargetVariant,
  ports:{get:(id:string)=>Promise<Blob|undefined>;read:(receipt:FrozenArtifact|undefined,content:string)=>Promise<Blob>}={get:getArtifactBlob,read:readFrozenArtifact},
):Promise<{artifact:{name:string;content:string};sha256:string}>{
  const snapshots=variant?.artifactSnapshots.filter((item)=>item.sourceArtifactId===source.id)??[];
  if(variant&&snapshots.length!==1)throw new Error(`HTTP HTML Target ${source.id} 没有唯一的 Candidate Snapshot。`);
  const snapshot=snapshots[0];
  const frozen=snapshot?.frozenArtifact;
  if(snapshot&&(!frozen||frozen.sourceArtifactId!==source.id||frozen.snapshotHash!==snapshot.contentHash
    ||frozen.name!==snapshot.name||frozen.mimeType!==snapshot.mimeType)){
    throw new Error(`HTTP HTML Target ${source.id} 的冻结凭证与 Candidate Snapshot 身份不一致。`);
  }
  let content:string;
  let hash:string;
  if(snapshot||source.storageRef?.trim()){
    const blob=snapshot?await ports.read(frozen,snapshot.content):await ports.get(source.storageRef!.trim());
    if(!blob)throw new Error(`HTTP HTML Target ${source.id} 的原始文件不在当前浏览器。`);
    const buffer=await blob.arrayBuffer();
    content=new TextDecoder().decode(buffer);
    hash=await sha256(buffer);
    if(snapshot&&(content!==snapshot.content||hash!==frozen!.sha256))throw new Error("HTTP HTML Target 冻结字节与 Candidate Snapshot 不一致。");
    if(hash!==await sha256(new TextEncoder().encode(content).buffer as ArrayBuffer)){
      throw new Error("HTTP HTML Target 不是可逐字节还原的 UTF-8 文本。");
    }
  }else{
    content=source.textContent??"";
    hash=await sha256(new TextEncoder().encode(content).buffer as ArrayBuffer);
  }
  if(!content?.trim()||content.includes("[...truncated by Evolve Studio...]")
    ||(!snapshot&&source.warnings?.some((item)=>/Studio 已截断进入|进入 AI 上下文的部分已截断/.test(item)))){
    throw new Error("HTTP HTML Target 缺少完整、未截断的可执行内容。");
  }
  return{artifact:{name:snapshot?.name??source.name,content},sha256:hash};
}