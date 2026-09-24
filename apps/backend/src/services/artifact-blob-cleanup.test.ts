// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import type {ArtifactBlobCleanupPort} from "@evolution/adapters";
import {cleanupArtifactBlobs} from "./artifact-blob-cleanup";

const now=new Date("2026-09-24T12:00:00.000Z");
const row={artifact_id:"scratch-1",bucket:"evolution-artifacts",object_path:"artifacts/scratch-1/blob",
  deleted_at:"2026-09-24T11:00:00.000Z"};

function port(overrides:Partial<ArtifactBlobCleanupPort>={}):ArtifactBlobCleanupPort{
  return {
    listPending:vi.fn(async()=>[row]),
    hasLivePath:vi.fn(async()=>false),
    remove:vi.fn(async()=>{}),
    markRemoved:vi.fn(async()=>true),
    ...overrides,
  };
}

describe("Artifact blob cleanup",()=>{
  it("removes orphan bytes and records completion using the exact tombstone identity",async()=>{
    const deps=port();
    const result=await cleanupArtifactBlobs({limit:10,minAgeSeconds:300},deps,now);
    expect(deps.listPending).toHaveBeenCalledWith("2026-09-24T11:55:00.000Z",10);
    expect(deps.remove).toHaveBeenCalledWith(row.bucket,row.object_path);
    expect(deps.markRemoved).toHaveBeenCalledWith(row.artifact_id,row.bucket,row.object_path);
    expect(result.removed).toBe(1);
  });

  it("preserves a path while live metadata references it",async()=>{
    const deps=port({hasLivePath:vi.fn(async()=>true)});
    const result=await cleanupArtifactBlobs({},deps,now);
    expect(result.results[0]?.status).toBe("skipped-live");
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it("supports dry run without deleting or marking files",async()=>{
    const deps=port();
    const result=await cleanupArtifactBlobs({dryRun:true},deps,now);
    expect(result.results[0]?.status).toBe("would-remove");
    expect(deps.remove).not.toHaveBeenCalled();
    expect(deps.markRemoved).not.toHaveBeenCalled();
  });

  it("leaves failed removals pending and continues to later tombstones",async()=>{
    const next={...row,artifact_id:"scratch-2",object_path:"artifacts/scratch-2/blob"};
    const deps=port({listPending:vi.fn(async()=>[row,next]),
      remove:vi.fn(async(_bucket,path)=>{if(path===row.object_path)throw new Error("Storage unavailable");})});
    const result=await cleanupArtifactBlobs({},deps,now);
    expect(result.results.map((item)=>item.status)).toEqual(["failed","removed"]);
    expect(deps.markRemoved).toHaveBeenCalledTimes(1);
    expect(deps.markRemoved).toHaveBeenCalledWith(next.artifact_id,next.bucket,next.object_path);
  });
});
