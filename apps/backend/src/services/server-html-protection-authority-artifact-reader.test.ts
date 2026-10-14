// @vitest-environment node
import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {type ArtifactMetadata,type ArtifactStorePort} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {createServerHtmlProtectionPhysicalReader} from "./server-html-protection-authority-artifact-reader";
function fixture(){
  const f=acceptedPackageFixture(false),metadata=new Map<string,ArtifactMetadata>();
  f.blobs.set("source",new Blob([f.project.sourceArtifacts[0]!.textContent!],{type:"text/html"}));
  for(const [id,blob] of f.blobs)metadata.set(id,{id,schemaVersion:"artifact-v1",missionId:f.project.id,bucket:"private",objectPath:id,mimeType:blob.type,sizeBytes:blob.size,sha256:createHash("sha256").update(id==="source"?f.project.sourceArtifacts[0]!.textContent!:f.project.candidates.find(c=>c.artifactSnapshots[0]?.frozenArtifact?.blobId===id)!.artifactSnapshots[0]!.content).digest("hex"),createdAt:"2026-10-14T12:00:00Z",updatedAt:"2026-10-14T12:00:00Z"});
  const store:ArtifactStorePort={...f.store,get:vi.fn(async id=>f.blobs.get(id)),getMetadata:vi.fn(async id=>structuredClone(metadata.get(id)))};
  return {...f,metadata,store,reader:createServerHtmlProtectionPhysicalReader({project:f.project,store})};
}
describe("full physical HTML identity reader",()=>{
  it("reads every byte and brackets Original/current frozen reads with actual metadata",async()=>{
    const f=fixture(),id=f.current.artifactSnapshots[0]!.frozenArtifact!.blobId;
    expect(await (await f.reader.getArtifact(id)).text()).toBe(f.current.artifactSnapshots[0]!.content);
    expect(await (await f.reader.getArtifact("source")).text()).toBe(f.project.sourceArtifacts[0]!.textContent);
    await f.reader.assertStable();expect(f.store.get).toHaveBeenCalledTimes(4);expect(f.store.getMetadata).toHaveBeenCalledTimes(8);
  });
  it.each(["id","mission","mime","size","sha","path","bucket","timestamp"] as const)("rejects %s metadata drift even if the logical receipt remains unchanged",async kind=>{
    const f=fixture(),id=f.current.artifactSnapshots[0]!.frozenArtifact!.blobId;await f.reader.getArtifact(id);const meta=f.metadata.get(id)!;
    if(kind==="id")meta.id="foreign";if(kind==="mission")meta.missionId="foreign";if(kind==="mime")meta.mimeType="text/plain";
    if(kind==="size")meta.sizeBytes++;if(kind==="sha")meta.sha256="b".repeat(64);if(kind==="path")meta.objectPath+="-new";
    if(kind==="bucket")meta.bucket="different";if(kind==="timestamp")meta.updatedAt="2026-10-14T12:01:00Z";
    await expect(f.reader.assertStable()).rejects.toThrow();
  });
  it("rejects metadata mutation across the physical GET await",async()=>{
    const f=fixture(),id=f.current.artifactSnapshots[0]!.frozenArtifact!.blobId;f.store.get=async key=>{f.metadata.get(key)!.objectPath+="-changed";return f.blobs.get(key);};
    await expect(createServerHtmlProtectionPhysicalReader({project:f.project,store:f.store}).getArtifact(id)).rejects.toThrow("metadata-drift");
  });
  it("rejects full file byte drift without metadata changes",async()=>{
    const f=fixture(),id=f.current.artifactSnapshots[0]!.frozenArtifact!.blobId;f.blobs.set(id,new Blob(["different full bytes"],{type:"text/html"}));
    await expect(f.reader.getArtifact(id)).rejects.toThrow();
  });
  it("rejects unbound blobs and unavailable actual metadata",async()=>{
    const f=fixture();await expect(f.reader.getArtifact("foreign")).rejects.toThrow("outside-subject");
    const id=f.current.artifactSnapshots[0]!.frozenArtifact!.blobId;f.store.getMetadata=undefined;
    await expect(f.reader.getArtifact(id)).rejects.toThrow("metadata-unavailable");
  });
});
