import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {reviewedHoldoutFixture} from "@evolution/testkit";
import {ReviewedHoldoutPanel} from "./reviewed-holdout-panel";
const m=vi.hoisted(()=>({mode:vi.fn(),preview:vi.fn(),start:vi.fn()}));
vi.mock("../runtime/production-runtime",()=>({productionRuntimeMode:m.mode}));
vi.mock("../runtime/reviewed-holdout-client",()=>({previewReviewedHoldout:m.preview,startReviewedHoldout:m.start}));
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
const p=reviewedHoldoutFixture().project;
const binding={schemaVersion:"reviewed-holdout-binding-v1",missionId:p.id,sourceUpdatedAt:p.updatedAt,baselineId:p.baselineRun.id,
  candidateId:p.experimentRun.winnerId,frozenSha256:p.candidates[0]!.artifactSnapshots[0]!.frozenArtifact!.sha256};
const button=(text:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent?.includes(text))!;
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);m.mode.mockReturnValue("http");m.preview.mockReset();m.start.mockReset();
  m.preview.mockResolvedValue({binding,reviewNotes:["No observed violation; details insufficient."],preservationNotice:"REVIEW 保留；92、Hidden、Gate F 均不豁免。"});
  m.start.mockResolvedValue({missionId:p.id,runId:"run",controlJobId:"job",status:"queued"});
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(busy=false){await act(async()=>root.render(<ReviewedHoldoutPanel project={p} busy={busy}/>));}
async function prepare(){
  await act(async()=>button("读取").click());
  await act(async()=>{
    const textarea=host.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(textarea,"已人工复核，保留原 REVIEW 并仅继续同一冻结文件。");
    textarea.dispatchEvent(new Event("input",{bubbles:true}));
    for(const check of host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))check.click();
  });
}
describe("explicit human reviewed Holdout panel",()=>{
  it("never auto-starts, requires preview and both acknowledgements",async()=>{
    await render();expect(m.preview).not.toHaveBeenCalled();expect(m.start).not.toHaveBeenCalled();
    await act(async()=>button("读取").click());expect(button("确认").disabled).toBe(true);
    expect(host.textContent).toContain("REVIEW 保留");expect(host.textContent).toContain(binding.frozenSha256!);
  });
  it("submits one confirmed request on double-click and never claims full acceptance",async()=>{
    await render();await prepare();
    expect(button("确认").disabled).toBe(false);
    await act(async()=>{button("确认").click();button("确认").click();});
    expect(m.start).toHaveBeenCalledOnce();expect(m.start.mock.calls[0]![0]).toMatchObject({binding,preserveReview:true,preserveAcceptanceGates:true});
    expect(host.textContent).toContain("完整验收尚未完成");expect(button("确认")).toBeUndefined();
  });
  it("reuses exactly the same request key after an unknown acknowledgement",async()=>{
    m.start.mockRejectedValueOnce(new Error("ack unknown"));await render();await prepare();
    await act(async()=>button("确认").click());const first=m.start.mock.calls[0]![0];
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("相同请求键");
    await act(async()=>button("确认").click());expect(m.start.mock.calls[1]![0]).toEqual(first);
  });
  it("can recover the same request after its own reservation updates the Mission version",async()=>{
    m.start.mockRejectedValueOnce(new Error("ack unknown"));await render();await prepare();
    await act(async()=>button("确认").click());const first=m.start.mock.calls[0]![0];
    await act(async()=>root.render(<ReviewedHoldoutPanel project={{...p,updatedAt:"new-owner-reservation-version"}} busy={false}/>));
    expect(button("确认").disabled).toBe(false);
    await act(async()=>button("确认").click());expect(m.start.mock.calls[1]![0]).toEqual(first);
  });
  it("blocks stale Mission preview",async()=>{
    m.preview.mockResolvedValue({binding:{...binding,sourceUpdatedAt:"old"},reviewNotes:[],preservationNotice:"keep"});
    await render();await prepare();expect(button("确认").disabled).toBe(true);expect(m.start).not.toHaveBeenCalled();
  });
  it("does not offer cloud execution in browser-only mode",async()=>{m.mode.mockReturnValue("local");await render();expect(host.textContent).toBe("");});
  it("disables preview while another execution is busy",async()=>{await render(true);expect(button("读取").disabled).toBe(true);expect(m.preview).not.toHaveBeenCalled();});
});
