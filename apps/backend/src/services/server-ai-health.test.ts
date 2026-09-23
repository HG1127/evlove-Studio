// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {getPassiveServerAiHealth,probeServerAiRuntime,resetServerAiRuntimeProbeCache} from "./server-ai-health";

const KEYS=[
  "VERCEL","VERCEL_ENV","VERCEL_OIDC_TOKEN","EVOLUTION_AI_GATEWAY_ENABLED",
  "EVOLUTION_AI_API_KEY","OPENAI_API_KEY","EVOLUTION_AI_MODEL","OPENAI_MODEL",
] as const;
const previous=new Map<string,string|undefined>();

beforeEach(()=>{
  for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
});
  resetServerAiRuntimeProbeCache();
afterEach(()=>{
  resetServerAiRuntimeProbeCache();
  for(const key of KEYS){
    const value=previous.get(key);
    if(value===undefined)delete process.env[key];
    else process.env[key]=value;
  }
});

describe("Server AI runtime health",()=>{
  it("distinguishes configured from runtime verified",async()=>{
    process.env.EVOLUTION_AI_API_KEY="test-key";
    process.env.EVOLUTION_AI_MODEL="test-model";
    expect(getPassiveServerAiHealth()).toMatchObject({
      configured:true,ready:false,runtimeVerified:false,status:"not-checked",mode:"openai-compatible",
    });
    const health=await probeServerAiRuntime(async()=>({ok:true}));
    expect(health).toMatchObject({
      configured:true,ready:true,runtimeVerified:true,status:"ready",
    });
  });

  it("reports Vercel customer verification as provider unavailable instead of generic error",async()=>{
    process.env.VERCEL="1";
    process.env.EVOLUTION_AI_GATEWAY_ENABLED="true";
    const health=await probeServerAiRuntime(async()=>{
      throw Object.assign(new Error("AI Gateway requires a valid credit card; customer_verification_required"),{status:403});
    });
    expect(health).toMatchObject({
      configured:true,ready:false,runtimeVerified:true,status:"unavailable",
      reasonCode:"customer-verification-required",
    });
  });

  it("deduplicates concurrent probes and reuses the short TTL cache",async()=>{
    process.env.EVOLUTION_AI_API_KEY="test-key";
    process.env.EVOLUTION_AI_MODEL="test-model";
    const runner=vi.fn(async()=>({ok:true}));

    const [first,second]=await Promise.all([
      probeServerAiRuntime(runner),
      probeServerAiRuntime(runner),
    ]);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");

    const cached=await probeServerAiRuntime(runner);
    expect(cached.status).toBe("ready");
    expect(runner).toHaveBeenCalledTimes(1);

    const forced=await probeServerAiRuntime(runner,{force:true});
    expect(forced.status).toBe("ready");
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("reports a missing provider without invoking the runner",async()=>{
    let calls=0;
    const health=await probeServerAiRuntime(async()=>{calls+=1;return {};});
    expect(health).toMatchObject({configured:false,ready:false,status:"unconfigured"});
    expect(calls).toBe(0);
  });
});
