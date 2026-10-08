import {act,useState} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {EvolveProject} from "../schemas";
const records=vi.hoisted(()=>new Map<string,EvolveProject>());
vi.mock("../runtime/local-store",()=>({getLocalProject:(id:string)=>records.get(id)}));
vi.mock("./project-studio",()=>({ProjectStudio:({project}:{project:EvolveProject})=>{
  const [name]=useState(project.name);
  return <div>{name}</div>;
}}));
import {ProjectLoader} from "./project-loader";
let host:HTMLDivElement,root:Root;
beforeEach(()=>{
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
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
