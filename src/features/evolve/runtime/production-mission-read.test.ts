import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
import {readProductionMission} from "./production-mission-read";
import {configureProductionRuntime,resetProductionRuntime} from "./production-runtime";
import {localProductionPorts} from "./local-production-adapters";
import {getLocalProject,saveLocalProject,deleteLocalProject} from "./local-store";
import {missionSyncJournal,updateMissionSyncJournal} from "./project-database";
import {initializeProductionSync,stopProductionSync} from "./production-sync";
const point=vi.fn(),save=vi.fn(),list=vi.fn(async()=>[]);
beforeEach(()=>{window.localStorage.clear();vi.useFakeTimers();point.mockReset();save.mockReset();list.mockClear();configureProductionRuntime({...localProductionPorts,missions:{...localProductionPorts.missions,list,get:point,save},jobs:{...localProductionPorts.jobs,list:async()=>[]},events:{...localProductionPorts.events,list:async()=>[]}},"http");});
afterEach(async()=>{await stopProductionSync();resetProductionRuntime();window.localStorage.clear();vi.useRealTimers();});
it("opens one complete Mission without waiting for a collection or writing it back",async()=>{
 await initializeProductionSync();const before=list.mock.calls.length,project={...demoProject,id:"point-only",updatedAt:"2026-11-03T10:00:00Z"};point.mockResolvedValue(project);
 expect((await readProductionMission(project.id))?.id).toBe(project.id);expect(getLocalProject(project.id)?.id).toBe(project.id);expect(missionSyncJournal().knownRemoteIds).toContain(project.id);
 await vi.advanceTimersByTimeAsync(350);expect(list).toHaveBeenCalledTimes(before);expect(save).not.toHaveBeenCalled();
});
it("preserves a newer local draft",async()=>{const local={...demoProject,id:"point-newer",name:"Newer draft",updatedAt:"2026-11-03T12:00:00Z"};saveLocalProject(local);point.mockResolvedValue({...local,name:"Old server",updatedAt:"2026-11-03T10:00:00Z"});expect((await readProductionMission(local.id))?.name).toBe("Newer draft");});
it.each(["deleted","cancelled"])("does not store a receipt after it is %s while in flight",async reason=>{
 const project={...demoProject,id:"point-"+reason};let finish!:(value:typeof project)=>void;point.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const controller=new AbortController(),pending=readProductionMission(project.id,controller.signal);
 if(reason==="deleted")deleteLocalProject(project.id);else controller.abort();finish(project);expect(await pending).toBeUndefined();expect(getLocalProject(project.id)).toBeUndefined();
});
it("removes a known remotely deleted record but keeps a new unsaved draft",async()=>{
 const known={...demoProject,id:"point-missing-known"},draft={...demoProject,id:"point-unsaved"};saveLocalProject(known);saveLocalProject(draft);updateMissionSyncJournal(value=>({...value,knownRemoteIds:[known.id]}));point.mockResolvedValue(undefined);
 expect(await readProductionMission(known.id)).toBeUndefined();expect(getLocalProject(known.id)).toBeUndefined();expect((await readProductionMission(draft.id))?.id).toBe(draft.id);
});
it("rejects a point identity mismatch before caching",async()=>{point.mockResolvedValue({...demoProject,id:"wrong-point"});await expect(readProductionMission("expected-point")).rejects.toThrow("identity mismatch");expect(getLocalProject("wrong-point")).toBeUndefined();});
