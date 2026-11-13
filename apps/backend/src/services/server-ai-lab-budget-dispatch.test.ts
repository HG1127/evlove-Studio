// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {AiProviderUsageObservation} from "@evolution/contracts";
import {reserveLabSubscriptionCall,settleLabSubscriptionCall} from "./server-ai-lab-subscription-budget";
import {assertMiniMaxSubscriptionQuotaSufficient,fetchMiniMaxSubscriptionQuota} from "./server-ai-minimax-subscription-quota";
import {assertLabMiniMaxPhysicalEndpoint,assertLabMiniMaxSubscriptionRoutes,reserveLabAiDispatchAttempt,settleLabAiDispatchAttempt} from "./server-ai-lab-budget-dispatch";
import {withAuthorizedLabAiProbe} from "./server-ai-lab-probe";
import {resolveServerAiConfigForRole} from "./server-ai-connection";

const mockControl=vi.hoisted(()=>({active:true}));
vi.mock("./server-control-execution",()=>({
  serverControlExecutionBinding:()=>mockControl.active?{missionId:"lab-mission",controlJobId:"control-job",generation:1}:undefined,
}));
vi.mock("./server-ai-connection",()=>({resolveServerAiConfigForRole:vi.fn()}));
vi.mock("./server-ai-lab-subscription-budget",()=>({
  reserveLabSubscriptionCall:vi.fn(async()=>({allowed:true,reason:"reserved"})),
  settleLabSubscriptionCall:vi.fn(async()=>({allowed:true,reason:"settled"})),
}));
const quota={
  provider:"minimax-m-plan" as const,modelGroup:"general" as const,
  intervalRemainingPercent:82,weeklyRemainingPercent:91,intervalStatus:1 as const,weeklyStatus:1 as const,
  intervalResetAt:"2026-11-12T15:00:00.000Z",weeklyResetAt:"2026-11-16T00:00:00.000Z",
  observedAt:new Date().toISOString(),endpointOrigin:"https://www.minimax.io",
};
vi.mock("./server-ai-minimax-subscription-quota",()=>({
  fetchMiniMaxSubscriptionQuota:vi.fn(async()=>quota),
  assertMiniMaxSubscriptionQuotaSufficient:vi.fn((value)=>value),
}));
const keys=["EVOLUTION_EXPERIMENT_MODE"] as const;
const previous=new Map<string,string|undefined>();
const config={mode:"openai-compatible" as const,model:"MiniMax-M2.7-highspeed",
  baseUrl:"https://api.minimax.io/v1",apiKey:"SYNTHETIC_MPLAN_KEY_NEVER_LOG",
  protocol:"chat-completions" as const,timeoutMs:1000};
const scope={missionId:"lab-mission",jobId:"control-job",phase:"experiment"};
const route={operation:"understand" as const,protocol:"chat-completions" as const,model:config.model,
  routeFingerprint:"f".repeat(64)};
const callId="0cc2467c-e3d6-4c5a-b9b1-82e758b3c987";
const body=JSON.stringify({model:config.model,max_tokens:1000,messages:[{role:"user",content:"synthetic input"}]});
beforeEach(()=>{
  for(const k of keys)previous.set(k,process.env[k]);
  process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
  vi.mocked(resolveServerAiConfigForRole).mockReset().mockResolvedValue(config);
  vi.mocked(reserveLabSubscriptionCall).mockClear();
  vi.mocked(settleLabSubscriptionCall).mockClear();
  vi.mocked(fetchMiniMaxSubscriptionQuota).mockReset().mockResolvedValue(quota);
  vi.mocked(assertMiniMaxSubscriptionQuotaSufficient).mockReset().mockImplementation(value=>value);
  mockControl.active=true;
});
afterEach(()=>{
  for(const k of keys){const value=previous.get(k);if(value===undefined)delete process.env[k];else process.env[k]=value;}
  previous.clear();
});
describe("Lab physical dispatch uses M Plan quota and token accounting",()=>{
  const args={callId,config,route,scope,body};
  it("requires a fresh successful Subscription Key quota read before any DB reservation",async()=>{
    vi.mocked(fetchMiniMaxSubscriptionQuota).mockRejectedValueOnce(
      Object.assign(new Error("auth"),{code:"LAB_MINIMAX_SUBSCRIPTION_AUTH_FAILED"}));
    await expect(reserveLabAiDispatchAttempt(args))
      .rejects.toMatchObject({code:"LAB_MINIMAX_SUBSCRIPTION_AUTH_FAILED"});
    expect(reserveLabSubscriptionCall).not.toHaveBeenCalled();
    vi.mocked(assertMiniMaxSubscriptionQuotaSufficient).mockImplementationOnce(()=>{throw new Error("below threshold");});
    await expect(reserveLabAiDispatchAttempt(args)).rejects.toThrow("below threshold");
    expect(reserveLabSubscriptionCall).not.toHaveBeenCalled();
  });
  it("rejects unapproved physical endpoints and malformed MiniMax API base URLs before provider traffic",()=>{
    expect(()=>assertLabMiniMaxPhysicalEndpoint(config,"chat-completions",
      "https://unapproved.example/v1/chat/completions"))
      .toThrowError(/目标地址/);
    expect(()=>assertLabMiniMaxPhysicalEndpoint(config,"chat-completions",
      "https://api.minimax.io/v1/responses"))
      .toThrowError(/目标地址/);
    expect(()=>assertLabMiniMaxSubscriptionRoutes([{
      model:config.model,baseUrl:"https://api.minimax.io/v1?redirect=https://evil.example",
    }])).toThrowError(/API/);
    expect(()=>assertLabMiniMaxSubscriptionRoutes([{
      model:config.model,baseUrl:"https://api.minimax.io/v2",
    }])).toThrowError(/API/);
    expect(()=>assertLabMiniMaxPhysicalEndpoint(config,"chat-completions",
      "https://api.minimax.io/v1/chat/completions")).not.toThrow();
    const chinaConfig={...config,baseUrl:"https://api.minimaxi.com/v1"};
    expect(()=>assertLabMiniMaxSubscriptionRoutes([{model:config.model,baseUrl:chinaConfig.baseUrl}]))
      .not.toThrow();
    expect(()=>assertLabMiniMaxPhysicalEndpoint(chinaConfig,"chat-completions",
      "https://api.minimaxi.com/v1/chat/completions")).not.toThrow();
    expect(()=>assertLabMiniMaxSubscriptionRoutes([{model:config.model,
      baseUrl:"https://api.minimax.cn/v1"}])).toThrowError(/批准/);
    expect(()=>assertLabMiniMaxSubscriptionRoutes([{model:config.model,
      baseUrl:"https://api.minimaxi.com.attacker.example/v1"}])).toThrowError(/批准/);
  });
  it("requires exact control scope, route/model, bounded text input and output",async()=>{
    await expect(reserveLabAiDispatchAttempt({...args,scope:{...scope,jobId:"different"}}))
      .rejects.toMatchObject({code:"LAB_SUBSCRIPTION_BUDGET_REQUIRED"});
    await expect(reserveLabAiDispatchAttempt({...args,config:{...config,model:"other"}}))
      .rejects.toMatchObject({code:"LAB_MINIMAX_ROUTE_UNSUPPORTED"});
    await expect(reserveLabAiDispatchAttempt({...args,body:JSON.stringify({model:config.model,max_tokens:20000})}))
      .rejects.toMatchObject({code:"LAB_SUBSCRIPTION_INPUT_UNBOUNDED"});
    await expect(reserveLabAiDispatchAttempt({...args,body:JSON.stringify({model:config.model,max_tokens:100,max_output_tokens:1000})}))
      .rejects.toMatchObject({code:"LAB_SUBSCRIPTION_INPUT_UNBOUNDED"});
    await expect(reserveLabAiDispatchAttempt({...args,body:JSON.stringify({model:config.model,max_tokens:100,
      messages:[{role:"user",content:[{type:"image_url",image_url:{url:"data:image/png;base64,AA=="}}]}]})}))
      .rejects.toMatchObject({code:"LAB_SUBSCRIPTION_INPUT_UNBOUNDED"});
    expect(reserveLabSubscriptionCall).not.toHaveBeenCalled();
  });
  it("rejects a swapped model API Key before quota lookup or a token reservation",async()=>{
    vi.mocked(resolveServerAiConfigForRole).mockResolvedValueOnce({...config,apiKey:"not-the-saved-vault-key"});
    await expect(reserveLabAiDispatchAttempt(args))
      .rejects.toMatchObject({code:"LAB_MINIMAX_ROLE_ROUTE_MISMATCH"});
    expect(fetchMiniMaxSubscriptionQuota).not.toHaveBeenCalled();
    expect(reserveLabSubscriptionCall).not.toHaveBeenCalled();
  });
  it("binds a judged operation to the saved Judge role rather than the generator",async()=>{
    const judge={...config,model:"MiniMax-M3.1-Flash",apiKey:"SYNTHETIC_JUDGE_SUBSCRIPTION_KEY"};
    vi.mocked(resolveServerAiConfigForRole).mockImplementation(async role=>role==="judge"?judge:config);
    const judgeRoute={...route,operation:"evaluate" as const,model:judge.model};
    const judgeBody=JSON.stringify({model:judge.model,max_tokens:1000,messages:[{role:"user",content:"judge input"}]});
    await reserveLabAiDispatchAttempt({...args,config:judge,route:judgeRoute,body:judgeBody});
    expect(resolveServerAiConfigForRole).toHaveBeenCalledWith("judge");
    expect(fetchMiniMaxSubscriptionQuota).toHaveBeenCalledWith(judge);
    expect(reserveLabSubscriptionCall).toHaveBeenCalledOnce();
  });
  it("reserves the physical call and stores the quota snapshot without exposing the API Key",async()=>{
    const reservation=await reserveLabAiDispatchAttempt(args);
    expect(reservation).toMatchObject({callId,missionId:"lab-mission",controlJobId:"control-job",
      model:config.model,quota:{intervalRemainingPercent:82,weeklyRemainingPercent:91}});
    expect(reservation?.reservedTokens).toBeGreaterThan(9000);
    expect(reservation?.reservedTokens).toBeLessThanOrEqual(100000);
    expect(fetchMiniMaxSubscriptionQuota).toHaveBeenCalledWith(config);
    expect(reserveLabSubscriptionCall).toHaveBeenCalledTimes(1);
    const sent=vi.mocked(reserveLabSubscriptionCall).mock.calls[0]?.[0];
    expect(sent).toMatchObject({callId,missionId:"lab-mission",routeFingerprint:"f".repeat(64),reservedTokens:reservation?.reservedTokens});
    expect(JSON.stringify(sent)).not.toContain(config.apiKey);
  });
  it("settles actual provider token counts, not USD estimates",async()=>{
    const reservation=(await reserveLabAiDispatchAttempt(args))!;
    const observation={usage:{status:"complete",counts:{input:100,output:30,total:130}},
      outcome:"response",responseModel:config.model} as AiProviderUsageObservation;
    await settleLabAiDispatchAttempt(reservation,observation);
    expect(settleLabSubscriptionCall).toHaveBeenCalledWith({
      missionId:"lab-mission",controlJobId:"control-job",callId,measuredTokens:130,
    });
  });
  it("pauses the subscription budget for missing usage or mismatched response model",async()=>{
    const reservation=(await reserveLabAiDispatchAttempt(args))!;
    const observation={usage:{status:"unavailable",counts:{},reason:"missing-usage"},
      outcome:"transport-error"} as AiProviderUsageObservation;
    await expect(settleLabAiDispatchAttempt(reservation,observation))
      .rejects.toMatchObject({code:"LAB_SUBSCRIPTION_USAGE_UNVERIFIED"});
    expect(settleLabSubscriptionCall).toHaveBeenCalledWith(expect.objectContaining({measuredTokens:null}));
    const second=(await reserveLabAiDispatchAttempt(args))!;
    await expect(settleLabAiDispatchAttempt(second,{
      usage:{status:"complete",counts:{input:10,output:3,total:13}},outcome:"response",responseModel:"different",
    } as AiProviderUsageObservation)).rejects.toMatchObject({code:"LAB_SUBSCRIPTION_USAGE_UNVERIFIED"});
  });
  it("preserves the authorized single health probe without consuming Mission subscription budget",async()=>{
    mockControl.active=false;
    await withAuthorizedLabAiProbe(async()=>{
      expect(await reserveLabAiDispatchAttempt(args)).toBeUndefined();
      await expect(reserveLabAiDispatchAttempt(args)).rejects.toMatchObject({code:"LAB_PROBE_CALL_LIMIT_REACHED"});
    });
    expect(reserveLabSubscriptionCall).not.toHaveBeenCalled();
  });
  it("never borrows a health probe inside a Mission control context",async()=>{
    await withAuthorizedLabAiProbe(async()=>{
      await expect(reserveLabAiDispatchAttempt(args)).rejects.toMatchObject({code:"LAB_PROBE_SCOPE_FORBIDDEN"});
    });
    expect(reserveLabSubscriptionCall).not.toHaveBeenCalled();
  });
  it("leaves non-Lab transport unchanged",async()=>{
    delete process.env.EVOLUTION_EXPERIMENT_MODE;
    expect(await reserveLabAiDispatchAttempt(args)).toBeUndefined();
    expect(reserveLabSubscriptionCall).not.toHaveBeenCalled();
  });
});