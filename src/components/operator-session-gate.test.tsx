// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {OperatorSessionGate} from "./operator-session-gate";

const mocks=vi.hoisted(()=>({
  getSession:vi.fn(),
  configure:vi.fn(),
  initialize:vi.fn(async()=>undefined),
  stop:vi.fn(async()=>undefined),
  logout:vi.fn(async()=>({configured:true,authenticated:false})),
  syncStatus:vi.fn(()=>({realtimeStatus:"http-polling",lastError:undefined as string|undefined})),
}));

vi.mock("@/features/evolve/runtime/production-runtime",()=>({
  productionRuntimeMode:()=>"http",configureProductionRuntime:mocks.configure,
}));
vi.mock("@/features/evolve/runtime/local-production-adapters",()=>({localProductionPorts:{}}));
vi.mock("@/features/evolve/runtime/production-sync",()=>({
  initializeProductionSync:mocks.initialize,stopProductionSync:mocks.stop,
  productionSyncStatus:mocks.syncStatus,
}));
vi.mock("@/features/evolve/runtime/operator-session-client",()=>({
  getOperatorSession:mocks.getSession,loginOperator:vi.fn(),logoutOperator:mocks.logout,
}));

beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  for(const mock of Object.values(mocks))mock.mockClear();
  mocks.syncStatus.mockReturnValue({realtimeStatus:"http-polling",lastError:undefined});
});
afterEach(()=>{document.body.innerHTML="";});

describe("production operator session gate",()=>{
  it("holds the app until a session exists and offers explicit browser-local mode",async()=>{
    mocks.getSession.mockResolvedValue({configured:false,authenticated:false});
    const host=document.createElement("div");document.body.append(host);
    const root=createRoot(host);
    await act(async()=>root.render(<OperatorSessionGate><div>工作台内容</div></OperatorSessionGate>));
    expect(host.textContent).toContain("后端访问尚未就绪");
    expect(host.textContent).not.toContain("工作台内容");
    await act(async()=>{
      [...host.querySelectorAll("button")].find((button)=>button.textContent?.includes("仅在此浏览器继续"))?.click();
    });
    expect(host.textContent).toContain("工作台内容");
    expect(host.textContent).toContain("本地模式");
    expect(mocks.configure).toHaveBeenCalledOnce();
    await act(async()=>root.unmount());
  });

  it("shows backend sync failures instead of claiming a healthy connection",async()=>{
    mocks.getSession.mockResolvedValue({configured:true,authenticated:true});
    const host=document.createElement("div");document.body.append(host);
    const root=createRoot(host);
    await act(async()=>root.render(<OperatorSessionGate><div>工作台内容</div></OperatorSessionGate>));
    expect(host.textContent).toContain("后端同步正常");
    expect(mocks.initialize).toHaveBeenCalledOnce();
    mocks.syncStatus.mockReturnValue({realtimeStatus:"http-error",lastError:"HTTP 503"});
    await act(async()=>window.dispatchEvent(new Event("evolve-production-realtime-status")));
    expect(host.textContent).toContain("后端同步失败：HTTP 503");
    await act(async()=>root.unmount());
  });
});
