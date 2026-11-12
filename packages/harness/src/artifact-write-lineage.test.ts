import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {ArtifactWriteGovernanceSchema,type ArtifactMetadata,type ArtifactStorePort} from "@evolution/contracts";
import {archiveArtifactWriteLineage,resolveArtifactWriteGovernance,type ArtifactWriteLineageTarget} from "./artifact-write-lineage";
const fingerprint=async(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const bytes=(value:string)=>new TextEncoder().encode(value);
async function fixture(){
  const blobs=new Map<string,Blob>(),metadata=new Map<string,ArtifactMetadata>();
  const store:ArtifactStorePort={get:async id=>blobs.get(id),getMetadata:async id=>metadata.get(id),delete:async id=>{blobs.delete(id);},
    put:vi.fn(async(id,blob,binding)=>{const at=new Date().toISOString();blobs.set(id,blob);metadata.set(id,{id,schemaVersion:"artifact-v1",bucket:"test",objectPath:id,
      missionId:binding?.missionId,kind:binding?.kind,mimeType:blob.type,sizeBytes:blob.size,sha256:await fingerprint(new Uint8Array(await blob.arrayBuffer())),createdAt:at,updatedAt:at});})};
  const root=await fingerprint(bytes("seed"));
  const approval=ArtifactWriteGovernanceSchema.parse({version:"artifact-write-governance-v1",parentSha256:root,policy:{allowedPaths:["notes.txt"],protectedPaths:["tests"]}});
  const hash=await fingerprint(bytes("child")),blob=new Blob(["child"],{type:"text/plain"});blobs.set("out",blob);
  const target:ArtifactWriteLineageTarget={missionId:"mission",sourceArtifactId:"source",candidateId:"child",name:"notes.txt",frozen:{blobId:"out",sha256:hash,snapshotHash:hash,size:blob.size}};
  const ports={store,fingerprint};
  return {blobs,metadata,approval,root,target,ports,archive:()=>archiveArtifactWriteLineage({approval,actualParentSha256:root,target},ports),
    resolve:()=>resolveArtifactWriteGovernance({approval,actualParentSha256:hash,parent:target},ports)};
}
describe("trusted artifact write lineage",()=>{
  it("accepts the original approved parent without changing the approval",async()=>{
    const x=await fixture(),before=JSON.stringify(x.approval);
    expect(await resolveArtifactWriteGovernance({approval:x.approval,actualParentSha256:x.root},x.ports)).toEqual(x.approval);
    expect(JSON.stringify(x.approval)).toBe(before);expect(x.ports.store.put).not.toHaveBeenCalled();
  });
  it("rebinds to a frozen descendant only after exact receipt readback, preserving every permission",async()=>{
    const x=await fixture();await expect(x.resolve()).rejects.toThrow("UNVERIFIED");
    const id=await x.archive(),effective=await x.resolve();
    expect(id).toMatch(/^artifact-write-lineage-/);expect(effective.parentSha256).toBe(x.target.frozen.sha256);
    expect(effective.policy).toEqual(x.approval.policy);expect(x.approval.parentSha256).toBe(x.root);
  });
  it("makes identical receipt replay idempotent without overwriting the stored proof",async()=>{
    const x=await fixture();const first=await x.archive();expect(await x.archive()).toBe(first);expect(x.ports.store.put).toHaveBeenCalledOnce();
  });
  it("rejects a conflicting parent binding for the same output identity",async()=>{
    const x=await fixture();await x.archive();
    await expect(archiveArtifactWriteLineage({approval:x.approval,actualParentSha256:"0".repeat(64),parentCandidateId:"other",target:x.target},x.ports)).rejects.toThrow("REPLAY_CONFLICT");
    expect(x.ports.store.put).toHaveBeenCalledOnce();
  });
  it.each(["policy","root","mission","source","candidate","name","snapshot","size"])("rejects changed %s authority or identity",async mode=>{
    const x=await fixture();await x.archive();
    if(mode==="policy")x.approval.policy.allowedPaths.push("extra.txt");
    if(mode==="root")x.approval.parentSha256="1".repeat(64);
    if(mode==="mission")x.target.missionId="foreign";
    if(mode==="source")x.target.sourceArtifactId="foreign";
    if(mode==="candidate")x.target.candidateId="forged";
    if(mode==="name")x.target.name="other.txt";
    if(mode==="snapshot")x.target.frozen.snapshotHash="2".repeat(64);
    if(mode==="size")x.target.frozen.size++;
    await expect(x.resolve()).rejects.toThrow("UNVERIFIED");
  });
  it.each(["bytes","metadata","missing","orphan"])("fails closed on %s evidence",async mode=>{
    const x=await fixture(),id=await x.archive();
    if(mode==="bytes")x.blobs.set(id,new Blob(["tampered"]));
    if(mode==="metadata")x.metadata.set(id,{...x.metadata.get(id)!,kind:"source"});
    if(mode==="missing")x.blobs.delete(id);
    if(mode==="orphan")x.metadata.delete(id);
    await expect(x.resolve()).rejects.toThrow("UNVERIFIED");
  });
  it("requires metadata capability even for the initial approved parent",async()=>{
    const x=await fixture();delete x.ports.store.getMetadata;
    await expect(resolveArtifactWriteGovernance({approval:x.approval,actualParentSha256:x.root},x.ports)).rejects.toThrow("UNAVAILABLE");
  });
  it("does not attest an output whose actual bytes differ",async()=>{
    const x=await fixture();x.blobs.set("out",new Blob(["tamper"]));
    await expect(x.archive()).rejects.toThrow("UNVERIFIED");expect(x.ports.store.put).not.toHaveBeenCalled();
  });
  it("does not adopt a changed parent without a predecessor",async()=>{
    const x=await fixture();await expect(resolveArtifactWriteGovernance({approval:x.approval,actualParentSha256:x.target.frozen.sha256},x.ports)).rejects.toThrow("STALE_PARENT");
  });
});
