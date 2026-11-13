// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {prepareLabWorkflowStart} from "./lab-workflow-admission";
import {getServerAiConnectionStatus,resolveServerAiConfigForRole} from "./server-ai-connection";
import {assertLabMiniMaxSubscriptionRoutes} from "./server-ai-lab-budget-dispatch";
import {assertMiniMaxSubscriptionQuotaSufficient,fetchMiniMaxSubscriptionQuota} from "./server-ai-minimax-subscription-quota";

const generation={
  mode:"openai-compatible" as const,model:"MiniMax-M2.7-highspeed",
  baseUrl:"https://api.minimax.io/v1",apiKey:"SYNTHETIC_GENERATION_SUBSCRIPTION_KEY",
  protocol:"chat-completions" as const,timeoutMs:1000,
};
const judge={...generation,model:"MiniMax-M3.1-Flash",apiKey:"SYNTHETIC_JUDGE_SUBSCRIPTION_KEY"};
const quota={provider:"minimax-m-plan" as const,modelGroup:"general" as const,
  intervalRemainingPercent:82,weeklyRemainingPercent:91,intervalStatus:1 as const,weeklyStatus:1 as const,
  intervalResetAt:"2026-11-12T15:00:00.000Z",weeklyResetAt:"2026-11-16T00:00:00.000Z",
  observedAt:new Date().toISOString(),endpointOrigin:"https://www.minimax.io"};
vi.mock("../isolated-lab-runtime",()=>({inspectIsolatedLabRuntime:()=>({ready:true,codes:[]})}));
vi.mock("./server-ai-connection",()=>({
  getServerAiConnectionStatus:vi.fn(async(role:"generation"|"judge")=>({
    configured:true,connection:{model:role==="generation"?generation.model:judge.model,
      baseUrl:generation.baseUrl,label:role},
  })),
  resolveServerAiConfigForRole:vi.fn(async(role:"generation"|"judge")=>role==="generation"?generation:judge),
}));
vi.mock("./server-ai-lab-budget-dispatch",()=>({
  assertLabMiniMaxSubscriptionRoutes:vi.fn(()=>({maxCalls:6,maxTokens:300000,minRemainingPercent:50})),
}));
vi.mock("./server-ai-minimax-subscription-quota",()=>({
  fetchMiniMaxSubscriptionQuota:vi.fn(async()=>quota),
  assertMiniMaxSubscriptionQuotaSufficient:vi.fn((value)=>value),
}));
const keys=["EVOLUTION_EXPERIMENT_MODE","EVOLUTION_LAB_EXPERIMENT_ARMED",
  "EVOLUTION_LAB_APPROVED_MISSION_ID"] as const;
const saved=new Map<string,string|undefined>();
const input={missionId:"lab-synthetic-html-1",actorId:"admin-fixture",
  requestedAt:new Date().toISOString(),isExecutableHtml:true,
  approval:"explicit-synthetic-lab-v1" as const};
beforeEach(()=>{
  for(const key of keys)saved.set(key,process.env[key]);
  process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
  process.env.EVOLUTION_LAB_EXPERIMENT_ARMED="true";
  process.env.EVOLUTION_LAB_APPROVED_MISSION_ID=input.missionId;
  vi.mocked(getServerAiConnectionStatus).mockReset().mockImplementation(async role=>({
    configured:true,connection:{model:role==="generation"?generation.model:judge.model,
      baseUrl:generation.baseUrl,label:role},
  } as never));
  vi.mocked(resolveServerAiConfigForRole).mockReset().mockImplementation(async role=>
    role==="generation"?generation:judge);
  vi.mocked(assertLabMiniMaxSubscriptionRoutes).mockReset().mockReturnValue({
    maxCalls:6,maxTokens:300000,minRemainingPercent:50,
  });
  vi.mocked(fetchMiniMaxSubscriptionQuota).mockReset().mockResolvedValue(quota);
  vi.mocked(assertMiniMaxSubscriptionQuotaSufficient).mockReset().mockImplementation(value=>value);
});
afterEach(()=>{
  for(const key of keys){const value=saved.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  saved.clear();
});
describe("P3-M Lab admission uses existing M Plan Subscription Keys and live quota snapshots",()=>{
  it("accepts explicit synthetic HTML only after verifying both saved role routes and both subscription quotas",async()=>{
    const permit=await prepareLabWorkflowStart({...input,requestedAt:new Date().toISOString()});
    expect(permit).toMatchObject({schemaVersion:"lab-synthetic-experiment-v2",maxCalls:6,maxTokens:300_000,
      missionId:input.missionId,approvedActorId:input.actorId});
    expect(getServerAiConnectionStatus).toHaveBeenCalledTimes(2);
    expect(resolveServerAiConfigForRole).toHaveBeenCalledTimes(2);
    expect(assertLabMiniMaxSubscriptionRoutes).toHaveBeenCalledWith([
      {model:generation.model,baseUrl:generation.baseUrl},{model:judge.model,baseUrl:judge.baseUrl},
    ]);
    expect(fetchMiniMaxSubscriptionQuota).toHaveBeenCalledTimes(2);
    expect(assertMiniMaxSubscriptionQuotaSufficient).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(permit)).not.toContain(generation.apiKey);
    expect(JSON.stringify(permit)).not.toContain(judge.apiKey);
  });
  it.each([
    {approval:undefined},{scheduledFor:"2026-11-13T00:00:00Z"},{isExecutableHtml:false},
    {missionId:"not-allowlisted"},
  ])("blocks absent authorization or invalid scope before reading any Vault role: %j",async changes=>{
    await expect(prepareLabWorkflowStart({...input,...changes} as typeof input)).rejects.toThrow();
    expect(getServerAiConnectionStatus).not.toHaveBeenCalled();
    expect(fetchMiniMaxSubscriptionQuota).not.toHaveBeenCalled();
  });
  it("denies the same provider/model pair being used for independent Judge",async()=>{
    vi.mocked(getServerAiConnectionStatus).mockResolvedValue({
      configured:true,connection:{model:generation.model,baseUrl:generation.baseUrl},
    } as never);
    await expect(prepareLabWorkflowStart({...input,requestedAt:new Date().toISOString()}))
      .rejects.toMatchObject({code:"LAB_GENERATOR_EQUALS_JUDGE"});
    expect(fetchMiniMaxSubscriptionQuota).not.toHaveBeenCalled();
  });
  it("rejects Preview aliases of the same underlying Judge model family",async()=>{
    vi.mocked(getServerAiConnectionStatus).mockResolvedValue({
      configured:true,connection:{model:"MiniMax-M3.1-Flash-Preview",baseUrl:generation.baseUrl},
    } as never);
    await expect(prepareLabWorkflowStart({...input,requestedAt:new Date().toISOString()}))
      .rejects.toMatchObject({code:"LAB_GENERATOR_EQUALS_JUDGE"});
    expect(fetchMiniMaxSubscriptionQuota).not.toHaveBeenCalled();
  });
  it("refuses a missing Judge role or missing decrypted Vault connection",async()=>{
    vi.mocked(getServerAiConnectionStatus).mockImplementation(async role=>role==="judge"
      ?{configured:false} as never:{configured:true,connection:{model:generation.model,baseUrl:generation.baseUrl}} as never);
    await expect(prepareLabWorkflowStart({...input,requestedAt:new Date().toISOString()}))
      .rejects.toMatchObject({code:"LAB_INDEPENDENT_JUDGE_REQUIRED"});
    vi.mocked(resolveServerAiConfigForRole).mockImplementation(async role=>role==="judge"?undefined: generation);
    await expect(prepareLabWorkflowStart({...input,requestedAt:new Date().toISOString()}))
      .rejects.toMatchObject({code:"LAB_INDEPENDENT_JUDGE_REQUIRED"});
  });
  it("rejects a Vault route rotation between redacted status and full server-side resolution",async()=>{
    vi.mocked(resolveServerAiConfigForRole).mockImplementation(async role=>role==="generation"
      ?{...generation,model:"MiniMax-ROTATED-UNAPPROVED"}:judge);
    await expect(prepareLabWorkflowStart({...input,requestedAt:new Date().toISOString()}))
      .rejects.toMatchObject({code:"LAB_VAULT_ROUTE_CHANGED"});
    expect(fetchMiniMaxSubscriptionQuota).not.toHaveBeenCalled();
  });
  it("refuses quota endpoint auth failure, unknown quota and low remaining percentage",async()=>{
    vi.mocked(fetchMiniMaxSubscriptionQuota).mockRejectedValueOnce(
      Object.assign(new Error("quota auth"),{code:"LAB_MINIMAX_SUBSCRIPTION_AUTH_FAILED"}));
    await expect(prepareLabWorkflowStart({...input,requestedAt:new Date().toISOString()}))
      .rejects.toMatchObject({code:"LAB_MINIMAX_SUBSCRIPTION_AUTH_FAILED"});
    vi.mocked(fetchMiniMaxSubscriptionQuota).mockResolvedValue(quota);
    vi.mocked(assertMiniMaxSubscriptionQuotaSufficient).mockImplementationOnce(()=>{throw new Error("quota below safety threshold");});
    await expect(prepareLabWorkflowStart({...input,requestedAt:new Date().toISOString()}))
      .rejects.toThrow("quota below safety threshold");
  });
  it("rejects non-MiniMax model routes before querying the Subscription Key",async()=>{
    vi.mocked(getServerAiConnectionStatus).mockImplementation(async role=>({
      configured:true,connection:{model:role==="generation"?"other-model":"other-model-judge",
        baseUrl:generation.baseUrl},
    } as never));
    vi.mocked(assertLabMiniMaxSubscriptionRoutes).mockImplementationOnce(()=>{
      throw Object.assign(new Error("unsupported route"),{code:"LAB_MINIMAX_ROUTE_UNSUPPORTED"});
    });
    await expect(prepareLabWorkflowStart({...input,requestedAt:new Date().toISOString()}))
      .rejects.toMatchObject({code:"LAB_MINIMAX_ROUTE_UNSUPPORTED"});
    expect(fetchMiniMaxSubscriptionQuota).not.toHaveBeenCalled();
  });
  it("does not treat the Lab approval token as portable outside an isolated deployment",async()=>{
    delete process.env.EVOLUTION_EXPERIMENT_MODE;
    await expect(prepareLabWorkflowStart({...input,requestedAt:new Date().toISOString()}))
      .rejects.toMatchObject({code:"LAB_APPROVAL_OUTSIDE_ISOLATION"});
    expect(await prepareLabWorkflowStart({...input,approval:undefined,requestedAt:new Date().toISOString()}))
      .toBeUndefined();
  });
});