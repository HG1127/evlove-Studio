import {describe,expect,it} from "vitest";
import {demoProject} from "../../../src/features/evolve/data/mock-project";
import {hasExecutableHtmlSource,hasAmbiguousAutoProxyHtmlTarget,requiresSandboxHtmlSourceExecution} from "./html-source-target";

const html={...demoProject.sourceArtifacts[0]!,extension:"html",mimeType:"text/html",role:"target" as const};
function project(adapter:"artifact"|"http"|"git",connectionId="uploaded-artifact"){
  return {...demoProject,sourceArtifacts:[html],
    targetConnection:{...demoProject.targetConnection,adapter,connectionId}};
}
describe("Source HTML Target versus remote HTTP Target",()=>{
  it("preserves isolated execution even when legacy auto-discovered HTTP Proxy overwrote artifact adapter",()=>{
    const legacy=project("http","runner-gateway");
    expect(hasExecutableHtmlSource(legacy)).toBe(true);
    expect(hasAmbiguousAutoProxyHtmlTarget(legacy)).toBe(true);
    expect(requiresSandboxHtmlSourceExecution(legacy)).toBe(true);
  });
  it("does not mistake explicit HTTP/Git integrations for an uploaded HTML Artifact VM",()=>{
    expect(hasAmbiguousAutoProxyHtmlTarget(project("http","external-remote"))).toBe(false);
    expect(requiresSandboxHtmlSourceExecution(project("http","external-remote"))).toBe(false);
    expect(requiresSandboxHtmlSourceExecution(project("git","github-repo"))).toBe(false);
  });
  it("requires isolated browser for genuine HTML upload, not its reference materials or Markdown",()=>{
    expect(requiresSandboxHtmlSourceExecution(project("artifact"))).toBe(true);
    const ref={...project("artifact"),sourceArtifacts:[{...html,role:"reference" as const}]};
    expect(requiresSandboxHtmlSourceExecution(ref)).toBe(false);
    const markdown={...project("artifact"),sourceArtifacts:[{...html,extension:"md",mimeType:"text/markdown"}]};
    expect(requiresSandboxHtmlSourceExecution(markdown)).toBe(false);
  });
});
