// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({mode:"http",start:vi.fn()}));
vi.mock("../runtime/production-runtime",()=>({productionRuntimeMode:()=>state.mode}));
vi.mock("../runtime/p3x-smoke-start",()=>({startAuthorizedP3XSmoke:state.start}));
import {P3XSmokeStart} from "./p3x-smoke-start";
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  state.mode="http";state.start.mockReset().mockResolvedValue({
    missionId:"lab-synthetic-html-task-filter-p3x-v1",status:"queued",
    runId:"run-test-1",controlJobId:"job-test-1",
  });
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=async(id="lab-synthetic-html-task-filter-p3x-v1")=>
  act(async()=>root.render(<P3XSmokeStart missionId={id}/>));
describe("P3-X manual-only actual Lab launch",()=>{
  it("never triggers models or start request on mount, only explicit button click",async()=>{
    await render();
    expect(state.start).not.toHaveBeenCalled();
    const button=host.querySelector("button")!;
    expect(button.textContent).toContain("核验门禁");
    await act(async()=>button.click());
    expect(state.start).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("job-test-1");
    expect(button.disabled).toBe(true);
    await act(async()=>button.click());
    expect(state.start).toHaveBeenCalledTimes(1);
  });
  it("renders no launch on another Mission",async()=>{
    await render("unrelated");expect(host.querySelector("button")).toBeNull();
    expect(state.start).not.toHaveBeenCalled();
  });
  it("renders no launch in local mode",async()=>{
    state.mode="local";await render();
    expect(host.querySelector("button")).toBeNull();
  });
  it("surfaces backend preflight rejection without retry",async()=>{
    state.start.mockRejectedValue(Error("LAB_EXPERIMENT_NOT_ARMED"));
    await render();
    const button=host.querySelector("button")!;
    await act(async()=>button.click());
    expect(host.textContent).toContain("LAB_EXPERIMENT_NOT_ARMED");
    expect(state.start).toHaveBeenCalledTimes(1);
  });
});
