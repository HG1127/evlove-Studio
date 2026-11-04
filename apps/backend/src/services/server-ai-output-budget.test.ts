// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {runServerAi,serverAiScoringRouteFingerprint} from "./ai-gateway";
import * as connections from "./server-ai-connection";
import {withServerAiOutputPolicy} from "./server-ai-output-policy";
import {serverAiOutputTokenLimit} from "./server-ai-output-budget";

const sdk=vi.hoisted(()=>({generateText:vi.fn()}));
vi.mock("ai",()=>({generateText:sdk.generateText,gateway:(model:string)=>model,Output:{object:(schema:unknown)=>schema}}));
const input={connectionId:"synthetic-budget",label:"Synthetic",apiKey:"synthetic-only",baseUrl:"https://fixture.invalid/v1",model:"fixture",protocol:"chat-completions" as const,responseFormat:"prompt-json" as const};
const config={mode:"openai-compatible" as const,apiKey:input.apiKey,baseUrl:input.baseUrl,model:input.model,protocol:input.protocol,timeoutMs:10000};
const judgement={accuracy:90,evidence:90,riskCoverage:90,completeness:90,safety:"PASS",notes:[],failures:[],cases:[],criteria:[]};
const reply={schemaVersion:"paired-evaluation-v1",requestFingerprint:"synthetic-only",versions:["A","B","C"].map(slot=>({slot,result:judgement}))};
const payload={evidence:"SYNTHETIC ONLY"};
beforeEach(()=>{vi.stubEnv("EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS","");vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","");vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","");});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();sdk.generateText.mockReset();});

it.each(["chat-completions","responses"] as const)("raises the observed official M3 ceiling through %s and binds its route",async protocol=>{
  const requests:Record<string,unknown>[]=[];
  vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{requests.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:JSON.stringify(reply)}:{choices:[{finish_reason:"stop",message:{content:JSON.stringify(reply)}}]}));}));
  await connections.withExplicitServerAiConnection({...input,baseUrl:"https://api.minimaxi.com/v1",model:"MiniMax-M3",protocol},async()=>{
    const automatic=await serverAiScoringRouteFingerprint();
    expect(await runServerAi("evaluate-paired",payload)).toEqual(reply);
    expect(requests[0]?.[protocol==="responses"?"max_output_tokens":"max_tokens"]).toBe(32768);
    vi.stubEnv("EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS",protocol==="responses"?"10000":"16384");
    expect(await serverAiScoringRouteFingerprint()).not.toBe(automatic);
    vi.stubEnv("EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS","32768");
    expect(await serverAiScoringRouteFingerprint()).toBe(automatic);
  });
});

it("preserves unaffected route identities and isolates explicit output budgets from other operations",async()=>{
  await connections.withExplicitServerAiConnection(input,async()=>{
    const original=await serverAiScoringRouteFingerprint();vi.stubEnv("EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS","16384");
    expect(await serverAiScoringRouteFingerprint()).toBe(original);vi.stubEnv("EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS","32768");
    expect(await serverAiScoringRouteFingerprint()).not.toBe(original);
  });
  expect(serverAiOutputTokenLimit("visual-judge",config,10000)).toBe(10000);
  expect(serverAiOutputTokenLimit("evaluate",config,8192)).toBe(8192);
});

it("binds both possible request limits when the direct protocol is implicit",async()=>{
  // Saved connections normalize the protocol; legacy environment connections may still omit it.
  vi.spyOn(connections,"resolveServerAiOperationConfig").mockResolvedValue({...config,protocol:undefined});
  const original=await serverAiScoringRouteFingerprint();
  for(const value of ["10000","16384","32768"]){
    vi.stubEnv("EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS",value);
    expect(await serverAiScoringRouteFingerprint()).not.toBe(original);
  }
  vi.stubEnv("EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS","");expect(await serverAiScoringRouteFingerprint()).toBe(original);
});

it.each(["https://api.minimaxi.com.attacker.invalid/v1","https://custom.invalid/v1"])("retains legacy output limits for an unqualified host%s",baseUrl=>{
  expect(serverAiOutputTokenLimit("evaluate-paired",{...config,baseUrl,model:"MiniMax-M3"},16384)).toBe(16384);
});

it.each(["minimax-m3","MINIMAX-M3","MiniMax-M3.1-Flash"])("does not infer output capacity for a different exact model ID %s",model=>{
  expect(serverAiOutputTokenLimit("evaluate-paired",{...config,baseUrl:"https://api.minimaxi.com/v1",model},16384)).toBe(16384);
});

it.each(["0","1023","65537","NaN","Infinity","16384.5","not-a-number"])("rejects invalid configured budget%s before provider I/O",async value=>{
  vi.stubEnv("EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS",value);const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(connections.withExplicitServerAiConnection(input,()=>runServerAi("evaluate-paired",payload))).rejects.toMatchObject({code:"AI_OUTPUT_BUDGET_INVALID"});
  expect(fetch).not.toHaveBeenCalled();
});

it("applies the explicit paired budget to the installed SDK transport",async()=>{
  vi.stubEnv("EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS","32768");
  vi.spyOn(connections,"resolveServerAiOperationConfig").mockResolvedValue({mode:"vercel-gateway",model:"synthetic/model",timeoutMs:10000});
  sdk.generateText.mockResolvedValue({output:reply});
  expect(await runServerAi("evaluate-paired",payload)).toEqual(reply);
  expect(sdk.generateText).toHaveBeenCalledWith(expect.objectContaining({maxOutputTokens:32768}));
});

it("rejects invalid SDK budgets before generation",async()=>{
  vi.stubEnv("EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS","65537");
  vi.spyOn(connections,"resolveServerAiOperationConfig").mockResolvedValue({mode:"vercel-gateway",model:"synthetic/model",timeoutMs:10000});
  await expect(runServerAi("evaluate-paired",payload)).rejects.toMatchObject({code:"AI_OUTPUT_BUDGET_INVALID"});
  expect(sdk.generateText).not.toHaveBeenCalled();
});

it("still rejects a truncated paired reply without another generation or format repair",async()=>{
  vi.stubEnv("EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS","32768");
  const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"length",message:{content:JSON.stringify(reply)}}]})));vi.stubGlobal("fetch",fetch);
  await expect(withServerAiOutputPolicy({formatCorrection:"forbid"},()=>connections.withExplicitServerAiConnection(input,()=>runServerAi("evaluate-paired",payload)))).rejects.toMatchObject({code:"AI_OUTPUT_INCOMPLETE"});
  expect(fetch).toHaveBeenCalledTimes(1);
});
