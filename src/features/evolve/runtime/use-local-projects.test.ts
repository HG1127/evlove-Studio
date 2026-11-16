import {beforeEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";

const state=vi.hoisted(()=>({mode:"local" as "local"|"http",stored:[] as unknown[],removed:false}));
vi.mock("./local-store",()=>({
  listLocalProjects:()=>state.stored,
  isDemoRemoved:()=>state.removed,
}));
vi.mock("./production-runtime",()=>({productionRuntimeMode:()=>state.mode}));
import {composeProjects} from "./use-local-projects";

beforeEach(()=>{state.mode="local";state.stored=[];state.removed=false;});

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
    state.stored=[demoProject,real];
    expect(composeProjects().map(project=>project.id)).toEqual(["server-mission"]);
    expect(composeProjects(true).map(project=>project.id)).toEqual(["server-mission"]);
    state.stored=[];
    expect(composeProjects()).toEqual([]);
  });

  it("honors an explicit demo opt-out in local mode without changing real projects",()=>{
    state.stored=[demoProject,{...demoProject,id:"real-local"}];
    expect(composeProjects(false).map(project=>project.id)).toEqual(["real-local"]);
  });
});
