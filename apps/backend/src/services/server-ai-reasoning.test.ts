// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {getServerAiConfig} from "../server-env";
import {runServerAi,serverAiScoringRouteFingerprint} from "./ai-gateway";
import {resolveServerAiConfig,withExplicitServerAiConnection} from "./server-ai-connection";

const key="EVOLUTION_AI_REASONING_EFFORT",previous=new Map<string,string|undefined>();
const keys=[key,"EVOLUTION_AI_API_KEY","EVOLUTION_AI_MODEL","EVOLUTION_AI_BASE_URL","OPENAI_API_KEY","OPENAI_MODEL","VERCEL","VERCEL_ENV","VERCEL_OIDC_TOKEN","EVOLUTION_AI_GATEWAY_ENABLED"];
const input={connectionId:"reasoning-test",label:"Test",apiKey:"private-test-key",model:"test-model",baseUrl:"https://provider.test/v1",protocol:"chat-completions" as const,responseFormat:"prompt-json" as const};
const result={scores:{usability:90,aesthetics:90,responsiveness:90,interaction:90},summary:"Observed",findings:["observed layout"]};
beforeEach(()=>{for(const k of keys){previous.set(k,process.env[k]);delete process.env[k];}});
afterEach(()=>{for(const k of keys){const v=previous.get(k);if(v===undefined)delete process.env[k];else process.env[k]=v;}vi.unstubAllGlobals();});

describe("explicit direct-provider reasoning effort",()=>{
  it.each(["chat-completions","responses"] as const)("passes the pinned option through %s without changing task evidence",async protocol=>{
    process.env[key]="medium";
    const requests:Array<Record<string,unknown>>=[];
    vi.stubGlobal("fetch",vi.fn(async(_u:unknown,init?:RequestInit)=>{requests.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:JSON.stringify(result)}:{choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]}));}));
    await withExplicitServerAiConnection({...input,protocol},async()=>{
      process.env[key]="low";
      expect(await resolveServerAiConfig()).toMatchObject({reasoningEffort:"medium"});
      expect(await runServerAi("visual-judge",{evidence:"UNCHANGED"})).toEqual(result);
    });
    expect(requests).toHaveLength(1);
    expect(protocol==="responses"?requests[0]?.reasoning:requests[0]?.reasoning_effort).toEqual(protocol==="responses"?{effort:"medium"}:"medium");
    expect(JSON.stringify(requests[0])).toContain("UNCHANGED");
  });
  it("invalidates scoring identity when effort changes and preserves the default route when unset",async()=>{
    const fingerprint=()=>withExplicitServerAiConnection(input,()=>serverAiScoringRouteFingerprint());
    const original=await fingerprint();process.env[key]="medium";const medium=await fingerprint();process.env[key]="max";const max=await fingerprint();delete process.env[key];
    expect(medium).not.toBe(original);expect(max).not.toBe(medium);expect(await fingerprint()).toBe(original);
  });
  it("resolves environment-only routes and rejects invalid options before a request",async()=>{
    process.env.EVOLUTION_AI_API_KEY=input.apiKey;process.env.EVOLUTION_AI_MODEL=input.model;
    process.env[key]="medium";expect(getServerAiConfig()).toMatchObject({reasoningEffort:"medium"});
    process.env[key]="automatic";
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    expect(()=>getServerAiConfig()).toThrow();
    await expect(Promise.resolve().then(()=>withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{})))).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects an unsupported Gateway option instead of silently using a different effort",()=>{
    process.env.VERCEL="1";process.env.EVOLUTION_AI_GATEWAY_ENABLED="true";process.env[key]="medium";
    expect(()=>getServerAiConfig()).toThrow(/仅适用于直接模型连接/);
  });
});
