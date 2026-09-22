import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
import {saveLocalProject} from "./local-store";
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

  it("degrades on an unavailable Production API and recovers through polling without remounting Studio",async()=>{
    vi.useFakeTimers();
    saveLocalProject({...demoProject,id:"local-during-outage",updatedAt:"2026-09-22T10:00:00.000Z"});
    const list=vi.fn()
      .mockRejectedValueOnce(new Error("Production API HTTP 401"))
      .mockResolvedValue([]);
    const save=vi.fn(async()=>undefined);
    configureProductionRuntime({
      ...localProductionPorts,
      missions:{...localProductionPorts.missions,list,save,delete:async()=>undefined},
      jobs:{...localProductionPorts.jobs,list:async()=>[]},
      events:{...localProductionPorts.events,list:async()=>[]},
    },"http");

    await expect(initializeProductionSync()).rejects.toThrow("Production API HTTP 401");
    expect(productionSyncStatus()).toMatchObject({
      mode:"http",
      initialized:true,
      realtimeStatus:"http-error",
      lastError:"Production API HTTP 401",
    });

    await vi.advanceTimersByTimeAsync(3_000);

    expect(list).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({id:"local-during-outage"}));
    expect(productionSyncStatus()).toMatchObject({
      mode:"http",
      initialized:true,
      realtimeStatus:"http-polling",
      lastError:undefined,
    });
  });
});
