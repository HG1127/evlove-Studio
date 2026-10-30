// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import type {AiUsageLedgerRecord} from "@evolution/contracts";
import {fetchServerAiProviderUsage,withServerAiUsageScope,measureServerAiSdkUsage} from "./server-ai-usage";
import {withServerAiResponseProvenance} from "./server-ai-response-provenance";
const config={mode:"openai-compatible" as const,apiKey:"PRIVATE_KEY",model:"model",baseUrl:"https://provider.test/v1",timeoutMs:1000};
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
afterEach(()=>vi.unstubAllGlobals());
describe("physical response text provenance",()=>{
 it("never grants provenance to an empty scope or an opaque SDK generation",async()=>{
  await expect(withServerAiResponseProvenance(async()=>({alreadyParsed:true}))).rejects.toMatchObject({code:"AI_RESPONSE_PROVENANCE_NOT_RECORDED"});
  const invoke=vi.fn();await expect(withServerAiResponseProvenance(()=>measureServerAiSdkUsage(config,"evaluate-paired",invoke))).rejects.toMatchObject({code:"AI_RESPONSE_PROVENANCE_NOT_RECORDED"});expect(invoke).not.toHaveBeenCalled();
 });
 it.each(["responses","chat-completions"] as const)("binds exact %s body text and request without publishing private fields",async protocol=>{
  const text=' {"id":"reply","private":"PRIVATE_BODY正文"} \n',prompt='{"prompt":"PRIVATE_PROMPT"}',records:AiUsageLedgerRecord[]=[];
  const fetch=vi.fn(async()=>new Response(text));vi.stubGlobal("fetch",fetch);
  const captured=await withServerAiUsageScope({missionId:"mission",jobId:"job",phase:"experiment"},()=>withServerAiResponseProvenance(async()=>{
   const r=await fetchServerAiProviderUsage(config,protocol,"evaluate-paired",config.baseUrl,{method:"POST",body:prompt});return r.readJson();
  }),async r=>{records.push(r);});
  expect(captured.observations).toHaveLength(1);const o=captured.observations[0]!;
  expect(o.responseBodyTextSha256).toBe(sha(text));expect(o.requestBodyTextSha256).toBe(sha(prompt));expect(o.responseBodyUtf8Bytes).toBe(Buffer.byteLength(text));
  expect(o.request.callId).toBe(records[0]!.kind==="request-start"?records[0].request.callId:undefined);
  expect(JSON.stringify(captured.observations)).not.toMatch(/PRIVATE|provider\.test|Authorization/);expect(fetch).toHaveBeenCalledOnce();
 });
 it("rejects an unbound capture before provider I/O",async()=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(withServerAiResponseProvenance(()=>fetchServerAiProviderUsage(config,"chat-completions","evaluate-paired",config.baseUrl,{body:"{}"}))).rejects.toMatchObject({code:"AI_RESPONSE_PROVENANCE_NOT_RECORDED"});expect(fetch).not.toHaveBeenCalled();
 });
 it("retains completed usage but never retries when provenance persistence fails",async()=>{
  const records:AiUsageLedgerRecord[]=[],fetch=vi.fn(async()=>new Response('{"id":"reply"}'));vi.stubGlobal("fetch",fetch);
  await expect(withServerAiUsageScope({missionId:"mission",jobId:"job",phase:"experiment"},()=>withServerAiResponseProvenance(async()=>{
   const r=await fetchServerAiProviderUsage(config,"chat-completions","evaluate-paired",config.baseUrl,{body:"{}"});return r.readJson();
  },async()=>{throw Error("PRIVATE_STORAGE_ERROR");}),async r=>{records.push(r);})).rejects.toMatchObject({code:"AI_RESPONSE_PROVENANCE_NOT_RECORDED"});
  expect(fetch).toHaveBeenCalledOnce();expect(records.map(r=>r.kind)).toEqual(["request-start","request-result"]);
 });
 it("does not mint complete-body provenance for an interrupted response",async()=>{
  const write=vi.fn(),fetch=vi.fn(async()=>new Response(new ReadableStream({start(c){c.error(Error("interrupted"));}})));vi.stubGlobal("fetch",fetch);
  await expect(withServerAiUsageScope({missionId:"mission",jobId:"job",phase:"experiment"},()=>withServerAiResponseProvenance(async()=>{
   const r=await fetchServerAiProviderUsage(config,"responses","evaluate-paired",config.baseUrl,{body:"{}"});return r.readJson();
  },write),async()=>{})).rejects.toThrow();expect(write).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledOnce();
 });
});
