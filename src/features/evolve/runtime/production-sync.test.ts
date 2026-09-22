import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
import {saveLocalProject} from "./local-store";
import {EvolutionJobSchema} from "./job-contract";
import {createEvolutionEvent,pendingLocalEvolutionEventCount} from "./event-contract";
import {localProductionPorts} from "./local-production-adapters";
import {configureProductionRuntime,resetProductionRuntime} from "./production-runtime";
import {initializeProductionSync,productionSyncStatus,stopProductionSync} from "./production-sync";

describe("production sync bootstrap",()=>{
  beforeEach(()=>window.localStorage.clear());
  afterEach(async()=>{
    await stopProductionSync();
    resetProductionRuntime();
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("moves to auth backoff when an Artifact write is deferred and resumes normal polling after recovery",async()=>{
    vi.useFakeTimers();
    const list=vi.fn(async()=>[]);
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list,save:async()=>undefined,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[],put:async()=>undefined},
      events:{...localProductionPorts.events,list:async()=>[]},
      artifacts:{put:async()=>undefined,get:async()=>undefined,delete:async()=>undefined},
    },"http");

    await initializeProductionSync();
    expect(productionSyncStatus()).toMatchObject({realtimeStatus:"http-polling",failureCount:0});

    window.dispatchEvent(new CustomEvent("evolve-artifact-sync-status",{detail:{
      status:"pending",error:"Artifact upload failed HTTP 401: Trusted Evolution actor headers are required",
    }}));
    expect(productionSyncStatus()).toMatchObject({realtimeStatus:"http-error",failureCount:1});

    await vi.advanceTimersByTimeAsync(3_000);
    expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(57_000);
    expect(list).toHaveBeenCalledTimes(2);
    expect(productionSyncStatus()).toMatchObject({realtimeStatus:"http-polling",failureCount:0,lastError:undefined});
  });

  it("does not overwrite a newer remote Job while replaying local Jobs",async()=>{
    vi.useFakeTimers();
    const localAt="2026-09-22T10:00:00.000Z";
    const remoteAt="2026-09-22T10:05:00.000Z";
    await localProductionPorts.jobs.put(EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"job-newer-remote",missionId:"m1",type:"parse",status:"running",label:"Local older",
      idempotencyKey:"parse:conflict",generation:1,attempts:1,priority:50,metadata:{},createdAt:localAt,updatedAt:localAt,
    }));
    const remoteJob=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"job-newer-remote",missionId:"m1",type:"parse",status:"completed",label:"Remote newer",
      idempotencyKey:"parse:conflict",generation:2,attempts:2,priority:50,metadata:{},createdAt:localAt,finishedAt:remoteAt,updatedAt:remoteAt,
    });
    const putJob=vi.fn(async()=>undefined);
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list:async()=>[],save:async()=>undefined,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[remoteJob],put:putJob},
      events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    },"http");

    await initializeProductionSync();

    expect(putJob).not.toHaveBeenCalledWith(expect.objectContaining({id:"job-newer-remote",updatedAt:localAt}));
    expect(await localProductionPorts.jobs.get("job-newer-remote")).toMatchObject({status:"completed",updatedAt:remoteAt,generation:2});
  });

  it("degrades on an unavailable Production API and recovers through polling without remounting Studio",async()=>{
    vi.useFakeTimers();
    const at="2026-09-22T10:00:00.000Z";
    saveLocalProject({...demoProject,id:"local-during-outage",updatedAt:at});
    await localProductionPorts.jobs.put(EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"job-during-outage",missionId:"local-during-outage",type:"parse",status:"running",label:"Pending parse",
      idempotencyKey:"parse:outage:1",generation:1,attempts:1,priority:80,metadata:{},createdAt:at,updatedAt:at,
    }));
    const localEvent=createEvolutionEvent({id:"event-during-outage",at,missionId:"local-during-outage",type:"ActionPlanned",source:"test",payload:{offline:true}});
    await localProductionPorts.events.append(localEvent);
    expect(pendingLocalEvolutionEventCount()).toBe(1);
    const list=vi.fn()
      .mockRejectedValueOnce(new Error("Production API HTTP 401"))
      .mockResolvedValue([]);
    const save=vi.fn(async()=>undefined);
    const putJob=vi.fn(async()=>undefined);
    const appendEvent=vi.fn(async()=>undefined);
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list,save,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[],put:putJob},
      events:{...localProductionPorts.events,list:async()=>[],append:appendEvent},
    },"http");

    await expect(initializeProductionSync()).rejects.toThrow("Production API HTTP 401");
    expect(productionSyncStatus()).toMatchObject({
      mode:"http",
      initialized:true,
      realtimeStatus:"http-error",
      lastError:"Production API HTTP 401",
    });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(list).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(putJob).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(57_000);

    expect(list).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({id:"local-during-outage"}));
    expect(putJob).toHaveBeenCalledWith(expect.objectContaining({id:"job-during-outage"}));
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({id:"event-during-outage"}));
    expect(pendingLocalEvolutionEventCount()).toBe(0);
    expect(productionSyncStatus()).toMatchObject({
      mode:"http",
      initialized:true,
      realtimeStatus:"http-polling",
      lastError:undefined,
      failureCount:0,
    });
  });
});
