// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {limitLabAiOutputTokens,reserveLabAiPhysicalCall,withAuthorizedLabAiProbe} from "./server-ai-lab-probe";
import {fetchServerAiProviderUsage} from "./server-ai-usage";

const original=process.env.EVOLUTION_EXPERIMENT_MODE;
beforeEach(()=>{process.env.EVOLUTION_EXPERIMENT_MODE="isolated";});
afterEach(()=>{vi.unstubAllGlobals();if(original===undefined)delete process.env.EVOLUTION_EXPERIMENT_MODE;else process.env.EVOLUTION_EXPERIMENT_MODE=original;});
describe("isolated Lab AI probe fence",()=>{  it("blocks real Lab AI calls outside the authorized probe context",()=>{
    expect(()=>reserveLabAiPhysicalCall()).toThrow(/持久化预算/);
    expect(()=>limitLabAiOutputTokens(10000)).toThrow(/授权/);
  });
  it("permits exactly one physical attempt per authorized health probe and clamps output",async()=>{
    await withAuthorizedLabAiProbe(async()=>{
      expect(limitLabAiOutputTokens(10000)).toBe(2048);
      expect(limitLabAiOutputTokens(512)).toBe(512);
      reserveLabAiPhysicalCall();
      expect(()=>reserveLabAiPhysicalCall()).toThrow(/额度已用完/);
    });
    expect(()=>reserveLabAiPhysicalCall()).toThrow(/持久化预算/);
  });
  it("a nested probe cannot reset consumed call budget",async()=>{
    await withAuthorizedLabAiProbe(async()=>{
      reserveLabAiPhysicalCall();
      await withAuthorizedLabAiProbe(async()=>{
        expect(()=>reserveLabAiPhysicalCall()).toThrow(/额度已用完/);
      });
    });
  });
  it("does not change ordinary non-Lab provider routes",async()=>{
    delete process.env.EVOLUTION_EXPERIMENT_MODE;
    reserveLabAiPhysicalCall();
    expect(limitLabAiOutputTokens(10000)).toBe(10000);
    await withAuthorizedLabAiProbe(async()=>{reserveLabAiPhysicalCall();});
  });
  it("rejects a direct physical provider request before any network call",async()=>{
    const fetchMock=vi.fn();
    vi.stubGlobal("fetch",fetchMock);
    const config={mode:"openai-compatible" as const,model:"fixture",apiKey:"synthetic",
      baseUrl:"https://api.example.test/v1",timeoutMs:1000,protocol:"chat-completions" as const};
    await expect(fetchServerAiProviderUsage(config,"chat-completions","understand",
      "https://api.example.test/v1/chat/completions",{method:"POST",body:"{}"}))
      .rejects.toMatchObject({code:"LAB_SUBSCRIPTION_BUDGET_REQUIRED"});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not transfer a spent budget into a new request context",async()=>{
    await withAuthorizedLabAiProbe(async()=>reserveLabAiPhysicalCall());
    await withAuthorizedLabAiProbe(async()=>reserveLabAiPhysicalCall());
  });
});
