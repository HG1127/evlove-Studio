import {beforeEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";

const state=vi.hoisted(()=>({mode:"local" as "local"|"http",stored:[] as unknown[],removed:false, status:"disabled",confirmed:[] as string[],deleting:[] as string[]}));
vi.mock("./local-store",()=>({
  listLocalProjects:()=>state.stored,
  isDemoRemoved:()=>state.removed,
}));
vi.mock("./production-runtime",()=>({productionRuntimeMode:()=>state.mode}));
vi.mock("./production-sync",()=>({productionSyncStatus:()=>({realtimeStatus:state.status})}));
vi.mock("./project-database",()=>({missionSyncJournal:()=>({knownRemoteIds:state.confirmed,pendingDeleteIds:state.deleting})}));
import {composeProjects} from "./use-local-projects";

beforeEach(()=>{state.mode="local";state.stored=[];state.removed=false;state.status="disabled";state.confirmed=[];state.deleting=[];});

describe("real-vs-demo project source in production",()=>{
  it("shows built-in demo only in the local prototype and only once",()=>{
    expect(composeProjects().map(project=>project.id)).toEqual(["demo"]);
    state.stored=[demoProject];
    expect(composeProjects().map(project=>project.id)).toEqual(["demo"]);
    state.removed=true;state.stored=[];
    expect(composeProjects()).toEqual([]);
  });

  it("never promotes mock or persisted demo data into the HTTP Mission catalog",()=>{
    state.mode="http";
    const real={...demoProject,id:"server-mission",name:"Actual Mission"};
    const stale={...demoProject,id:"old-local",name:"Cached but not registered"};
    state.stored=[demoProject,real,stale];
    // A cache entry is not proof that this server knows the Mission.
    expect(composeProjects()).toEqual([]);
    state.confirmed=["server-mission"];
    expect(composeProjects(true)).toEqual([]);
    state.status="http-polling";
    expect(composeProjects().map(project=>project.id)).toEqual(["server-mission"]);
    expect(composeProjects(true).map(project=>project.id)).toEqual(["server-mission"]);
    state.deleting=["server-mission"];
    expect(composeProjects()).toEqual([]);
    state.deleting=[];
    state.stored=[];
    expect(composeProjects()).toEqual([]);
  });

  it("fails closed when production sync is interrupted after a cached server Mission was previously seen",()=>{
    state.mode="http";state.status="http-polling";
    state.confirmed=["server-mission"];state.stored=[{...demoProject,id:"server-mission"}];
    expect(composeProjects().map(project=>project.id)).toEqual(["server-mission"]);
    state.status="http-error";
    expect(composeProjects()).toEqual([]);
    state.status="http-polling";
    state.confirmed=[];
    expect(composeProjects()).toEqual([]);
  });

  it("honors an explicit demo opt-out in local mode without changing real projects",()=>{
    state.stored=[demoProject,{...demoProject,id:"real-local"}];
    expect(composeProjects(false).map(project=>project.id)).toEqual(["real-local"]);
  });
});
