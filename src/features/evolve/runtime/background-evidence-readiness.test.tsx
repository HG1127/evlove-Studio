import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {demoProject} from "../data/mock-project";
import {useProjectRuntime} from "./use-project-runtime";
const mocks=vi.hoisted(()=>({ensure:vi.fn(async()=>({}))}));
vi.mock("./automatic-evidence",()=>({automaticEvidenceKey:()=>"stable",ensureAutomaticEvidence:mocks.ensure}));
it("waits for full production sync before starting automatic evidence jobs",async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;window.localStorage.clear();const host=document.createElement("div"),root=createRoot(host);
 const Probe=({ready}:{ready:boolean})=>{useProjectRuntime({...demoProject,id:"background-readiness"},{backgroundChecksReady:ready});return null;};
 try{await act(async()=>root.render(<Probe ready={false}/>));expect(mocks.ensure).not.toHaveBeenCalled();await act(async()=>root.render(<Probe ready={true}/>));expect(mocks.ensure).toHaveBeenCalledTimes(1);await act(async()=>root.render(<Probe ready={false}/>));expect(mocks.ensure).toHaveBeenCalledTimes(1);}finally{await act(async()=>root.unmount());window.localStorage.clear();}
});
