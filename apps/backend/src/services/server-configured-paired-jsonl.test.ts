// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {PAIRED_JSONL_PROTOCOL,type PairedEvaluationAiResult} from "@evolution/contracts";
import {serverPairedJudgeRequest} from "@evolution/harness";
import {pairedJudgeFixture,pairedJudgeRawEvaluation} from "@evolution/testkit";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {withServerAiOutputPolicy} from "./server-ai-output-policy";
import {runServerAi,serverAiScoringRouteFingerprint} from "./ai-gateway";
import {runServerPairedEvidenceJudge} from "./server-paired-evidence-judge";

const connection={connectionId:"fixture",label:"Fixture",apiKey:"test-only",baseUrl:"https://fixture.invalid/v1",model:"fixture",protocol:"chat-completions" as const,responseFormat:"json-schema" as const};
const request=()=>{const x=pairedJudgeFixture();return serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");};
const modelPayload=(init?:RequestInit)=>{
 const body=JSON.parse(String(init?.body)) as {messages:Array<{role:string;content:string}>;response_format?:unknown};
 const payload=JSON.parse(body.messages.find(m=>m.role==="user")!.content) as {requestFingerprint:string};
 return {body,payload};
};
function reply(fingerprint:string){
 const original=pairedJudgeRawEvaluation(90),candidate=pairedJudgeRawEvaluation(95),reverse=fingerprint.endsWith(":1");
 const versions:PairedEvaluationAiResult["versions"]=[{slot:"A",result:reverse?candidate:original},{slot:"B",result:reverse?original:candidate},{slot:"C",result:structuredClone(original)}];
 const records:unknown[]=[{kind:"header",protocol:PAIRED_JSONL_PROTOCOL,requestFingerprint:fingerprint}];
 for(const arm of versions){const {criteria,...summary}=arm.result;records.push({kind:"summary",slot:arm.slot,value:summary});for(const row of criteria)records.push({kind:"criterion",slot:arm.slot,value:row});}
 records.push({kind:"end",requestFingerprint:fingerprint,criterionRecords:3});
 return records.map(r=>JSON.stringify(r)).join("\n");
}
const response=(content:string)=>new Response(JSON.stringify({choices:[{message:{content},finish_reason:"stop"}]}),{status:200});
const assess=()=>withExplicitServerAiConnection(connection,()=>runServerPairedEvidenceJudge(request(),{
 invoke:payload=>runServerAi("evaluate-paired",payload),routeFingerprint:serverAiScoringRouteFingerprint,
}));
beforeEach(()=>vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","jsonl-v1"));
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe("configured paired JSONL through the normal composition route",()=>{
 it("uses the same transport and scoring identity outside a diagnostic scope",async()=>{
  await withExplicitServerAiConnection(connection,async()=>{
   const normal=await serverAiScoringRouteFingerprint();
   expect(await withServerAiOutputPolicy({formatCorrection:"forbid",pairedTransport:"jsonl-v1"},()=>serverAiScoringRouteFingerprint())).toBe(normal);
   vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","json");expect(await serverAiScoringRouteFingerprint()).not.toBe(normal);
   vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","jsonl-v1");expect(await serverAiScoringRouteFingerprint()).toBe(normal);
  });
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   const {body,payload}=modelPayload(init);expect(body).not.toHaveProperty("response_format");expect(body.messages[0]!.content).toContain(PAIRED_JSONL_PROTOCOL);
   return response(reply(payload.requestFingerprint));
  });vi.stubGlobal("fetch",fetch);
  const result=await assess();expect(fetch).toHaveBeenCalledTimes(2);expect(result.pairedComparison!.receipt.samples).toHaveLength(2);
  expect(result.pairedComparison!.receipt.samples.map(s=>s.candidate.criteria[0]!.score)).toEqual([95,95]);
 });
 it("leaves unrelated single-arm evaluation on its existing object contract",async()=>{
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   const {body}=modelPayload(init);expect(body).toHaveProperty("response_format");expect(body.messages[0]!.content).not.toContain(PAIRED_JSONL_PROTOCOL);
   return response(JSON.stringify(pairedJudgeRawEvaluation(90)));
  });vi.stubGlobal("fetch",fetch);
  const result=await withExplicitServerAiConnection(connection,()=>runServerAi("evaluate",{}));expect(result.accuracy).toBe(90);expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("assembles byte-identical provider requests under configured and equivalent diagnostic transport",async()=>{
  const bodies:string[]=[],issued=request();
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{bodies.push(String(init?.body));return response(reply(modelPayload(init).payload.requestFingerprint));});
  vi.stubGlobal("fetch",fetch);
  const execute=()=>withExplicitServerAiConnection(connection,()=>runServerPairedEvidenceJudge(issued,{invoke:p=>runServerAi("evaluate-paired",p),routeFingerprint:serverAiScoringRouteFingerprint}));
  await execute();vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","json");
  await withServerAiOutputPolicy({formatCorrection:"forbid",pairedTransport:"jsonl-v1"},execute);
  expect(fetch).toHaveBeenCalledTimes(4);expect(bodies.slice(0,2)).toEqual(bodies.slice(2));
 });
 it("stops a malformed configured line response without correction, JSON fallback or second order",async()=>{
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>response(reply(modelPayload(init).payload.requestFingerprint).slice(0,-1)));
  vi.stubGlobal("fetch",fetch);await expect(assess()).rejects.toMatchObject({code:"AI_OUTPUT_INVALID_JSONL"});expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("rejects invalid configuration before provider I/O",async()=>{
  vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","invalid-private-setting");const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(assess()).rejects.toThrow("Invalid paired AI transport configuration");expect(fetch).not.toHaveBeenCalled();
 });
 it("stops if the configured route changes after the first response",async()=>{
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   const content=reply(modelPayload(init).payload.requestFingerprint);vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","json");return response(content);
  });vi.stubGlobal("fetch",fetch);await expect(assess()).rejects.toThrow("Paired response or route binding differs");expect(fetch).toHaveBeenCalledTimes(1);
 });
});
