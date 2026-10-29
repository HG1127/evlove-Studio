// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import type {SandboxHtmlNativeRequest} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {serverNativeHtmlRuntime,assertServerLocalHtmlBrowserReady} from "./server-html-native-runtime";
import {serverLocalHtmlNativeAuthorized} from "./server-html-native-consent";
import {executeServerArtifactExternal} from "./server-artifact-external";
const mocks=vi.hoisted(()=>({cloud:vi.fn(),local:vi.fn()}));
vi.mock("@evolution/adapters/sandbox",()=>({HTML_NATIVE_KERNEL_SHA256:"f".repeat(64),runVercelSandboxHtmlNativeProfile:mocks.cloud}));
vi.mock("@evolution/adapters/html-native-local",()=>({LOCAL_HTML_NATIVE_RUNTIME_VERSION:"native-html-local-browser-v1",runLocalKnownHtmlNativeProfile:mocks.local}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe("explicit local runtime selection",()=>{
  it("refuses unauthorized or unknown source preflight before launching any browser or cloud request",async()=>{
    const {project}=acceptedPackageFixture(false);project.experimentPolicy.nativeHtmlRuntime="local-browser-v1";
    vi.stubEnv("VERCEL","");vi.stubEnv("EVOLUTION_HTML_NATIVE_LOCAL_MISSIONS","");
    await expect(assertServerLocalHtmlBrowserReady(project)).rejects.toThrow("not authorized");
    vi.stubEnv("EVOLUTION_HTML_NATIVE_LOCAL_MISSIONS",project.id);
    await expect(assertServerLocalHtmlBrowserReady(project)).rejects.toThrow("known complete HTML targets");
    expect(mocks.cloud).not.toHaveBeenCalled();expect(mocks.local).not.toHaveBeenCalled();
  });
  it("keeps legacy defaults and requires separate exact-Mission local permission",()=>{
    const {project}=acceptedPackageFixture(false);vi.stubEnv("VERCEL","");vi.stubEnv("EVOLUTION_HTML_NATIVE_MISSIONS",project.id);vi.stubEnv("EVOLUTION_HTML_NATIVE_LOCAL_MISSIONS","");
    expect(serverNativeHtmlRuntime(project)).toMatchObject({local:false,authorized:true,fingerprint:"f".repeat(64)});
    project.experimentPolicy.nativeHtmlRuntime="local-browser-v1";
    const runtime=serverNativeHtmlRuntime(project);expect(runtime.local).toBe(true);expect(runtime.authorized).toBe(false);expect(runtime.fingerprint).not.toBe("f".repeat(64));
    vi.stubEnv("EVOLUTION_HTML_NATIVE_LOCAL_MISSIONS",project.id+"-other");expect(serverLocalHtmlNativeAuthorized(project.id)).toBe(false);
    vi.stubEnv("EVOLUTION_HTML_NATIVE_LOCAL_MISSIONS",project.id);expect(serverLocalHtmlNativeAuthorized(project.id)).toBe(true);
    vi.stubEnv("VERCEL","1");expect(serverLocalHtmlNativeAuthorized(project.id)).toBe(false);expect(serverNativeHtmlRuntime(project).authorized).toBe(false);
  });
  it("never falls back to cloud when a selected local runtime is denied or unavailable",async()=>{
    const {project}=acceptedPackageFixture(false);project.experimentPolicy.nativeHtmlRuntime="local-browser-v1";
    vi.stubEnv("VERCEL","");vi.stubEnv("EVOLUTION_HTML_NATIVE_LOCAL_MISSIONS","");
    await expect(serverNativeHtmlRuntime(project).execute({} as SandboxHtmlNativeRequest)).rejects.toThrow("not authorized or available");
    vi.stubEnv("EVOLUTION_HTML_NATIVE_LOCAL_MISSIONS",project.id);mocks.local.mockResolvedValue({status:"unavailable",reason:"fixture"});
    expect(await serverNativeHtmlRuntime(project).execute({} as SandboxHtmlNativeRequest)).toMatchObject({status:"unavailable"});
    const out=await executeServerArtifactExternal(project,project.evalSuite,"experiment");
    expect(out.length).toBe(project.evalSuite.length);expect(out.every(r=>r.error==="NATIVE_HTML_LOCAL_EXECUTION_UNAVAILABLE")).toBe(true);expect(mocks.cloud).not.toHaveBeenCalled();
  });
});
