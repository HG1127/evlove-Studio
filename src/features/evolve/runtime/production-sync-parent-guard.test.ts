import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
import {EvolutionJobSchema} from "./job-contract";
import {createEvolutionEvent,pendingLocalEvolutionEventCount} from "./event-contract";
import {localProductionPorts} from "./local-production-adapters";
import {configureProductionRuntime,resetProductionRuntime} from "./production-runtime";
import {initializeProductionSync,stopProductionSync} from "./production-sync";

const at="2026-09-22T10:00:00.000Z";
function job(missionId:string,id="local-offline-job"){
  return EvolutionJobSchema.parse({
    schemaVersion:"job-v1",id,missionId,type:"parse",status:"queued",
    label:"Offline job",idempotencyKey:"offline:"+id,generation:1,attempts:0,
    priority:50,metadata:{},createdAt:at,updatedAt:at,
  });
}
const project=(id:string)=>({...demoProject,id});
beforeEach(()=>{window.localStorage.clear();vi.useFakeTimers();});
afterEach(async()=>{
  await stopProductionSync();
  resetProductionRuntime();
  window.localStorage.clear();vi.useRealTimers();
});
describe("P3-AG remote-parent admission for browser job and event outboxes",()=>{
  it("retains orphan Job and Event until a real Mission receipt arrives",async()=>{
    const parent="not-yet-registered";
    const localJob=job(parent);
    await localProductionPorts.jobs.put(localJob);
    await localProductionPorts.events.append(createEvolutionEvent({
      id:"local-orphan-event",at,missionId:parent,type:"ActionPlanned",
      source:"unit-test",payload:{offline:true},
    }));
    let remoteMissions:ReturnType<typeof project>[]=[];
    const putJob=vi.fn(async()=>undefined),appendEvent=vi.fn(async()=>undefined);
    configureProductionRuntime({...localProductionPorts,
      missions:{...localProductionPorts.missions,list:async()=>remoteMissions,save:async()=>undefined,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[],put:putJob},
      events:{...localProductionPorts.events,list:async()=>[],append:appendEvent},
    },"http");

    await initializeProductionSync();
    expect(putJob).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();
    expect(pendingLocalEvolutionEventCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(putJob).not.toHaveBeenCalled();
    expect(appendEvent).not.toHaveBeenCalled();

    remoteMissions=[project(parent)];
    await vi.advanceTimersByTimeAsync(3_000);
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({id:"local-orphan-event",missionId:parent}));
    expect(pendingLocalEvolutionEventCount()).toBe(0);
    window.dispatchEvent(new Event("evolve-parse-job-changed"));
    await vi.advanceTimersByTimeAsync(300);
    expect(putJob).toHaveBeenCalledWith(expect.objectContaining({id:localJob.id,missionId:parent}));
  });

  it("does not overwrite a server Job with an unrelated parent identity",async()=>{
    const parent="registered-parent",localJob=job(parent,"cross-parent-collision");
    await localProductionPorts.jobs.put({...localJob,updatedAt:"2026-09-22T10:05:00.000Z",generation:2});
    const remoteJob=job("different-parent",localJob.id);
    const putJob=vi.fn(async()=>undefined);
    configureProductionRuntime({...localProductionPorts,
      missions:{...localProductionPorts.missions,list:async()=>[project(parent)],save:async()=>undefined,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[remoteJob],put:putJob},
      events:{...localProductionPorts.events,list:async()=>[]},
    },"http");
    await initializeProductionSync();
    expect(putJob).not.toHaveBeenCalled();
  });


  it("does not upload an unbound Job even when a different Mission exists",async()=>{
    const localJob=EvolutionJobSchema.parse({...job("registered-parent","unbound-job"),missionId:undefined});
    await localProductionPorts.jobs.put(localJob);
    const putJob=vi.fn(async()=>undefined);
    configureProductionRuntime({...localProductionPorts,
      missions:{...localProductionPorts.missions,list:async()=>[project("registered-parent")],save:async()=>undefined,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[],put:putJob},
      events:{...localProductionPorts.events,list:async()=>[]},
    },"http");
    await initializeProductionSync();
    expect(putJob).not.toHaveBeenCalled();
  });

  it("refuses a Job-bound Event lacking an explicit parent, but retains global audit events",async()=>{
    await localProductionPorts.events.append(createEvolutionEvent({
      id:"orphan-job-event",at,jobId:"missing-job",source:"unit-test",
      type:"ActionPlanned",payload:{reason:"not enough parent evidence"},
    }));
    await localProductionPorts.events.append(createEvolutionEvent({
      id:"global-audit-event",at,source:"unit-test",
      type:"ActionPlanned",payload:{scope:"global"},
    }));
    const appendEvent=vi.fn(async()=>undefined);
    configureProductionRuntime({...localProductionPorts,
      missions:{...localProductionPorts.missions,list:async()=>[],save:async()=>undefined,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[]},
      events:{...localProductionPorts.events,list:async()=>[],append:appendEvent},
    },"http");
    await initializeProductionSync();
    expect(appendEvent).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({id:"global-audit-event"}));
    expect(pendingLocalEvolutionEventCount()).toBe(1);
  });
});
