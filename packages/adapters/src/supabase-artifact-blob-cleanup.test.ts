import {describe,expect,it,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createSupabaseArtifactBlobCleanupPort} from "./supabase-artifact-blob-cleanup";

const config={url:"https://example.supabase.co",anonKey:"sb_secret_test_fixture_0000000000000000",
  artifactBucket:"evolution-artifacts"};
const tombstone={artifact_id:"scratch-1",bucket:"evolution-artifacts",object_path:"artifacts/scratch-1/blob",
  deleted_at:"2026-09-24T11:00:00.000Z"};

function fakeClient(rows:unknown[]=[tombstone]){
  const tombstoneQuery={
    select:vi.fn().mockReturnThis(),is:vi.fn().mockReturnThis(),lte:vi.fn().mockReturnThis(),
    order:vi.fn().mockReturnThis(),limit:vi.fn(async()=>({data:rows,error:null})),
    update:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
    maybeSingle:vi.fn(async()=>({data:{artifact_id:"scratch-1"},error:null})),
  };
  const artifactQuery={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
    limit:vi.fn(async()=>({data:[],error:null}))};
  const exists=vi.fn(async()=>({data:true,error:null}));
  const remove=vi.fn(async()=>({data:[],error:null}));
  const client={from:vi.fn((name:string)=>name==="artifacts"?artifactQuery:tombstoneQuery),
    storage:{from:vi.fn(()=>({exists,remove}))}} as unknown as SupabaseClient;
  return {client,tombstoneQuery,artifactQuery,exists,remove};
}

describe("Supabase Artifact blob cleanup adapter",()=>{
  it("validates pending tombstones and queries only aged, unfinished rows",async()=>{
    const fake=fakeClient();
    const port=createSupabaseArtifactBlobCleanupPort(config,fake.client);
    expect(await port.listPending("2026-09-24T11:55:00.000Z",25)).toEqual([tombstone]);
    expect(fake.tombstoneQuery.is).toHaveBeenCalledWith("blob_deleted_at",null);
    expect(fake.tombstoneQuery.eq).toHaveBeenCalledWith("bucket","evolution-artifacts");
    expect(fake.tombstoneQuery.lte).toHaveBeenCalledWith("deleted_at","2026-09-24T11:55:00.000Z");
    expect(fake.tombstoneQuery.limit).toHaveBeenCalledWith(25);
    const malformed=fakeClient([{...tombstone,object_path:""}]);
    await expect(createSupabaseArtifactBlobCleanupPort(config,malformed.client)
      .listPending("2026-09-24T11:55:00.000Z",25)).rejects.toThrow();
  });

  it("checks live metadata before deletion and treats a missing Storage object as cleaned",async()=>{
    const fake=fakeClient();
    const port=createSupabaseArtifactBlobCleanupPort(config,fake.client);
    expect(await port.hasLivePath(tombstone.object_path)).toBe(false);
    expect(fake.artifactQuery.eq).toHaveBeenCalledWith("object_path",tombstone.object_path);
    fake.exists.mockResolvedValueOnce({data:false,error:null});
    await port.remove(tombstone.bucket,tombstone.object_path);
    expect(fake.remove).not.toHaveBeenCalled();
    await port.remove(tombstone.bucket,tombstone.object_path);
    expect(fake.remove).toHaveBeenCalledWith([tombstone.object_path]);
  });

  it("marks only the exact pending tombstone",async()=>{
    const fake=fakeClient();
    const port=createSupabaseArtifactBlobCleanupPort(config,fake.client);
    expect(await port.markRemoved(tombstone.artifact_id,tombstone.bucket,tombstone.object_path)).toBe(true);
    expect(fake.tombstoneQuery.eq).toHaveBeenCalledWith("artifact_id",tombstone.artifact_id);
    expect(fake.tombstoneQuery.eq).toHaveBeenCalledWith("bucket",tombstone.bucket);
    expect(fake.tombstoneQuery.eq).toHaveBeenCalledWith("object_path",tombstone.object_path);
    expect(fake.tombstoneQuery.is).toHaveBeenCalledWith("blob_deleted_at",null);
    expect(fake.tombstoneQuery.update).toHaveBeenCalledWith({blob_deleted_at:expect.any(String)});
  });

  it("refuses to remove blobs from another bucket",async()=>{
    const fake=fakeClient();
    const port=createSupabaseArtifactBlobCleanupPort(config,fake.client);
    await expect(port.remove("unrelated-bucket",tombstone.object_path)).rejects.toThrow("configured bucket");
    await expect(port.markRemoved(tombstone.artifact_id,"unrelated-bucket",tombstone.object_path))
      .rejects.toThrow("configured bucket");
    expect(fake.exists).not.toHaveBeenCalled();
    expect(fake.remove).not.toHaveBeenCalled();
  });
});
