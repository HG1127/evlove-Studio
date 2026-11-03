// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {MemoryRouter} from "react-router-dom";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {MissionControlDashboard} from "./mission-control-dashboard";

const mocks=vi.hoisted(()=>({sync:vi.fn(()=>({mode:"http",realtimeStatus:"http-error"}))}));
vi.mock("../runtime/production-sync",()=>({productionSyncStatus:mocks.sync}));
vi.mock("../runtime/use-local-projects",()=>({useLocalProjects:()=>[]}));
vi.mock("../runtime/run-manager",()=>({getLiveRun:vi.fn(),getRunTask:vi.fn(),shouldResumeTask:()=>false,subscribeLiveRuns:()=>()=>{}}));
vi.mock("../runtime/mission-review-store",()=>({MISSION_REVIEW_CHANGED_EVENT:"review-changed-fixture"}));
vi.mock("./evolution-composer",()=>({EvolutionComposer:()=>null}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  mocks.sync.mockReturnValue({mode:"http",realtimeStatus:"http-error"});
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const render=()=>act(async()=>root.render(<MemoryRouter><MissionControlDashboard/></MemoryRouter>));
const counts=()=>[...host.querySelectorAll(".tabular-nums")].map(item=>item.textContent);
describe("workbench data availability",()=>{
  it("never reports zero tasks or unattended operation when synchronization failed",async()=>{
    await render();
    expect(counts()).toEqual(["—","—","—","—"]);
    expect(host.textContent).toContain("任务数量尚未确认");
    expect(host.textContent).not.toContain("目前没有需要你处理的事项");
    expect(host.textContent).not.toContain("当前没有运行中的任务");
    expect(host.textContent).not.toContain("当前没有等待验收的成果");
  });
  it("shows an empty result only after successful synchronization and invalidates it on disconnection",async()=>{
    mocks.sync.mockReturnValue({mode:"http",realtimeStatus:"http-polling"});
    await render();expect(counts()).toEqual(["0","0","0","0"]);
    mocks.sync.mockReturnValue({mode:"http",realtimeStatus:"http-error"});
    await act(async()=>{window.dispatchEvent(new Event("evolve-production-realtime-status"));});
    expect(counts()).toEqual(["—","—","—","—"]);
    expect(host.textContent).not.toContain("目前没有需要你处理的事项");
  });
  it("allows confirmed browser-local emptiness without waiting for a remote service",async()=>{
    mocks.sync.mockReturnValue({mode:"local",realtimeStatus:"disabled"});
    await render();expect(counts()).toEqual(["0","0","0","0"]);
    expect(host.textContent).not.toContain("任务数量尚未确认");
  });
});
