import {act,useState} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {EvolveProject} from "../schemas";
const records=vi.hoisted(()=>new Map<string,EvolveProject>());
const remote=vi.hoisted(()=>({mode:"local",read:vi.fn()}));
vi.mock("../runtime/production-runtime",()=>({productionRuntimeMode:()=>remote.mode}));
vi.mock("../runtime/production-mission-read",()=>({readProductionMission:remote.read}));
vi.mock("../runtime/local-store",()=>({getLocalProject:(id:string)=>records.get(id)}));
vi.mock("./project-studio",()=>({ProjectStudio:({project}:{project:EvolveProject})=>{
  const [name]=useState(project.name);
  return <div>{name}</div>;
}}));
import {ProjectLoader} from "./project-loader";
let host:HTMLDivElement,root:Root;
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  remote.mode="local";remote.read.mockReset();
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();records.clear();});
it("opens a deep-linked Mission when server hydration completes after the initial render",async()=>{
  await act(async()=>root.render(<ProjectLoader projectId="remote-mission"/>));
  expect(host.textContent).toContain("项目不存在");
  records.set("remote-mission",{id:"remote-mission",name:"Restored Mission"} as EvolveProject);
  await act(async()=>window.dispatchEvent(new Event("evolve-projects-changed")));
  expect(host.textContent).toContain("Restored Mission");
  expect(host.textContent).not.toContain("项目不存在");
});
it("switches to the requested Mission rather than keeping the previous Studio state",async()=>{
  records.set("first",{id:"first",name:"First"} as EvolveProject);
  records.set("next",{id:"next",name:"Next"} as EvolveProject);
  await act(async()=>root.render(<ProjectLoader projectId="first"/>));
  await act(async()=>root.render(<ProjectLoader projectId="next"/>));
  expect(host.textContent).toContain("Next");
  expect(host.textContent).not.toContain("First");
});

it("waits for a complete point receipt instead of showing a fallback or a false missing project",async()=>{
 remote.mode="http";let finish!:(project:EvolveProject)=>void;remote.read.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 await act(async()=>root.render(<ProjectLoader projectId="remote" fallback={{id:"remote",name:"Unverified demo"} as EvolveProject}/>));
 expect(host.textContent).toContain("正在读取此项目的完整状态");expect(host.textContent).not.toContain("项目不存在");expect(host.textContent).not.toContain("Unverified demo");
 const project={id:"remote",name:"Verified remote"} as EvolveProject;records.set(project.id,project);await act(async()=>finish(project));expect(host.textContent).toContain("Verified remote");
});
it("ignores a late read of the previous route",async()=>{
 remote.mode="http";let finish!:(project:EvolveProject)=>void;remote.read.mockImplementation((id:string)=>id==="first"?new Promise(resolve=>{finish=resolve;}):Promise.resolve(records.get(id)));
 records.set("next",{id:"next",name:"Next remote"} as EvolveProject);
 await act(async()=>root.render(<ProjectLoader projectId="first"/>));await act(async()=>root.render(<ProjectLoader projectId="next"/>));
 await act(async()=>finish({id:"first",name:"Late first"} as EvolveProject));expect(host.textContent).toContain("Next remote");expect(host.textContent).not.toContain("Late first");
});
it("offers retry after a failed read and confirms a real missing receipt",async()=>{
 remote.mode="http";remote.read.mockRejectedValueOnce(new Error("HTTP 503")).mockResolvedValueOnce(undefined);
 await act(async()=>root.render(<ProjectLoader projectId="missing"/>));expect(host.textContent).toContain("项目读取暂未完成");expect(host.textContent).not.toContain("项目不存在");
 await act(async()=>host.querySelector("button")!.click());expect(host.textContent).toContain("项目不存在");expect(remote.read).toHaveBeenCalledTimes(2);
});
