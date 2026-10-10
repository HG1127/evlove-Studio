// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi,type Mock} from "vitest";
import {acceptedLegacyHtmlPaperFixture,acceptedPackageFixture} from "@evolution/testkit";
import {materializeAcceptedCandidatePackage} from "@evolution/core";
import type {ProjectRuntime} from "../runtime/use-project-runtime";
const mocks=vi.hoisted(()=>({read:vi.fn(),error:vi.fn()}));
vi.mock("../runtime/frozen-artifact",()=>({readFrozenArtifact:mocks.read}));
vi.mock("sonner",()=>({toast:{error:mocks.error}}));
vi.mock("./mermaid-block",()=>({MermaidBlock:()=>null}));
import {ProjectOutputsPanel} from "./project-outputs-panel";
let host:HTMLDivElement,root:ReturnType<typeof createRoot>,createUrl:Mock<() => string>;
beforeEach(()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.useFakeTimers();
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
 mocks.read.mockReset().mockResolvedValue(new Blob(["synthetic exact read"]));mocks.error.mockReset();
 createUrl=vi.fn(()=>"blob:synthetic-download");
 const OriginalURL=URL;
 vi.stubGlobal("URL",class extends OriginalURL{static createObjectURL=createUrl;static revokeObjectURL=vi.fn();});
 vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>undefined);
});
afterEach(async()=>{
 await act(async()=>root.unmount());host.remove();vi.runOnlyPendingTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();
});
const button=(label:string)=>[...host.querySelectorAll("button")].find(item=>item.textContent===label)!;
async function render(project:ProjectRuntime["project"]){
 await act(async()=>root.render(<ProjectOutputsPanel runtime={{project,materializeOutputs:vi.fn(),rollbackToVersion:vi.fn()} as unknown as ProjectRuntime}/>));
}
describe("current accepted file download paper guard",()=>{
 it("blocks a persisted accepted primary before frozen byte read or download",async()=>{
  const f=acceptedLegacyHtmlPaperFixture();f.project.outputArtifacts=f.project.outputArtifacts.filter(a=>a.kind==="primary");
  await render(f.project);await act(async()=>button("下载").click());
  expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("html-protection-contract-pending"));
  expect(mocks.read).not.toHaveBeenCalled();expect(createUrl).not.toHaveBeenCalled();
 });
 it("retains physical readback for an accepted unaffected paper",async()=>{
  const f=acceptedPackageFixture(false);
  f.project.outputArtifacts=materializeAcceptedCandidatePackage(f.project,f.current,f.project.artifactAcceptance).filter(a=>a.kind==="primary");
  await render(f.project);
  expect(button("下载完整 ZIP")).toBeDefined();
  expect(button("冻结 Gate F 已验收成果")).toBeUndefined();
  await act(async()=>button("下载").click());
  const artifact=f.project.outputArtifacts[0]!;
  expect(mocks.read).toHaveBeenCalledWith(artifact.frozenArtifact,artifact.content);
  expect(createUrl).toHaveBeenCalledTimes(1);expect(mocks.error).not.toHaveBeenCalled();
 });
 it("keeps explicit archived target files separate from current acceptance",async()=>{
  const f=acceptedLegacyHtmlPaperFixture();
  f.project.archivedOutputs=f.project.outputArtifacts.filter(a=>a.kind==="primary");f.project.outputArtifacts=[];
  await render(f.project);await act(async()=>button("下载").click());
  expect(mocks.read).toHaveBeenCalledTimes(1);expect(createUrl).toHaveBeenCalledTimes(1);expect(mocks.error).not.toHaveBeenCalled();
 });
});
