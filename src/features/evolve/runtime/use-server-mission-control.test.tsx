import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {MissionControlInspection} from "./server-mission-control-client";

const mock=vi.hoisted(()=>({inspect:vi.fn()}));
vi.mock("./server-mission-control-client",()=>({inspectServerMissionControl:mock.inspect}));
import {useServerMissionControlStatus} from "./use-server-mission-control";

type Pending={
  missionId:string;signal:AbortSignal;resolve:(value:MissionControlInspection)=>void;
};
const pending:Pending[]=[];
function result(missionId:string,state:MissionControlInspection["state"]="active"):MissionControlInspection{
  return {missionId,revision:4,stage:"target",campaignStatus:"idle",
    candidateCount:0,acceptedOutputs:0,state,reason:"test durable state"};
}
function Probe({missionId="audit-a",enabled=true}:{missionId?:string;enabled?:boolean}){
  const status=useServerMissionControlStatus(missionId,enabled);
  return createElement("section",null,
    createElement("span",{"data-testid":"loading"},status.checking?"loading":"settled"),
    createElement("span",{"data-testid":"state"},status.error??status.inspection?.state??"none"),
    createElement("span",{"data-testid":"mission"},status.inspection?.missionId??"none"),
    createElement("button",{onClick:status.refresh},"refresh"),
  );
}
let host:HTMLDivElement,root:Root;
beforeEach(()=>{
  pending.length=0;
  mock.inspect.mockReset().mockImplementation((missionId:string,signal:AbortSignal)=>new Promise<MissionControlInspection>((resolve,reject)=>{
    const item={missionId,signal,resolve};
    pending.push(item);
    if(signal.aborted){reject(new DOMException("Aborted","AbortError"));return;}
    signal.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true});
  }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{
  await act(async()=>root.unmount());
  host.remove();vi.unstubAllGlobals();vi.useRealTimers();
});
const text=(id:string)=>host.querySelector(`[data-testid="${id}"]`)?.textContent;
async function render(props:{missionId?:string;enabled?:boolean}={}){
  await act(async()=>{root.render(createElement(Probe,props));await Promise.resolve();});
}
describe("single-flight durable Mission status refresh",()=>{
  it("immediately shows loading and aborts the previous request on manual refresh",async()=>{
    await render();
    expect(pending).toHaveLength(1);
    expect(text("loading")).toBe("loading");
    const first=pending[0]!;
    await act(async()=>{
      host.querySelector("button")!.dispatchEvent(new MouseEvent("click",{bubbles:true}));
      await Promise.resolve();
    });
    expect(first.signal.aborted).toBe(true);
    expect(pending).toHaveLength(2);
    expect(pending[1]!.signal.aborted).toBe(false);
    expect(text("loading")).toBe("loading");
    expect(text("state")).toBe("none");
    await act(async()=>{pending[1]!.resolve(result("audit-a"));await Promise.resolve();});
    expect(text("loading")).toBe("settled");
    expect(text("state")).toBe("active");
    expect(text("mission")).toBe("audit-a");
  });
  it("does not poll again while a request is pending and schedules the next read only after settlement",async()=>{
    vi.useFakeTimers();
    await render();
    expect(pending).toHaveLength(1);
    await act(async()=>{await vi.advanceTimersByTimeAsync(60_000);});
    expect(pending).toHaveLength(1);
    await act(async()=>{pending[0]!.resolve(result("audit-a"));await Promise.resolve();});
    await act(async()=>{await vi.advanceTimersByTimeAsync(29_999);});
    expect(pending).toHaveLength(1);
    await act(async()=>{await vi.advanceTimersByTimeAsync(1);await Promise.resolve();});
    expect(pending).toHaveLength(2);
    expect(pending[1]!.signal.aborted).toBe(false);
  });
  it("never displays an old Mission's result while the route changes",async()=>{
    await render({missionId:"audit-a"});
    await act(async()=>{pending[0]!.resolve(result("audit-a"));await Promise.resolve();});
    expect(text("mission")).toBe("audit-a");
    await act(async()=>{root.render(createElement(Probe,{missionId:"audit-b"}));await Promise.resolve();});
    expect(text("loading")).toBe("loading");
    expect(text("mission")).toBe("none");
    expect(pending).toHaveLength(2);
    expect(pending[0]!.signal.aborted).toBe(true);
  });
});
