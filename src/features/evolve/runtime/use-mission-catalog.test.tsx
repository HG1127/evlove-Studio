// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {useMissionCatalog} from "./use-mission-catalog";
const mocks=vi.hoisted(()=>({read:vi.fn(),mode:"http",status:"http-connecting"}));
vi.mock("@evolution/adapters",()=>({readHttpMissionCatalog:mocks.read}));
vi.mock("./production-runtime",()=>({productionRuntimeMode:()=>mocks.mode}));
vi.mock("./production-sync",()=>({productionSyncStatus:()=>({realtimeStatus:mocks.status})}));
let host:HTMLDivElement,root:Root;const Probe=()=>{const state=useMissionCatalog();return <div>{state.snapshot?state.snapshot.entries.length:"pending"}</div>;};
const snapshot={schemaVersion:"mission-catalog-v1",workspaceId:"w",directoryComplete:true,entries:[{missionId:"one",revision:1,title:"One",updatedAt:"2026-11-03"}]};
beforeEach(()=>{(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();mocks.mode="http";mocks.status="http-connecting";mocks.read.mockReset();host=document.createElement("div");root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();});
it("loads metadata independently and clears it after canonical synchronization",async()=>{mocks.read.mockResolvedValue(snapshot);await act(async()=>root.render(<Probe/>));expect(host.textContent).toBe("1");mocks.status="http-polling";await act(async()=>window.dispatchEvent(new Event("evolve-production-realtime-status")));expect(host.textContent).toBe("pending");await act(async()=>vi.advanceTimersByTimeAsync(30_000));expect(mocks.read).toHaveBeenCalledTimes(1);});
it("aborts an in-flight metadata request on unmount",async()=>{mocks.read.mockImplementation(()=>new Promise(()=>{}));await act(async()=>root.render(<Probe/>));const signal=mocks.read.mock.calls[0][1] as AbortSignal;await act(async()=>root.render(<div/>));expect(signal.aborted).toBe(true);});
it("does not request a private directory in local mode",async()=>{mocks.mode="local";await act(async()=>root.render(<Probe/>));expect(mocks.read).not.toHaveBeenCalled();});

it("does not restore stale directory entries if an aborted request resolves after full synchronization",async()=>{let finish!:(value:typeof snapshot)=>void;mocks.read.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>root.render(<Probe/>));mocks.status="http-polling";await act(async()=>window.dispatchEvent(new Event("evolve-production-realtime-status")));await act(async()=>finish(snapshot));expect(host.textContent).toBe("pending");});
