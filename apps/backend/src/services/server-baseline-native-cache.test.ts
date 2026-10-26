// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {htmlNativeEvidenceFixture} from "@evolution/testkit";
import {canReuseServerMissionBaseline} from "./server-baseline";
const mocks=vi.hoisted(()=>({reuse:vi.fn()}));
vi.mock("@evolution/harness",async load=>({...await load<typeof import("@evolution/harness")>(),canReuseServerBaseline:mocks.reuse}));
vi.mock("@evolution/adapters/sandbox",()=>({HTML_NATIVE_KERNEL_SHA256:"f".repeat(64)}));
beforeEach(()=>mocks.reuse.mockReset().mockReturnValue(true));
describe("production native Baseline cache",()=>{
  it("rejects an old native renderer even when other cache and identity checks would allow reuse",()=>{
    const run=htmlNativeEvidenceFixture(),project={baselineRun:{runs:[run]}} as EvolveProject;
    expect(canReuseServerMissionBaseline(project,"route")).toBe(false);
    expect(mocks.reuse).not.toHaveBeenCalled();
    run.nativeHtmlProof!.observation.kernelSha256="f".repeat(64);
    expect(canReuseServerMissionBaseline(project,"route")).toBe(true);
    mocks.reuse.mockReturnValue(false);
    expect(canReuseServerMissionBaseline(project,"changed-route")).toBe(false);
  });
  it("retains existing non-native cache policy without importing a vendor into Harness",()=>{
    const run=htmlNativeEvidenceFixture();delete run.nativeHtmlProof;
    const project={baselineRun:{runs:[run]}} as EvolveProject;
    expect(canReuseServerMissionBaseline(project,"route")).toBe(true);
    expect(mocks.reuse).toHaveBeenCalledWith(project,"route");
  });
});
