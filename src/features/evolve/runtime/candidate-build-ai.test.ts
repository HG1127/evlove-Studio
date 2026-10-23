import {afterEach,describe,expect,it,vi} from "vitest";
import {runCandidateBuildAi} from "./candidate-build-ai";
import {ServerAiUnavailableError} from "./server-ai-client";
const mocks=vi.hoisted(()=>({server:vi.fn(),local:vi.fn()}));
vi.mock("./server-ai-client",async(importOriginal)=>({...await importOriginal<typeof import("./server-ai-client")>(),runServerAiOperation:mocks.server}));
vi.mock("../ai/service",()=>({runEvolveAi:mocks.local}));
vi.mock("./production-runtime",()=>({productionRuntimeMode:()=>"http"}));
afterEach(()=>vi.resetAllMocks());
describe("configured backend Candidate build route",()=>{
  it("uses the real backend without needing a browser key",async()=>{
    const signal=new AbortController().signal;mocks.server.mockResolvedValue({artifacts:[]});
    await expect(runCandidateBuildAi({},signal)).resolves.toEqual({artifacts:[]});
    expect(mocks.server).toHaveBeenCalledWith("build-candidate",{},{signal});expect(mocks.local).not.toHaveBeenCalled();
  });
  it("shares the same deadline with a real BYOK fallback only for provider unavailability",async()=>{
    const signal=new AbortController().signal;mocks.server.mockRejectedValue(new ServerAiUnavailableError("network"));mocks.local.mockResolvedValue({artifacts:[]});
    await runCandidateBuildAi({},signal);
    expect(mocks.local).toHaveBeenCalledWith("build-candidate",{},undefined,undefined,{signal,requireLive:true});
  });
  it("does not hide a schema error or extend the budget after cancellation",async()=>{
    const controller=new AbortController();mocks.server.mockRejectedValue(new Error("invalid schema"));
    await expect(runCandidateBuildAi({},controller.signal)).rejects.toThrow("invalid schema");expect(mocks.local).not.toHaveBeenCalled();
    controller.abort();await expect(runCandidateBuildAi({},controller.signal)).rejects.toThrow();
  });
});
