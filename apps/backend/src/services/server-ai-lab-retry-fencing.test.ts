// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {AiUsageLedgerRecord} from "@evolution/contracts";
import {fetchServerAiProviderUsage,withServerAiUsageScope} from "./server-ai-usage";
import {assertLabMiniMaxPhysicalEndpoint,reserveLabAiDispatchAttempt,settleLabAiDispatchAttempt} from "./server-ai-lab-budget-dispatch";

const mocks=vi.hoisted(()=>({binding:{missionId:"lab-synthetic-p3w",controlJobId:"lab-job-p3w",generation:1}}));
vi.mock("./server-control-execution",()=>({
  assertServerControlExecutionActive:vi.fn(async()=>undefined),
  serverControlExecutionBinding:vi.fn(()=>mocks.binding),
  serverControlExecutionSignal:vi.fn(()=>undefined),
}));
vi.mock("./server-ai-response-provenance",()=>({
  assertServerAiResponseProvenanceReady:vi.fn(()=>undefined),
  observeServerAiResponseProvenance:vi.fn(async()=>undefined),
}));
vi.mock("./server-ai-lab-budget-dispatch",()=>({
  assertLabMiniMaxPhysicalEndpoint:vi.fn(()=>undefined),
  reserveLabAiDispatchAttempt:vi.fn(async()=>({reservation:"synthetic-only"})),
  settleLabAiDispatchAttempt:vi.fn(async()=>undefined),
}));
const savedMode=process.env.EVOLUTION_EXPERIMENT_MODE;
const config={
  mode:"openai-compatible" as const,
  model:"MiniMax-M3",
  apiKey:"SYNTHETIC_KEY_NEVER_SEND_TO_NETWORK",
  baseUrl:"https://api.minimaxi.com/v1",
  timeoutMs:2000,
  protocol:"chat-completions" as const,
};
const url=config.baseUrl+"/chat/completions";
const request={method:"POST",body:JSON.stringify({model:config.model,max_tokens:512,messages:[{role:"user",content:"synthetic"}]})};
const scope={missionId:mocks.binding.missionId,jobId:mocks.binding.controlJobId,phase:"experiment"};
const success=()=>new Response(JSON.stringify({
  id:"offline-response",model:config.model,
  usage:{prompt_tokens:15,completion_tokens:10,total_tokens:25},
  choices:[{message:{content:"synthetic output"}}],
}),{status:200,headers:{"content-type":"application/json"}});
const invocation=(records:AiUsageLedgerRecord[])=>withServerAiUsageScope(scope,async()=>{
  const result=await fetchServerAiProviderUsage(config,"chat-completions","build-candidate",url,request);
  return result.readJson();
},async record=>{records.push(record);});

beforeEach(()=>{
  process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
  vi.mocked(reserveLabAiDispatchAttempt).mockReset().mockResolvedValue({reservation:"synthetic-only"} as never);
  vi.mocked(settleLabAiDispatchAttempt).mockReset().mockResolvedValue(undefined);
  vi.mocked(assertLabMiniMaxPhysicalEndpoint).mockClear();
});
afterEach(()=>{
  if(savedMode===undefined)delete process.env.EVOLUTION_EXPERIMENT_MODE;
  else process.env.EVOLUTION_EXPERIMENT_MODE=savedMode;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("P3-W isolated Lab synthetic physical attempt and failure closure",()=>{
  it("books two unique physical attempts separately after one connection failure, records/settles both",async()=>{
    const records:AiUsageLedgerRecord[]=[];
    const order:string[]=[];
    vi.mocked(reserveLabAiDispatchAttempt).mockImplementation(async()=>{
      order.push("reserve");return {reservation:"synthetic-only"} as never;
    });
    vi.mocked(settleLabAiDispatchAttempt).mockImplementation(async()=>{
      order.push("settle");return undefined;
    });
    let attempts=0;
    const provider=vi.fn(async(_url:string,init:RequestInit)=>{
      expect(init.redirect).toBe("error");
      attempts++;order.push("provider");
      if(attempts===1)throw Object.assign(new TypeError("fetch failed"),{cause:{code:"ECONNRESET"}});
      return success();
    });
    vi.stubGlobal("fetch",provider);
    await invocation(records);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(reserveLabAiDispatchAttempt).toHaveBeenCalledTimes(2);
    expect(settleLabAiDispatchAttempt).toHaveBeenCalledTimes(2);
    expect(records.map(x=>x.kind)).toEqual(["request-start","request-result","request-start","request-result"]);
    const starts=records.filter(x=>x.kind==="request-start");
    expect(starts.map(x=>x.request.attempt)).toEqual([1,2]);
    expect(new Set(starts.map(x=>x.request.callId)).size).toBe(2);
    expect(records.filter(x=>x.kind==="request-result").map(x=>x.observation.outcome)).toEqual(["transport-error","response"]);
    expect(records.filter(x=>x.kind==="request-result").map(x=>x.observation.request.callId)).toEqual(starts.map(x=>x.request.callId));
    expect(order).toEqual(["reserve","provider","settle","reserve","provider","settle"]);
    expect(assertLabMiniMaxPhysicalEndpoint).toHaveBeenCalledWith(config,"chat-completions",url);
    expect(JSON.stringify(records)).not.toContain(config.apiKey);
  });

  it("fails closed if the second physical attempt is denied; never sends second provider request",async()=>{
    const records:AiUsageLedgerRecord[]=[];
    let attempted=0;
    const provider=vi.fn(async()=>{attempted++;throw Object.assign(new TypeError("fetch failed"),{cause:{code:"ECONNRESET"}});});
    vi.stubGlobal("fetch",provider);
    vi.mocked(reserveLabAiDispatchAttempt)
      .mockResolvedValueOnce({reservation:"first-synthetic"} as never)
      .mockRejectedValueOnce(Object.assign(new Error("mock budget exhausted"),{code:"LAB_SUBSCRIPTION_BUDGET_REJECTED"}));
    await expect(invocation(records)).rejects.toMatchObject({code:"LAB_SUBSCRIPTION_BUDGET_REJECTED"});
    expect(attempted).toBe(1);
    expect(reserveLabAiDispatchAttempt).toHaveBeenCalledTimes(2);
    expect(settleLabAiDispatchAttempt).toHaveBeenCalledOnce();
    expect(records.map(x=>x.kind)).toEqual(["request-start","request-result"]);
    expect(records[1]).toMatchObject({kind:"request-result",observation:{outcome:"transport-error",transportReason:"provider-network-error"}});
  });

  it("retries one explicit capacity rejection only after a second physical reservation",async()=>{
    const records:AiUsageLedgerRecord[]=[];
    let attempts=0;
    const provider=vi.fn(async()=>{
      attempts++;
      if(attempts===1)return new Response(JSON.stringify({error:{message:"model is at capacity"}}),{status:503});
      return success();
    });
    vi.stubGlobal("fetch",provider);
    await invocation(records);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(reserveLabAiDispatchAttempt).toHaveBeenCalledTimes(2);
    expect(settleLabAiDispatchAttempt).toHaveBeenCalledTimes(2);
    expect(records.map(x=>x.kind)).toEqual(["request-start","request-result","request-start","request-result"]);
    const responses=records.filter(x=>x.kind==="request-result");
    expect(responses.map(x=>x.observation.outcome)).toEqual(["response","response"]);
    expect(responses.map(x=>x.observation.httpStatus)).toEqual([503,200]);
  });

  it("does not contact a provider when the durable usage-start ledger writer fails",async()=>{
    const provider=vi.fn();vi.stubGlobal("fetch",provider);
    const received:AiUsageLedgerRecord[]=[];
    await expect(withServerAiUsageScope(scope,()=>fetchServerAiProviderUsage(config,
      "chat-completions","build-candidate",url,request),
      async record=>{
        received.push(record);
        throw new Error("offline durable writer unavailable");
      })).rejects.toMatchObject({code:"AI_USAGE_START_NOT_RECORDED"});
    expect(reserveLabAiDispatchAttempt).toHaveBeenCalledOnce();
    expect(received).toHaveLength(1);
    expect(received[0]?.kind).toBe("request-start");
    expect(provider).not.toHaveBeenCalled();
    expect(settleLabAiDispatchAttempt).not.toHaveBeenCalled();
  });

  it("stops rather than retrying if transport failure usage is unknown and settlement blocks continuation",async()=>{
    const records:AiUsageLedgerRecord[]=[];
    const provider=vi.fn(async()=>{
      throw Object.assign(new TypeError("fetch failed"),{cause:{code:"ECONNRESET"}});
    });
    vi.stubGlobal("fetch",provider);
    vi.mocked(settleLabAiDispatchAttempt).mockRejectedValueOnce(Object.assign(
      new Error("offline fail-closed unknown usage"),{code:"LAB_SUBSCRIPTION_USAGE_UNVERIFIED"},
    ));
    await expect(invocation(records)).rejects.toMatchObject({code:"LAB_SUBSCRIPTION_USAGE_UNVERIFIED"});
    expect(provider).toHaveBeenCalledOnce();
    expect(reserveLabAiDispatchAttempt).toHaveBeenCalledOnce();
    expect(settleLabAiDispatchAttempt).toHaveBeenCalledOnce();
    expect(records.map(x=>x.kind)).toEqual(["request-start","request-result"]);
    expect(records[1]).toMatchObject({kind:"request-result",observation:{outcome:"transport-error"}});
  });

  it("stops after a capacity rejection when its provider usage cannot be verified",async()=>{
    const records:AiUsageLedgerRecord[]=[];
    const provider=vi.fn(async()=>new Response(JSON.stringify({
      error:{message:"model is at capacity"},
    }),{status:503}));
    vi.stubGlobal("fetch",provider);
    vi.mocked(settleLabAiDispatchAttempt).mockRejectedValueOnce(Object.assign(
      new Error("offline fail-closed quota uncertainty"),{code:"LAB_SUBSCRIPTION_USAGE_UNVERIFIED"},
    ));
    await expect(invocation(records)).rejects.toMatchObject({code:"LAB_SUBSCRIPTION_USAGE_UNVERIFIED"});
    expect(provider).toHaveBeenCalledOnce();
    expect(reserveLabAiDispatchAttempt).toHaveBeenCalledOnce();
    expect(records.map(x=>x.kind)).toEqual(["request-start","request-result"]);
    expect(records[1]).toMatchObject({kind:"request-result",observation:{httpStatus:503}});
  });

  it("never promotes a final unsuccessful HTTP response into a synthetic success or retry",async()=>{
    const records:AiUsageLedgerRecord[]=[];
    const provider=vi.fn(async()=>new Response(JSON.stringify({error:{message:"quota blocked"}}),{status:429}));
    vi.stubGlobal("fetch",provider);
    const response=await withServerAiUsageScope(scope,async()=>{
      const r=await fetchServerAiProviderUsage(config,"chat-completions","build-candidate",url,request);
      await r.readJson();
      return r.response;
    },async record=>{records.push(record);});
    expect(response.status).toBe(429);
    expect(provider).toHaveBeenCalledOnce();
    expect(reserveLabAiDispatchAttempt).toHaveBeenCalledOnce();
    expect(settleLabAiDispatchAttempt).toHaveBeenCalledOnce();
    expect(records.map(x=>x.kind)).toEqual(["request-start","request-result"]);
  });
});
