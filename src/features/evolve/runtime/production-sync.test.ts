import {MissionRevisionConflictError} from "@evolution/adapters";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
import {deleteLocalProject,getLocalProject,saveLocalProject} from "./local-store";
import {missionSyncJournal} from "./project-database";
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

  it("keeps a persisted terminal Job authoritative over a later local timestamp in the same generation",async()=>{
    vi.useFakeTimers();
    const remoteAt="2026-09-22T10:00:00.000Z";
    const localAt="2026-09-22T10:10:00.000Z";
    await localProductionPorts.jobs.put(EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"job-terminal-remote",missionId:"m1",type:"parse",status:"running",label:"Local stale running",
      idempotencyKey:"parse:terminal",generation:3,attempts:3,priority:50,metadata:{},createdAt:remoteAt,updatedAt:localAt,
    }));
    const remoteJob=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"job-terminal-remote",missionId:"m1",type:"parse",status:"cancelled",label:"Remote cancelled",
      idempotencyKey:"parse:terminal",generation:3,attempts:3,priority:50,metadata:{},createdAt:remoteAt,finishedAt:remoteAt,updatedAt:remoteAt,
    });
    const putJob=vi.fn(async()=>undefined);
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list:async()=>[],save:async()=>undefined,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[remoteJob],put:putJob},
      events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    },"http");

    await initializeProductionSync();

    expect(putJob).not.toHaveBeenCalled();
    expect(await localProductionPorts.jobs.get("job-terminal-remote")).toMatchObject({
      status:"cancelled",generation:3,updatedAt:remoteAt,
    });
  });

  it("pushes a higher local Job generation even when the remote lower generation is terminal",async()=>{
    vi.useFakeTimers();
    const remoteAt="2026-09-22T10:00:00.000Z";
    const localAt="2026-09-22T10:01:00.000Z";
    const localJob=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"job-retry-generation",missionId:"m1",type:"parse",status:"queued",label:"Retry",
      idempotencyKey:"parse:retry",generation:4,attempts:4,priority:50,metadata:{},createdAt:remoteAt,updatedAt:localAt,
    });
    await localProductionPorts.jobs.put(localJob);
    const remoteJob=EvolutionJobSchema.parse({
      ...localJob,status:"failed",generation:3,attempts:3,error:"old failure",finishedAt:remoteAt,updatedAt:remoteAt,
    });
    const putJob=vi.fn(async()=>undefined);
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list:async()=>[],save:async()=>undefined,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[remoteJob],put:putJob},
      events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    },"http");

    await initializeProductionSync();

    expect(putJob).toHaveBeenCalledWith(expect.objectContaining({
      id:"job-retry-generation",generation:4,status:"queued",
    }));
  });

  it("treats a Mission CAS conflict as remote-authoritative even when local updatedAt is newer",async()=>{
    vi.useFakeTimers();
    const remoteAt="2026-09-22T10:00:00.000Z";
    const localAt="2026-09-22T10:05:00.000Z";
    const remote={...demoProject,id:"mission-revision-conflict",name:"Remote authoritative",updatedAt:remoteAt};
    const local={...remote,name:"Local stale edit",updatedAt:localAt};
    saveLocalProject(local);

    const list=vi.fn(async()=>[remote]);
    const save=vi.fn(async()=>{
      throw new MissionRevisionConflictError(
        "mission-revision-conflict",4,
        "Mission mission-revision-conflict revision conflict: expected 4, current 5",
      );
    });
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list,save,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[],put:async()=>undefined},
      events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    },"http");

    await initializeProductionSync();
    expect(productionSyncStatus()).toMatchObject({
      realtimeStatus:"http-conflict",
      missionConflictCount:1,
    });
    expect(getLocalProject("mission-revision-conflict")?.name).toBe("Local stale edit");

    await vi.advanceTimersByTimeAsync(0);

    expect(list).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(getLocalProject("mission-revision-conflict")?.name).toBe("Remote authoritative");
    expect(productionSyncStatus()).toMatchObject({
      realtimeStatus:"http-polling",
      missionConflictCount:0,
    });
  });

  it("treats Data Plane 503 as a short transient outage while preserving local Studio state",async()=>{
    vi.useFakeTimers();
    const local={...demoProject,id:"local-data-plane-503",name:"Local survives 503",updatedAt:"2026-09-22T10:00:00.000Z"};
    saveLocalProject(local);

    const list=vi.fn()
      .mockRejectedValueOnce(new Error("Production API HTTP 503: SERVER_DATA_PLANE_UNAVAILABLE"))
      .mockResolvedValue([]);
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list,save:async()=>undefined,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[],put:async()=>undefined},
      events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    },"http");

    await expect(initializeProductionSync()).rejects.toThrow("SERVER_DATA_PLANE_UNAVAILABLE");
    expect(getLocalProject("local-data-plane-503")?.name).toBe("Local survives 503");
    expect(productionSyncStatus()).toMatchObject({
      mode:"http",
      initialized:true,
      realtimeStatus:"http-error",
      failureCount:1,
      lastError:"Production API HTTP 503: SERVER_DATA_PLANE_UNAVAILABLE",
    });

    await vi.advanceTimersByTimeAsync(2_999);
    expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(list).toHaveBeenCalledTimes(2);
    expect(getLocalProject("local-data-plane-503")?.name).toBe("Local survives 503");
    expect(productionSyncStatus()).toMatchObject({
      realtimeStatus:"http-polling",
      failureCount:0,
      lastError:undefined,
    });
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
  it("does not resurrect a Mission deleted remotely on polling or after a restart",async()=>{
    vi.useFakeTimers();
    const project={...demoProject,id:"mission-remote-delete",updatedAt:"2026-09-22T10:00:00.000Z"};
    let remote=[project];
    const save=vi.fn(async()=>undefined);
    const list=vi.fn(async()=>remote);
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list,save,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[],put:async()=>undefined},
      events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    },"http");
    await initializeProductionSync();
    expect(getLocalProject(project.id)).toBeDefined();
    expect(missionSyncJournal().knownRemoteIds).toContain(project.id);
    remote=[];
    await vi.advanceTimersByTimeAsync(3_000);
    expect(getLocalProject(project.id)).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it("does not recreate a remotely deleted Mission on cold startup",async()=>{
    vi.useFakeTimers();
    const project={...demoProject,id:"mission-deleted-before-restart",updatedAt:"2026-09-22T10:00:00.000Z"};
    let remote=[project];
    const save=vi.fn(async()=>undefined);
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list:async()=>remote,save,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[],put:async()=>undefined},
      events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    },"http");
    await initializeProductionSync();
    await stopProductionSync();
    remote=[];
    await initializeProductionSync();
    expect(getLocalProject(project.id)).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    expect(missionSyncJournal().knownRemoteIds).not.toContain(project.id);
  });

  it("does not rehydrate a deletion made while a poll awaits other server data",async()=>{
    vi.useFakeTimers();
    const project={...demoProject,id:"mission-deleted-during-poll",updatedAt:"2026-09-22T10:00:00.000Z"};
    let releaseJobs:((jobs:never[])=>void)|undefined;
    let delayJobs=false;
    const jobsList=vi.fn(()=>delayJobs
      ?new Promise<never[]>((resolve)=>{releaseJobs=resolve;})
      :Promise.resolve([]));
    const remove=vi.fn(async()=>undefined);
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list:async()=>[project],save:async()=>undefined,delete:remove},
      jobs:{...localProductionPorts.jobs,list:jobsList,put:async()=>undefined},
      events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    },"http");
    await initializeProductionSync();
    delayJobs=true;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(jobsList).toHaveBeenCalledTimes(2);
    deleteLocalProject(project.id);
    releaseJobs!([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getLocalProject(project.id)).toBeUndefined();
    expect(remove).toHaveBeenCalledWith(project.id);
  });
  it("restores the newer server Mission after a delete revision conflict",async()=>{
    vi.useFakeTimers();
    const project={...demoProject,id:"mission-delete-conflict",updatedAt:"2026-09-22T10:00:00.000Z"};
    const save=vi.fn(async()=>undefined);
    const remove=vi.fn(async()=>{throw new MissionRevisionConflictError(project.id,2);});
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list:async()=>[project],save,delete:remove},
      jobs:{...localProductionPorts.jobs,list:async()=>[],put:async()=>undefined},
      events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    },"http");
    await initializeProductionSync();
    deleteLocalProject(project.id);
    await vi.advanceTimersByTimeAsync(350);
    expect(productionSyncStatus().realtimeStatus).toBe("http-conflict");
    expect(missionSyncJournal().pendingDeleteIds).not.toContain(project.id);
    await vi.advanceTimersByTimeAsync(1);
    expect(getLocalProject(project.id)?.id).toBe(project.id);
    expect(save).not.toHaveBeenCalled();
  });
  it("keeps a failed remote delete pending and retries after data-plane recovery",async()=>{
    vi.useFakeTimers();
    const project={...demoProject,id:"mission-delete-retry",updatedAt:"2026-09-22T10:00:00.000Z"};
    let remote=[project];
    const remove=vi.fn()
      .mockRejectedValueOnce(new Error("Production API HTTP 503"))
      .mockImplementation(async(id:string)=>{remote=remote.filter((item)=>item.id!==id);});
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list:async()=>remote,save:async()=>undefined,delete:remove},
      jobs:{...localProductionPorts.jobs,list:async()=>[],put:async()=>undefined},
      events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    },"http");
    await initializeProductionSync();
    deleteLocalProject(project.id);
    await vi.advanceTimersByTimeAsync(350);
    expect(productionSyncStatus().realtimeStatus).toBe("http-error");
    expect(missionSyncJournal().pendingDeleteIds).toContain(project.id);
    expect(getLocalProject(project.id)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(missionSyncJournal().pendingDeleteIds).not.toContain(project.id);
    expect(getLocalProject(project.id)).toBeUndefined();
  });
  it("replays an offline local deletion after sync restarts without rehydrating it",async()=>{
    vi.useFakeTimers();
    const project={...demoProject,id:"mission-pending-delete",updatedAt:"2026-09-22T10:00:00.000Z"};
    let remote=[project];
    const save=vi.fn(async()=>undefined);
    const remove=vi.fn(async(id:string)=>{remote=remote.filter((item)=>item.id!==id);});
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list:async()=>remote,save,delete:remove},
      jobs:{...localProductionPorts.jobs,list:async()=>[],put:async()=>undefined},
      events:{...localProductionPorts.events,list:async()=>[],append:async()=>undefined},
    },"http");
    await initializeProductionSync();
    deleteLocalProject(project.id);
    expect(getLocalProject(project.id)).toBeUndefined();
    expect(missionSyncJournal().pendingDeleteIds).toContain(project.id);
    await stopProductionSync();
    await initializeProductionSync();
    expect(remove).toHaveBeenCalledWith(project.id);
    expect(getLocalProject(project.id)).toBeUndefined();
    expect(missionSyncJournal().pendingDeleteIds).not.toContain(project.id);
    expect(save).not.toHaveBeenCalled();
  });
});
