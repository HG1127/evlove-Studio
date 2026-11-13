// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {fetchServerAiProviderUsage,withServerAiUsageScope} from "./server-ai-usage";
import {reserveLabAiDispatchAttempt,settleLabAiDispatchAttempt} from "./server-ai-lab-budget-dispatch";
import type {AiUsageLedgerRecord} from "@evolution/contracts";

vi.mock("./server-control-execution",()=>({
  assertServerControlExecutionActive:vi.fn(async()=>undefined),
  serverControlExecutionSignal:()=>undefined,
}));
vi.mock("./server-ai-response-provenance",()=>({
  assertServerAiResponseProvenanceReady:()=>undefined,
  observeServerAiResponseProvenance:vi.fn(async()=>undefined),
}));
vi.mock("./server-ai-lab-budget-dispatch",()=>({
  reserveLabAiDispatchAttempt:vi.fn(async()=>({reservation:"synthetic"})),
  settleLabAiDispatchAttempt:vi.fn(async()=>undefined),
}));
const config={mode:"openai-compatible" as const,model:"fixture-model",apiKey:"PRIVATE_SYNTHETIC",
  baseUrl:"https://provider.test/v1",timeoutMs:1000,protocol:"chat-completions" as const};
const scope={missionId:"lab-mission",jobId:"control-job",phase:"experiment"};
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe("Lab dispatcher ordering at the physical provider boundary",()=>{
  it("persists the reservation and usage start before provider fetch, settles the result",async()=>{
    const order:string[]=[];const records:AiUsageLedgerRecord[]=[];
    vi.mocked(reserveLabAiDispatchAttempt).mockImplementation(async()=>{order.push("reserve");return {reservation:"synthetic"} as never;});
    vi.mocked(settleLabAiDispatchAttempt).mockImplementation(async()=>{order.push("settle");});
    vi.stubGlobal("fetch",vi.fn(async()=>{
      order.push("provider");
      return new Response(JSON.stringify({id:"reply1",model:config.model,
        usage:{prompt_tokens:10,completion_tokens:4,total_tokens:14},
        choices:[{message:{content:"fixture"}}]}));
    }));
    await withServerAiUsageScope(scope,async()=>{
      const response=await fetchServerAiProviderUsage(config,"chat-completions","understand",
        config.baseUrl+"/chat/completions",{method:"POST",body:"{}"});
      await response.readJson();
    },async record=>{records.push(record);order.push(record.kind==="request-start"?"usage-start":"usage-result");});
    expect(order).toEqual(["reserve","usage-start","provider","usage-result","settle"]);
    expect(records).toHaveLength(2);
    expect(records[0]?.kind==="request-start"&&records[0].request.callId)
      .toEqual(vi.mocked(reserveLabAiDispatchAttempt).mock.calls[0]?.[0].callId);
    expect(settleLabAiDispatchAttempt).toHaveBeenCalledTimes(1);
  });
  it("never calls provider or writes usage if database denies reservation",async()=>{
    vi.mocked(reserveLabAiDispatchAttempt).mockRejectedValueOnce(
      Object.assign(new Error("budget denied"),{code:"LAB_AI_BUDGET_REJECTED"}));
    const provider=vi.fn();vi.stubGlobal("fetch",provider);
    const records:AiUsageLedgerRecord[]=[];
    await expect(withServerAiUsageScope(scope,()=>fetchServerAiProviderUsage(config,
      "chat-completions","understand",config.baseUrl+"/chat/completions",{method:"POST",body:"{}"}),
    async record=>{records.push(record);}))
      .rejects.toMatchObject({code:"LAB_AI_BUDGET_REJECTED"});
    expect(provider).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });
});