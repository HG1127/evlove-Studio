import {hasExactFrozenArtifactSet} from "@evolution/core";
import type {EvolveProject,FrozenArtifact,TargetReleaseArtifact} from "@evolution/contracts";
import {readFrozenArtifact} from "../runtime/frozen-artifact";
import type {TargetVariant} from "./types";

function base64(bytes:Uint8Array){
  let binary="";
  for(let offset=0;offset<bytes.length;offset+=32768){
    binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  }
  return btoa(binary);
}

export async function prepareBrowserHttpReleaseArtifacts(
  project:EvolveProject,
  selected:TargetVariant,
  read:(receipt:FrozenArtifact|undefined,content:string)=>Promise<Blob>=readFrozenArtifact,
){
  const champion=project.searchChampion;
  const accepted=champion?.candidate;
  const gate=champion?.artifactAcceptance;
  if(!accepted||!gate||gate.status!=="passed"||gate.candidateId!==accepted.id
    ||selected.id!==accepted.id||!hasExactFrozenArtifactSet(project,accepted,gate)){
    throw new Error("HTTP 发布缺少已通过 Gate F 且覆盖全部 Target 的验收文件。");
  }
  const selectedBySource=new Map(selected.artifactSnapshots.map((item)=>[item.sourceArtifactId,item]));
  if(selected.artifactSnapshots.length!==accepted.artifactSnapshots.length
    ||selectedBySource.size!==selected.artifactSnapshots.length
    ||accepted.artifactSnapshots.some((snapshot)=>{
      const current=selectedBySource.get(snapshot.sourceArtifactId);
      return !current||current.id!==snapshot.id||current.content!==snapshot.content
        ||current.contentHash!==snapshot.contentHash||current.name!==snapshot.name||current.mimeType!==snapshot.mimeType;
    })){
    throw new Error("HTTP 发布 Candidate 与 Gate F 已验收 Snapshot 不一致。");
  }
  const frozenBySource=new Map(gate.frozenArtifacts!.map((item)=>[item.sourceArtifactId,item]));
  const frozenArtifacts:TargetReleaseArtifact[]=[];
  for(const snapshot of accepted.artifactSnapshots){
    const receipt=frozenBySource.get(snapshot.sourceArtifactId)!;
    if(!snapshot.contentHash||receipt.snapshotHash!==snapshot.contentHash
      ||receipt.name!==snapshot.name||receipt.mimeType!==snapshot.mimeType){
      throw new Error("HTTP 发布冻结凭证与 Candidate Snapshot 身份不一致。");
    }
    const blob=await read(receipt,snapshot.content);
    const bytes=new Uint8Array(await blob.arrayBuffer());
    frozenArtifacts.push({sourceArtifactId:snapshot.sourceArtifactId,snapshotHash:receipt.snapshotHash,
      name:receipt.name,mimeType:receipt.mimeType,sha256:receipt.sha256,size:receipt.size,contentBase64:base64(bytes)});
  }
  return{candidate:accepted,frozenArtifacts};
}
