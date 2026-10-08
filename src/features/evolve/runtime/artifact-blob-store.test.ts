import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const localBlobs=vi.hoisted(()=>new Map<string,Blob>());
vi.mock("./local-artifact-blob-store",()=>({
  putLocalArtifactBlob:async(id:string,blob:Blob)=>{localBlobs.set(id,blob);},
  putLocalArtifactBlobs:async(entries:Array<{id:string;blob:Blob}>)=>{for(const {id,blob} of entries)localBlobs.set(id,blob);},
  getLocalArtifactBlob:async(id:string)=>localBlobs.get(id),
  deleteLocalArtifactBlob:async(id:string)=>{localBlobs.delete(id);},
}));

import type {ProductionRuntimePorts} from "@evolution/contracts";
import {localProductionPorts} from "./local-production-adapters";
import {configureProductionRuntime,resetProductionRuntime} from "./production-runtime";
import {
  artifactSyncStatus,
  deleteArtifactBlob,
  flushPendingArtifactSync,
  getArtifactBlob,
  putArtifactBlob,
  queueExistingLocalArtifactUploads,
} from "./artifact-blob-store";

function runtime(artifacts:ProductionRuntimePorts["artifacts"]):ProductionRuntimePorts{
  return {...localProductionPorts,artifacts};
}

describe("artifact degraded sync",()=>{
  beforeEach(()=>{localBlobs.clear();window.localStorage.clear();});
  afterEach(()=>{resetProductionRuntime();localBlobs.clear();window.localStorage.clear();vi.restoreAllMocks();});

  it("retains local bytes and queues upload when Production Artifact API is unauthorized, then replays on recovery",async()=>{
    const failedPut=vi.fn(async()=>{throw new Error("Artifact upload failed HTTP 401: Trusted Evolution actor headers are required");});
    configureProductionRuntime(runtime({put:failedPut,get:async()=>undefined,delete:async()=>undefined}),"http");

    const blob=new Blob(["kept-locally"],{type:"text/plain"});
    await expect(putArtifactBlob("artifact-1",blob)).resolves.toBeUndefined();
    expect(await (await getArtifactBlob("artifact-1"))!.text()).toBe("kept-locally");
    expect(artifactSyncStatus()).toEqual({pendingUploads:1,pendingDeletes:0});

    const recoveredPut=vi.fn(async()=>undefined);
    configureProductionRuntime(runtime({put:recoveredPut,get:async()=>undefined,delete:async()=>undefined}),"http");
    await flushPendingArtifactSync();

    expect(recoveredPut).toHaveBeenCalledWith("artifact-1",expect.any(Blob));
    expect(artifactSyncStatus()).toEqual({pendingUploads:0,pendingDeletes:0});
  });

  it("keeps a local delete tombstone when remote delete fails and completes it after recovery",async()=>{
    localBlobs.set("artifact-delete",new Blob(["old"]));
    const failedDelete=vi.fn(async()=>{throw new Error("Artifact delete failed HTTP 401");});
    const remoteGet=vi.fn(async()=>new Blob(["remote-old"]));
    configureProductionRuntime(runtime({put:async()=>undefined,get:remoteGet,delete:failedDelete}),"http");

    await expect(deleteArtifactBlob("artifact-delete")).resolves.toBeUndefined();
    expect(localBlobs.has("artifact-delete")).toBe(false);
    expect(await getArtifactBlob("artifact-delete",{preferRemote:true})).toBeUndefined();
    expect(remoteGet).not.toHaveBeenCalled();
    expect(artifactSyncStatus()).toEqual({pendingUploads:0,pendingDeletes:1});

    const recoveredDelete=vi.fn(async()=>undefined);
    configureProductionRuntime(runtime({put:async()=>undefined,get:remoteGet,delete:recoveredDelete}),"http");
    await flushPendingArtifactSync();

    expect(recoveredDelete).toHaveBeenCalledWith("artifact-delete");
    expect(artifactSyncStatus()).toEqual({pendingUploads:0,pendingDeletes:0});
  });

  it("keeps a missing local upload pending while replaying other recoverable blobs",async()=>{
    const failedPut=vi.fn(async()=>{throw new Error("Backend temporarily unavailable");});
    configureProductionRuntime(runtime({put:failedPut,get:async()=>undefined,delete:async()=>undefined}),"http");
    await putArtifactBlob("missing",new Blob(["lost"]));
    await putArtifactBlob("recoverable",new Blob(["still here"]));
    localBlobs.delete("missing");

    const recoveredPut=vi.fn(async()=>undefined);
    configureProductionRuntime(runtime({put:recoveredPut,get:async()=>undefined,delete:async()=>undefined}),"http");
    await expect(flushPendingArtifactSync()).rejects.toThrow("1 pending Artifact upload(s) have no local bytes");
    expect(recoveredPut).toHaveBeenCalledWith("recoverable",expect.any(Blob));
    expect(artifactSyncStatus()).toEqual({pendingUploads:1,pendingDeletes:0});

    localBlobs.set("missing",new Blob(["restored"]));
    await flushPendingArtifactSync();
    expect(recoveredPut).toHaveBeenCalledWith("missing",expect.any(Blob));
    expect(artifactSyncStatus()).toEqual({pendingUploads:0,pendingDeletes:0});
  });
});


it("migrates only referenced existing local bytes after switching to HTTP, without reviving deletes",async()=>{
  window.localStorage.clear();localBlobs.clear();
  const source=new Blob(["original\u0000bytes"],{type:"text/html"});
  configureProductionRuntime(runtime({put:async()=>undefined,get:async()=>undefined,delete:async()=>undefined}),"local");
  await putArtifactBlob("source",source);
  await putArtifactBlob("unreferenced",new Blob(["draft"]));
  const upload=vi.fn(async()=>undefined);
  configureProductionRuntime(runtime({put:upload,get:async()=>undefined,delete:async()=>{throw new Error("offline");}}),"http");
  await putArtifactBlob("deleted",new Blob(["old"]));
  await deleteArtifactBlob("deleted");
  upload.mockClear();
  await queueExistingLocalArtifactUploads(["source","source","missing","deleted"]);
  expect(artifactSyncStatus()).toEqual({pendingUploads:1,pendingDeletes:1});
  configureProductionRuntime(runtime({put:upload,get:async()=>undefined,delete:async()=>undefined}),"http");
  await flushPendingArtifactSync();
  expect(upload).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledWith("source",source);
  expect(await localBlobs.get("source")!.text()).toBe("original\u0000bytes");
  expect(localBlobs.has("missing")).toBe(false);
  resetProductionRuntime();window.localStorage.clear();localBlobs.clear();
});


it("refuses a corrupt historical content-addressed frozen file before uploading it",async()=>{
  window.localStorage.clear();localBlobs.clear();
  const id="verified-file:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  localBlobs.set(id,new Blob(["tampered bytes"]));
  const upload=vi.fn(async()=>undefined);
  configureProductionRuntime(runtime({put:upload,get:async()=>undefined,delete:async()=>undefined}),"http");
  await expect(queueExistingLocalArtifactUploads([id])).rejects.toThrow("Frozen Artifact bytes mismatch");
  expect(upload).not.toHaveBeenCalled();
  resetProductionRuntime();window.localStorage.clear();localBlobs.clear();
});
