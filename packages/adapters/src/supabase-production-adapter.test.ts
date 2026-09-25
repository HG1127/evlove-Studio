import { describe, expect, it, vi } from "vitest";
import {createHash} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {
  EvolutionEventSchema,
  EvolutionJobSchema,
  SupabaseBackendConfigSchema,
} from "@evolution/contracts";
import {
  eventToSupabaseRow,
  jobToSupabaseRow,
  supabaseRowToEvent,
  supabaseRowToJob,
  supabaseRowToMission,
  createSupabaseProductionPorts,
  checkSupabaseBackendHealth,
} from "./supabase-production-adapter";

const at = "2026-09-18T08:00:00.000Z";

describe("supabase production adapter contracts", () => {
  it("reports the pending Artifact cleanup migration separately from core table health",async()=>{
    const from=vi.fn((table:string)=>({
      select:vi.fn().mockReturnValue({
        eq:vi.fn().mockReturnValue({limit:vi.fn(async()=>({error:table==="artifact_retention_tombstones"?{message:"column missing"}:null}))}),
        limit:vi.fn(async()=>({error:null})),
      }),
    }));
    const client={from,storage:{from:vi.fn(()=>({list:vi.fn(async()=>({error:null}))}))}} as unknown as SupabaseClient;
    const health=await checkSupabaseBackendHealth({url:"https://example.supabase.co",
      anonKey:"sb_secret_test_fixture_0000000000000000",artifactBucket:"evolution-artifacts"},client);
    expect(health.database).toBe(true);
    expect(health.storage).toBe(true);
    expect(health.artifactCleanup).toBe(false);
    expect(health.message).toContain("Artifact cleanup MISSING");
  });

  it("fills Event lists across short SDK pages",async()=>{
    const pages=["event-z","event-y",undefined];
    const queries:Array<{orders:string[];limit?:number;missionId?:string;or?:string}>=[];
    const from=vi.fn(()=>{
      const state:{orders:string[];limit?:number;missionId?:string;or?:string}={orders:[]};
      queries.push(state);
      return {
        select(){return this;},
        order(field:string){state.orders.push(field);return this;},
        limit(value:number){state.limit=value;return this;},
        eq(_field:string,value:string){state.missionId=value;return this;},
        or(value:string){state.or=value;return this;},
        then(resolve:(value:{data:Record<string,unknown>[];error:null})=>unknown){
          const id=pages[queries.length-1];
          const data=id?[{
            id,mission_id:"mission-1",schema_version:"event-v1",type:"MissionUpdated",
            source:"test",payload:{},at,
          }]:[];
          return Promise.resolve({data,error:null}).then(resolve);
        },
      };
    });
    const client={from} as unknown as SupabaseClient;
    const ports=createSupabaseProductionPorts({url:"https://example.supabase.co",
      anonKey:"sb_secret_test_fixture_0000000000000000",artifactBucket:"evolution-artifacts"},client);
    expect((await ports.events.list("mission-1",3)).map((event)=>event.id))
      .toEqual(["event-z","event-y"]);
    expect(queries).toHaveLength(3);
    expect(queries.every((query)=>query.orders.join(",")==="at,id"
      &&query.missionId==="mission-1")).toBe(true);
    expect(queries[1].or).toContain('id.lt."event-z"');
    expect(queries[2].or).toContain('id.lt."event-y"');
  });
  function artifactDeletionPorts(missionId:string|null,references:Array<{id:string}>){
    const remove=vi.fn(async()=>({error:null}));
    const deleteResult=vi.fn(async():Promise<{data:{id:string}|null;error:{message:string}|null}>=>({data:{id:"a1"},error:null}));
    const deleteQuery={eq:vi.fn().mockReturnThis(),select:vi.fn().mockReturnThis(),maybeSingle:deleteResult};
    const artifactQuery={
      select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
      maybeSingle:vi.fn(async()=>({data:{bucket:"evolution-artifacts",object_path:"artifacts/a1",mission_id:missionId},error:null})),
      delete:vi.fn(()=>deleteQuery),
    };
    const referenceQuery={
      select:vi.fn().mockReturnThis(),contains:vi.fn().mockReturnThis(),
      limit:vi.fn(async()=>({data:references,error:null})),
    };
    const client={
      from:vi.fn((table:string)=>table==="artifacts"?artifactQuery:referenceQuery),
      storage:{from:vi.fn(()=>({remove}))},
    } as unknown as SupabaseClient;
    const ports=createSupabaseProductionPorts({url:"https://example.supabase.co",anonKey:"sb_publishable_test_fixture_0000000000000000",artifactBucket:"evolution-artifacts"},client);
    return {ports,remove,referenceQuery,deleteQuery,deleteResult};
  }

  it("retains Mission-bound and evidence-referenced Artifact bytes on explicit delete",async()=>{
    const bound=artifactDeletionPorts("mission-1",[]);
    await expect(bound.ports.artifacts.delete("a1")).rejects.toThrow("Mission-bound");
    expect(bound.remove).not.toHaveBeenCalled();
    const referenced=artifactDeletionPorts(null,[{id:"evidence-1"}]);
    await expect(referenced.ports.artifacts.delete("a1")).rejects.toThrow("immutable Evidence");
    expect(referenced.referenceQuery.contains).toHaveBeenCalledWith("artifact_refs",["a1"]);
    expect(referenced.remove).not.toHaveBeenCalled();
  });

  it("allows unbound, unreferenced scratch Artifact cleanup",async()=>{
    const scratch=artifactDeletionPorts(null,[]);
    await expect(scratch.ports.artifacts.delete("a1")).resolves.toBeUndefined();
    expect(scratch.remove).toHaveBeenCalledWith(["artifacts/a1"]);
    expect(scratch.deleteQuery.eq).toHaveBeenCalledWith("id","a1");
    expect(scratch.deleteQuery.eq).toHaveBeenCalledWith("object_path","artifacts/a1");
    expect(scratch.deleteResult.mock.invocationCallOrder[0]).toBeLessThan(scratch.remove.mock.invocationCallOrder[0]!);
  });
  it("keeps bytes intact when the database refuses Artifact deletion",async()=>{
    const scratch=artifactDeletionPorts(null,[]);
    scratch.deleteResult.mockResolvedValueOnce({data:null,error:{message:"ARTIFACT_EVIDENCE_REFERENCED"}});
    await expect(scratch.ports.artifacts.delete("a1")).rejects.toThrow("ARTIFACT_EVIDENCE_REFERENCED");
    expect(scratch.remove).not.toHaveBeenCalled();
  });
  it("does not remove bytes after another operation has replaced the scratch Artifact row",async()=>{
    const scratch=artifactDeletionPorts(null,[]);
    scratch.deleteResult.mockResolvedValueOnce({data:null,error:null});
    await expect(scratch.ports.artifacts.delete("a1")).resolves.toBeUndefined();
    expect(scratch.remove).not.toHaveBeenCalled();
  });

  function artifactUploadPorts(existing:Record<string,unknown>|null=null){
    const upload=vi.fn(async(...args:[string,Blob,Record<string,unknown>])=>{void args;return {error:null};});
    const insert=vi.fn(async(...args:[Record<string,unknown>])=>{void args;return {data:null,error:null};});
    const updateResult=vi.fn(async()=>({data:{id:"a1"} as {id:string}|null,error:null}));
    const updateQuery={eq:vi.fn().mockReturnThis(),select:vi.fn().mockReturnThis(),maybeSingle:updateResult};
    const update=vi.fn((...args:[Record<string,unknown>])=>{void args;return updateQuery;});
    const artifactQuery={
      select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),
      maybeSingle:vi.fn(async()=>({data:existing,error:null})),insert,update,
    };
    const client={
      from:vi.fn(()=>artifactQuery),
      storage:{from:vi.fn(()=>({upload}))},
    } as unknown as SupabaseClient;
    const ports=createSupabaseProductionPorts({url:"https://example.supabase.co",anonKey:"sb_publishable_test_fixture_0000000000000000",artifactBucket:"evolution-artifacts"},client);
    return {ports,upload,insert,update,updateQuery,updateResult};
  }

  it("uses different content-addressed paths for concurrent first writes with the same Artifact id",async()=>{
    const first=artifactUploadPorts();
    const second=artifactUploadPorts();
    const firstText="first content";
    const secondText="second content";
    await Promise.all([
      first.ports.artifacts.put("a1",new Blob([firstText],{type:"text/plain"})),
      second.ports.artifacts.put("a1",new Blob([secondText],{type:"text/plain"})),
    ]);
    const firstHash=createHash("sha256").update(firstText).digest("hex");
    const secondHash=createHash("sha256").update(secondText).digest("hex");
    const firstPath=first.upload.mock.calls[0]?.[0];
    const secondPath=second.upload.mock.calls[0]?.[0];
    expect(firstPath).toMatch(new RegExp(`^artifacts/a1/${firstHash}/[0-9a-f-]{36}$`));
    expect(secondPath).toMatch(new RegExp(`^artifacts/a1/${secondHash}/[0-9a-f-]{36}$`));
    expect(first.insert.mock.calls[0]?.[0]).toMatchObject({id:"a1",sha256:firstHash,object_path:firstPath});
    expect(second.insert.mock.calls[0]?.[0]).toMatchObject({id:"a1",sha256:secondHash,object_path:secondPath});
  });

  it("preserves a legacy object path on an idempotent retry",async()=>{
    const text="existing content";
    const sha256=createHash("sha256").update(text).digest("hex");
    const existing={id:"a1",sha256,mime_type:"text/plain",object_path:"artifacts/a1",bucket:"evolution-artifacts",mission_id:null,metadata:{},created_at:at};
    const {ports,upload,update,updateQuery}=artifactUploadPorts(existing);
    await ports.artifacts.put("a1",new Blob([text],{type:"text/plain"}));
    expect(upload).toHaveBeenCalledWith("artifacts/a1",expect.any(Blob),expect.any(Object));
    expect(update.mock.calls[0]?.[0]).toMatchObject({object_path:"artifacts/a1",sha256});
    expect(updateQuery.eq).toHaveBeenCalledWith("object_path","artifacts/a1");
    await expect(ports.artifacts.put("a1",new Blob(["different"],{type:"text/plain"}))).rejects.toThrow("immutable");
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect an Artifact deleted while its existing bytes were uploaded",async()=>{
    const text="existing content";
    const sha256=createHash("sha256").update(text).digest("hex");
    const existing={id:"a1",sha256,mime_type:"text/plain",object_path:"artifacts/a1",bucket:"evolution-artifacts",mission_id:null,metadata:{},created_at:at};
    const {ports,insert,updateResult}=artifactUploadPorts(existing);
    updateResult.mockResolvedValueOnce({data:null,error:null});
    await expect(ports.artifacts.put("a1",new Blob([text],{type:"text/plain"}))).rejects.toThrow("changed during upload");
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not reuse a deleted Artifact's Storage path when the id and content are registered again",async()=>{
    const first=artifactUploadPorts();
    const next=artifactUploadPorts();
    const blob=()=>new Blob(["same bytes"],{type:"text/plain"});
    await first.ports.artifacts.put("a1",blob());
    await next.ports.artifacts.put("a1",blob());
    expect(first.upload.mock.calls[0]?.[0]).not.toBe(next.upload.mock.calls[0]?.[0]);
  });
  it("validates the auth-free V1 client config without accepting malformed endpoints", () => {
    expect(SupabaseBackendConfigSchema.safeParse({ url: "not-a-url", anonKey: "short" }).success).toBe(false);
    expect(SupabaseBackendConfigSchema.parse({
      url: "https://example.supabase.co",
      anonKey: "sb_publishable_test_fixture_0000000000000000",
    }).artifactBucket).toBe("evolution-artifacts");
  });

  it("rejects malformed mission payloads at the Supabase contract boundary", () => {
    expect(() => supabaseRowToMission({
      id: "m1",
      schema_version: "mission-v1",
      revision: 2,
      payload: { id: "m1", name: "broken" },
      created_at: at,
      updated_at: at,
    })).toThrow();
  });

  it("round-trips unified jobs and events through durable row shapes", () => {
    const job = EvolutionJobSchema.parse({
      schemaVersion: "job-v1", id: "j1", missionId: "m1", type: "e2e", status: "running",
      label: "E2E", idempotencyKey: "m1:e2e", generation: 1, attempts: 1, priority: 50,
      metadata:{sessionId:"composer-1",artifactId:"artifact-1"},
      createdAt: at, updatedAt: at,
    });
    expect(supabaseRowToJob(jobToSupabaseRow(job))).toEqual(job);

    const event = EvolutionEventSchema.parse({
      schemaVersion: "event-v1", id: "e1", missionId: "m1", type: "JobStarted",
      source: "test", jobId: "j1", payload: { ok: true }, at,
    });
    expect(supabaseRowToEvent(eventToSupabaseRow(event))).toEqual(event);
  });
});
