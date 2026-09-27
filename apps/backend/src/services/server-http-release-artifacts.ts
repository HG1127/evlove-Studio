import {createHash} from "node:crypto";
import type {ArtifactStorePort,Candidate,EvolveProject,TargetReleaseArtifact} from "@evolution/contracts";
import {hasExactFrozenArtifactSet} from "@evolution/core";
import {getServerArtifactStore} from "./artifact-runtime";

function sameSnapshot(left:Candidate["artifactSnapshots"][number],right:Candidate["artifactSnapshots"][number]){
  return left.id===right.id
    &&left.sourceArtifactId===right.sourceArtifactId
    &&left.name===right.name
    &&left.mimeType===right.mimeType
    &&left.content===right.content
    &&left.contentHash===right.contentHash;
}

/** Send the Gate F bytes, never a regenerated Candidate representation. */
export async function prepareServerHttpReleaseArtifacts(
  project:EvolveProject,
  selected:Candidate,
  store:Pick<ArtifactStorePort,"get">=getServerArtifactStore(),
):Promise<{candidate:Candidate;frozenArtifacts:TargetReleaseArtifact[]}>{
  const champion=project.searchChampion;
  const accepted=champion?.candidate;
  const gate=champion?.artifactAcceptance;
  if(!accepted||!gate||gate.status!=="passed"||gate.candidateId!==accepted.id
    ||selected.id!==accepted.id||!hasExactFrozenArtifactSet(project,accepted,gate)){
    throw new Error("HTTP Release 缺少已通过 Gate F 且覆盖全部 Target 的 exact Candidate。");
  }
  const selectedBySource=new Map(selected.artifactSnapshots.map((item)=>[item.sourceArtifactId,item]));
  if(selected.artifactSnapshots.length!==accepted.artifactSnapshots.length
    ||selectedBySource.size!==selected.artifactSnapshots.length
    ||accepted.artifactSnapshots.some((snapshot)=>{
      const selectedSnapshot=selectedBySource.get(snapshot.sourceArtifactId);
      return !selectedSnapshot||!sameSnapshot(snapshot,selectedSnapshot);
    })){
    throw new Error("HTTP Release Candidate 与 Gate F 验收的 Snapshot 不一致。");
  }
  const snapshotBySource=new Map(accepted.artifactSnapshots.map((item)=>[item.sourceArtifactId,item]));
  const receiptBySource=new Map(gate.frozenArtifacts!.map((item)=>[item.sourceArtifactId,item]));
  const frozenArtifacts:TargetReleaseArtifact[]=[];
  for(const source of project.sourceArtifacts.filter((item)=>item.role==="target")){
    const snapshot=snapshotBySource.get(source.id)!;
    const receipt=receiptBySource.get(source.id)!;
    if(!snapshot.contentHash||receipt.snapshotHash!==snapshot.contentHash
      ||receipt.name!==snapshot.name||receipt.mimeType!==snapshot.mimeType){
      throw new Error(`HTTP Release Target ${source.id} 的冻结凭证与 Candidate Snapshot 身份不一致。`);
    }
    const blob=await store.get(receipt.blobId);
    if(!blob)throw new Error(`HTTP Release 找不到 Gate F 冻结 Blob ${receipt.blobId}。`);
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(bytes.byteLength!==receipt.size)throw new Error(`HTTP Release Target ${source.id} 冻结文件大小不一致。`);
    const sha256=createHash("sha256").update(bytes).digest("hex");
    if(sha256!==receipt.sha256)throw new Error(`HTTP Release Target ${source.id} 冻结文件 SHA-256 不一致。`);
    frozenArtifacts.push({
      sourceArtifactId:source.id,snapshotHash:receipt.snapshotHash,name:receipt.name,
      mimeType:receipt.mimeType,sha256,size:receipt.size,contentBase64:Buffer.from(bytes).toString("base64"),
    });
  }
  return{candidate:accepted,frozenArtifacts};
}

/** The accepted Gate F byte hashes are the read-only Observe expectations. */
export function expectedServerHttpReleaseByteHashes(project:EvolveProject,selected:Candidate){
  const champion=project.searchChampion;
  const accepted=champion?.candidate;
  const gate=champion?.artifactAcceptance;
  if(!accepted||!gate||gate.status!=="passed"||gate.candidateId!==accepted.id
    ||selected.id!==accepted.id||!hasExactFrozenArtifactSet(project,accepted,gate)){
    throw new Error("HTTP Observe 缺少已通过 Gate F 的 exact Candidate 冻结凭证。");
  }
  const selectedBySource=new Map(selected.artifactSnapshots.map((item)=>[item.sourceArtifactId,item]));
  if(selectedBySource.size!==accepted.artifactSnapshots.length
    ||selected.artifactSnapshots.length!==accepted.artifactSnapshots.length
    ||accepted.artifactSnapshots.some((snapshot)=>{
      const current=selectedBySource.get(snapshot.sourceArtifactId);
      return !current||!sameSnapshot(current,snapshot);
    }))throw new Error("HTTP Observe Candidate 与 Gate F 验收 Snapshot 不一致。");
  const snapshots=new Map(accepted.artifactSnapshots.map((item)=>[item.sourceArtifactId,item]));
  const receipts=new Map(gate.frozenArtifacts!.map((item)=>[item.sourceArtifactId,item]));
  return project.sourceArtifacts.filter((item)=>item.role==="target").map((source)=>{
    const snapshot=snapshots.get(source.id)!;
    const receipt=receipts.get(source.id)!;
    if(!snapshot.contentHash||receipt.snapshotHash!==snapshot.contentHash
      ||receipt.name!==snapshot.name||receipt.mimeType!==snapshot.mimeType){
      throw new Error(`HTTP Observe Target ${source.id} 的冻结凭证与 Snapshot 身份不一致。`);
    }
    return{sourceArtifactId:source.id,sha256:receipt.sha256};
  });
}