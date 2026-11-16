// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({mode:"http",binding:vi.fn()}));
vi.mock("../runtime/production-runtime",()=>({productionRuntimeMode:()=>state.mode}));
vi.mock("../runtime/p3x-source-binding",()=>({
  P3X_MISSION_ID:"lab-synthetic-html-task-filter-p3x-v1",
  registerAndBindP3XSource:state.binding,
}));
import {P3XSourceBinding} from "./p3x-source-binding";

let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  state.mode="http";
  state.binding.mockReset().mockResolvedValue({
    state:"bound",revision:2,blobId:"p3y-synthetic-task-board-original",
  });
});
afterEach(async()=>{
  await act(async()=>root.unmount());
  host.remove();vi.unstubAllGlobals();
});
const render=async(id="lab-synthetic-html-task-filter-p3x-v1")=>
  act(async()=>root.render(<P3XSourceBinding missionId={id}/>));
describe("P3-X explicitly scoped source binding UI",()=>{
  it("only starts operator-requested source registration, never a model or Workflow call",async()=>{
    await render();
    expect(state.binding).not.toHaveBeenCalled();
    const button=host.querySelector("button")!;
    expect(button.textContent).toContain("不启动模型");
    await act(async()=>button.click());
    expect(state.binding).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Mission revision 2");
    expect(host.textContent).toContain("请刷新此任务");
  });
  it("does not surface the operator action on unrelated Missions",async()=>{
    await render("another-mission");
    expect(host.querySelector("button")).toBeNull();
    expect(state.binding).not.toHaveBeenCalled();
  });
  it("does not surface the operator action in the local prototype",async()=>{
    state.mode="local";await render();
    expect(host.querySelector("button")).toBeNull();
    expect(state.binding).not.toHaveBeenCalled();
  });
});
