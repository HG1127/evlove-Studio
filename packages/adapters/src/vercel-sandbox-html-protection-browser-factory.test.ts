// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HTML_PROTECTION_CLOUD_LIMITS as limits } from "./vercel-sandbox-html-protection-cloud-protocol";
const mocks=vi.hoisted(()=>({create:vi.fn(),cache:vi.fn(),snapshot:vi.fn(),stop:vi.fn(),cacheStop:vi.fn()}));
vi.mock("@vercel/sandbox",async original=>({
  ...await original<typeof import("@vercel/sandbox")>(),
  Sandbox:{create:mocks.create,getOrCreate:mocks.cache},Snapshot:{get:mocks.snapshot},
}));
const name="evo-protection-0123456789abcdef01234567";
function spec(signal=new AbortController().signal){return {name,persistent:false as const,networkPolicy:"deny-all" as const,timeout:limits.deadlineMs,signal};}
async function create(raw=spec()){
  const {createVercelSandboxHtmlProtectionBrowser}=await import("./vercel-sandbox-adapter");
  return await createVercelSandboxHtmlProtectionBrowser(raw);
}
beforeEach(()=>{
  vi.resetModules();
  mocks.stop.mockReset().mockResolvedValue(undefined);mocks.cacheStop.mockReset();
  mocks.snapshot.mockReset().mockResolvedValue({});
  mocks.cache.mockReset().mockResolvedValue({currentSnapshotId:"trusted-pw-cache",stop:mocks.cacheStop});
  mocks.create.mockReset().mockResolvedValue({name,cwd:"/vercel/sandbox",persistent:false,stop:mocks.stop});
});
describe("private protection browser composition",()=>{
  it("clones only the existing checked browser snapshot into a fresh deny-all VM",async()=>{
    const input=spec();const actual=await create(input);
    expect(actual.name).toBe(name);
    expect(mocks.cache).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({name:"evolution-browser-pw163-v5-typed-hover",persistent:true,resume:false,networkPolicy:"deny-all"}));
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith({snapshotId:"trusted-pw-cache"});
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({name,source:{type:"snapshot",snapshotId:"trusted-pw-cache"},persistent:false,networkPolicy:"deny-all",timeout:limits.deadlineMs,resources:{vcpus:2},tags:{product:"evolution-os",purpose:"html-protection-observation"},signal:input.signal});
    expect(mocks.stop).not.toHaveBeenCalled();expect(mocks.cacheStop).not.toHaveBeenCalled();
  });
  it.each([
    {name:"shared-cache"},{persistent:true},{networkPolicy:"allow-all"},{timeout:limits.deadlineMs+1},
    {resources:{vcpus:4}},{env:{TOKEN:"must-not-enter-vm"}},{source:{type:"git",url:"https://unexpected.invalid"}},
    {ports:[4173]},{command:"node"},{cwd:"/tmp"},{signal:{}},
  ])("rejects config overrides before SDK creation: %j",async override=>{
    await expect(create({...spec(),...override} as ReturnType<typeof spec>)).rejects.toThrow();
    expect(mocks.cache).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not create or warm a runtime after initial cancellation",async()=>{
    const controller=new AbortController();controller.abort();
    await expect(create(spec(controller.signal))).rejects.toThrow();
    expect(mocks.cache).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not create a VM after cancellation while checking the trusted cache",async()=>{
    const controller=new AbortController();mocks.snapshot.mockImplementation(async()=>{controller.abort();return {};});
    await expect(create(spec(controller.signal))).rejects.toThrow();
    expect(mocks.create).not.toHaveBeenCalled();expect(mocks.cacheStop).not.toHaveBeenCalled();
  });
  it("does not clone an unchecked cache on an API or transport error",async()=>{
    mocks.snapshot.mockRejectedValue(new Error("snapshot lookup unavailable"));
    await expect(create()).rejects.toThrow("snapshot lookup unavailable");
    expect(mocks.create).not.toHaveBeenCalled();expect(mocks.cacheStop).not.toHaveBeenCalled();
  });
  it.each([{name:"another-owner"},{persistent:true},{cwd:"/unexpected"}])("refuses an unexpected/shared SDK resource without stopping it: %j",async override=>{
    mocks.create.mockResolvedValue({name,cwd:"/vercel/sandbox",persistent:false,stop:mocks.stop,...override});
    await expect(create()).rejects.toThrow("policy unavailable");
    expect(mocks.stop).not.toHaveBeenCalled();expect(mocks.cacheStop).not.toHaveBeenCalled();
  });
  it("stops only the newly created VM if the SDK resolves after cancellation",async()=>{
    const controller=new AbortController();mocks.create.mockImplementation(async()=>{controller.abort();return {name,cwd:"/vercel/sandbox",persistent:false,stop:mocks.stop};});
    await expect(create(spec(controller.signal))).rejects.toThrow();
    expect(mocks.stop).toHaveBeenCalledExactlyOnceWith({signal:expect.any(AbortSignal)});
    expect(mocks.cacheStop).not.toHaveBeenCalled();
  });
  it.each(["mkdir","npm","chromium","write"])("restores the shared cache deny-all after a failed cold warm %s",async phase=>{
    const network=vi.fn().mockResolvedValue(undefined),write=vi.fn().mockResolvedValue(undefined);
    const run=vi.fn().mockImplementation(async(cmd:string,argv:string[])=>({exitCode:
      phase==="mkdir"&&cmd==="mkdir"||phase==="npm"&&cmd==="npm"||phase==="chromium"&&argv[0]?.endsWith("cli.js")?1:0,
      stderr:async()=>"synthetic installation failed",
    }));
    if(phase==="write")write.mockRejectedValue(new Error("synthetic file write failed"));
    mocks.cache.mockResolvedValue({updateNetworkPolicy:network,runCommand:run,writeFiles:write,stop:mocks.cacheStop});
    await expect(create()).rejects.toThrow();
    expect(network.mock.calls[0]).toEqual(["allow-all"]);
    expect(network).toHaveBeenLastCalledWith("deny-all");expect(network).toHaveBeenCalledTimes(2);
    expect(mocks.create).not.toHaveBeenCalled();expect(mocks.cacheStop).not.toHaveBeenCalled();
  });
  it("also attempts lockdown when opening the shared cache network rejects",async()=>{
    const network=vi.fn().mockRejectedValueOnce(new Error("allow policy call failed")).mockResolvedValue(undefined);
    mocks.cache.mockResolvedValue({updateNetworkPolicy:network,stop:mocks.cacheStop});
    await expect(create()).rejects.toThrow("allow policy call failed");
    expect(network).toHaveBeenLastCalledWith("deny-all");expect(mocks.create).not.toHaveBeenCalled();
  });  it("keeps parsed fixed settings if the caller mutates its object during cache resolution",async()=>{
    const input=spec();mocks.snapshot.mockImplementation(async()=>{input.name="changed-caller-name";return {};});
    await create(input);expect(mocks.create.mock.calls[0]?.[0].name).toBe(name);
  });
});
