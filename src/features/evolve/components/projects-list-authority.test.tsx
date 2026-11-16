// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";

const state=vi.hoisted(()=>({mode:"http" as "http"|"local",status:"http-polling",verified:[] as unknown[],cached:[] as unknown[],pending:[] as string[],markCreate:vi.fn()}));
vi.mock("../runtime/use-local-projects",()=>({useLocalProjects:()=>state.verified}));
vi.mock("../runtime/use-production-sync-status",()=>({useProductionSyncStatus:()=>({mode:state.mode,realtimeStatus:state.status})}));
vi.mock("../runtime/project-database",()=>({missionSyncJournal:()=>({knownRemoteIds:[],pendingDeleteIds:[],pendingCreateIds:state.pending}),markExplicitMissionCreation:state.markCreate}));
vi.mock("../runtime/local-store",()=>({
  listLocalProjects:()=>state.cached,
  directoryRemovedMissionIds:()=>new Set<string>(),
  saveLocalProject:vi.fn(),deleteLocalProject:vi.fn(),markDemoRemoved:vi.fn(),
}));
vi.mock("../runtime/run-manager",()=>({
  getLiveRun:()=>undefined,getRunTask:()=>undefined,shouldResumeTask:()=>false,subscribeLiveRuns:()=>()=>{},
}));
import {ProjectsList} from "./projects-list";

let host:HTMLDivElement,root:Root;
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  localStorage.clear();
  state.mode="http";state.status="http-polling";state.verified=[];state.cached=[];state.pending=[];state.markCreate.mockReset();
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove()});
const render=()=>act(async()=>root.render(<MemoryRouter><ProjectsList/></MemoryRouter>));

describe("P3-AE production Mission data provenance",()=>{
  const ghost={...demoProject,id:"legacy-cache",name:"Old browser-only project"};
  const real={...demoProject,id:"server-backed",name:"Actual remote Mission"};

  it("isolates stale browser records from server totals and navigable Mission links",async()=>{
    state.cached=[ghost];
    await render();
    expect(host.textContent).toContain("共 0 个项目");
    expect(host.textContent).toContain("浏览器缓存／待同步草稿（1）");
    expect(host.textContent).toContain("Old browser-only project");
    expect(host.querySelector('a[href="/projects/legacy-cache"]')).toBeNull();
    expect([...host.querySelectorAll("button")].some(button=>button.textContent?.includes("导出"))).toBe(true);
  });

  it("counts and links only confirmed Missions while retaining unconfirmed draft recovery",async()=>{
    state.verified=[real];state.cached=[real,ghost];
    await render();
    expect(host.textContent).toContain("共 1 个项目");
    expect(host.querySelector('a[href="/projects/server-backed"]')).not.toBeNull();
    expect(host.querySelector('a[href="/projects/legacy-cache"]')).toBeNull();
    expect(host.textContent).toContain("浏览器缓存／待同步草稿（1）");
  });

  it("requires two distinct user actions before requesting registration of a cached draft",async()=>{
    state.cached=[ghost];
    await render();
    const buttons=[...host.querySelectorAll("button")];
    const first=buttons.find(button=>button.textContent?.includes("登记为新任务"))!;
    expect(first).toBeTruthy();
    expect(state.markCreate).not.toHaveBeenCalled();
    await act(async()=>first.click());
    expect(host.textContent).toContain("确认登记为新的服务端 Mission");
    expect(state.markCreate).not.toHaveBeenCalled();
    const confirm=[...host.querySelectorAll("button")].find(button=>button.textContent?.includes("确认登记"))!;
    await act(async()=>confirm.click());
    expect(state.markCreate).toHaveBeenCalledExactlyOnceWith("legacy-cache");
    expect(host.textContent).toContain("已加入待登记队列");
  });

  it("does not allow registration while the server Mission catalog is unverified",async()=>{
    state.status="http-error";state.cached=[ghost];
    await render();
    expect([...host.querySelectorAll("button")].some(button=>button.textContent?.includes("登记为新任务"))).toBe(false);
    expect(state.markCreate).not.toHaveBeenCalled();
  });

  it("never equates a sync outage with a confirmed empty server directory",async()=>{
    state.status="http-error";state.cached=[ghost];
    await render();
    expect(host.textContent).toContain("服务端 Mission 尚未完成同步核验");
    expect(host.textContent).toContain("正在等待服务端项目核验");
    expect(host.querySelector('a[href="/projects/legacy-cache"]')).toBeNull();
  });
});
