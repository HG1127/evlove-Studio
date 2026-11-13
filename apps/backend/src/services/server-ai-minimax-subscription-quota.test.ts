// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import type {ServerAiConfig} from "../server-env";
import {assertMiniMaxSubscriptionQuotaSufficient,fetchMiniMaxSubscriptionQuota} from "./server-ai-minimax-subscription-quota";

const key="SYNTHETIC_MPLAN_SUBSCRIPTION_KEY_DO_NOT_USE";
const config:ServerAiConfig={mode:"openai-compatible",apiKey:key,baseUrl:"https://api.minimax.io/v1",
  model:"MiniMax-M3.1-Flash",protocol:"chat-completions",timeoutMs:1000};
const success=()=>({
  base_resp:{status_code:0,status_msg:"success"},
  model_remains:[
    {model_name:"general",current_interval_remaining_percent:82,current_interval_status:1,
      current_weekly_remaining_percent:91,current_weekly_status:1,
      start_time:Date.now()-1000,end_time:Date.now()+3*60*60*1000,
      weekly_start_time:Date.now()-1000,weekly_end_time:Date.now()+3*24*60*60*1000,
      current_interval_total_count:0,current_interval_usage_count:0,
      current_weekly_total_count:0,current_weekly_usage_count:0},
    {model_name:"video",current_interval_remaining_percent:100,current_interval_status:3,
      current_weekly_remaining_percent:100,current_weekly_status:3},
  ],
});
afterEach(()=>vi.unstubAllGlobals());
describe("MiniMax M Plan subscription quota read-only adapter",()=>{
  it("queries the official region endpoint with the existing Subscription Key and returns only safe general quota metadata",async()=>{
    const calls:Array<{url:string;init:RequestInit}>=[];
    vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{
      calls.push({url,init});return new Response(JSON.stringify(success()),{status:200});
    }));
    const quota=await fetchMiniMaxSubscriptionQuota(config);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://www.minimax.io/v1/token_plan/remains");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer "+key);
    expect(quota).toMatchObject({provider:"minimax-m-plan",modelGroup:"general",
      intervalRemainingPercent:82,weeklyRemainingPercent:91});
    expect(JSON.stringify(quota)).not.toContain(key);
    expect(JSON.stringify(quota)).not.toContain("video");
    expect(assertMiniMaxSubscriptionQuotaSufficient(quota)).toEqual(quota);
  });
  it("maps the official China API host to the China Token Plan endpoint without crossing regions",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(success()),{status:200})));
    await fetchMiniMaxSubscriptionQuota({...config,baseUrl:"https://api.minimaxi.com/v1"});
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("https://www.minimaxi.com/v1/token_plan/remains");
    await expect(fetchMiniMaxSubscriptionQuota({...config,baseUrl:"https://api.minimax.cn/v1"}))
      .rejects.toMatchObject({code:"LAB_MINIMAX_REGION_UNSUPPORTED"});
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("rejects unsupported providers and regions before sending a request",async()=>{
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    await expect(fetchMiniMaxSubscriptionQuota({...config,model:"other-model"}))
      .rejects.toMatchObject({code:"LAB_MINIMAX_SUBSCRIPTION_REQUIRED"});
    await expect(fetchMiniMaxSubscriptionQuota({...config,baseUrl:"https://provider.example/v1"}))
      .rejects.toMatchObject({code:"LAB_MINIMAX_REGION_UNSUPPORTED"});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects invalid quota API base URLs before sending an existing Subscription Key anywhere",async()=>{
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    const malicious=[
      "http://api.minimaxi.com/v1",
      "https://api.minimaxi.com/v2",
      "https://api.minimaxi.com/v1/chat/completions",
      "https://api.minimaxi.com/v1?x=1",
      "https://api.minimaxi.com/v1#fragment",
      "https://user:password@api.minimaxi.com/v1",
      "https://api.minimaxi.com.attacker.test/v1",
    ];
    for(const baseUrl of malicious){
      await expect(fetchMiniMaxSubscriptionQuota({...config,baseUrl}))
        .rejects.toMatchObject({code:baseUrl.includes("attacker")?"LAB_MINIMAX_REGION_UNSUPPORTED":"LAB_MINIMAX_ROUTE_INVALID"});
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for business auth failures, missing general rows and unknown response shapes",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({base_resp:{status_code:1004,status_msg:"private provider detail"}}),{status:200})));
    await expect(fetchMiniMaxSubscriptionQuota(config)).rejects.toMatchObject({code:"LAB_MINIMAX_SUBSCRIPTION_AUTH_FAILED"});
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({base_resp:{status_code:0},model_remains:[{model_name:"video"}]}),{status:200})));
    await expect(fetchMiniMaxSubscriptionQuota(config)).rejects.toMatchObject({code:"LAB_MINIMAX_QUOTA_INVALID"});
  });
  it("rejects exhausted, inactive, missing and stale windows; never treats 0/0 or status 3 as unlimited general quota",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      base_resp:{status_code:0},model_remains:[{...success().model_remains[0],
        current_interval_status:2,current_interval_remaining_percent:100}],
    }),{status:200})));
    await expect(fetchMiniMaxSubscriptionQuota(config)).rejects.toMatchObject({code:"LAB_MINIMAX_QUOTA_INACTIVE"});
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      base_resp:{status_code:0},model_remains:[{...success().model_remains[0],current_weekly_status:3}],
    }),{status:200})));
    await expect(fetchMiniMaxSubscriptionQuota(config)).rejects.toMatchObject({code:"LAB_MINIMAX_QUOTA_INACTIVE"});
  });
  it("blocks quota below the configured safety threshold",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      base_resp:{status_code:0},model_remains:[{...success().model_remains[0],current_interval_remaining_percent:49}],
    }),{status:200})));
    const quota=await fetchMiniMaxSubscriptionQuota(config);
    expect(()=>assertMiniMaxSubscriptionQuotaSufficient(quota)).toThrowError(/安全阈值/);
  });
  it("does not leak upstream error bodies, credentials, or accept non-success HTTP",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("private raw body "+key,{status:401})));
    await expect(fetchMiniMaxSubscriptionQuota(config))
      .rejects.toMatchObject({code:"LAB_MINIMAX_SUBSCRIPTION_AUTH_FAILED"});
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("private raw body "+key,{status:503})));
    await expect(fetchMiniMaxSubscriptionQuota(config))
      .rejects.toMatchObject({code:"LAB_MINIMAX_QUOTA_UNAVAILABLE"});
  });
});