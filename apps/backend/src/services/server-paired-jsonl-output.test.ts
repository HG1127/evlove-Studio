// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {PAIRED_JSONL_PROTOCOL,PairedEvaluationAiResultSchema} from "@evolution/contracts";
import {serverPairedJsonlOutput,SERVER_PAIRED_JSONL_GENERATION_VERSION} from "./server-paired-jsonl-output";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {withServerAiOutputPolicy} from "./server-ai-output-policy";
import {runServerAi,serverAiScoringRouteFingerprint} from "./ai-gateway";

const input={connectionId:"fixture",label:"Fixture",apiKey:"test-only",baseUrl:"https://fixture.invalid/v1",model:"fixture",protocol:"chat-completions" as const,responseFormat:"json-schema" as const};
const payload={schemaVersion:"paired-judge-input-v1",requestFingerprint:"fixed:0",issuedCriterionCaseBindings:[{criterionId:"GOAL",testCaseIds:["T1"]}],acceptanceRubric:[{id:"GOAL"}],testCases:[{id:"T1",criterionIds:["GOAL"]}]};
const summary={accuracy:90,evidence:91,riskCoverage:92,completeness:93,safety:"PASS",notes:["quoted\nsource"],failures:[],cases:[]};
const row={criterionId:"GOAL",score:94,pass:true,evidence:["actual quote"],gaps:[],testCaseIds:["T1"]};
const records=[{kind:"header",protocol:PAIRED_JSONL_PROTOCOL,requestFingerprint:"fixed:0"},...["A","B","C"].flatMap(slot=>[{kind:"summary",slot,value:summary},{kind:"criterion",slot,value:row}]),{kind:"end",requestFingerprint:"fixed:0",criterionRecords:3}];
const text=records.map(r=>JSON.stringify(r)).join("\n");
const scoped=<T>(work:()=>T)=>withServerAiOutputPolicy({formatCorrection:"forbid",pairedTransport:"jsonl-v1"},work);
beforeEach(()=>vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT",""));
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("separates exact data examples from grammar metadata while retaining strict header rejection",()=>{
 const output=serverPairedJsonlOutput(payload,PairedEvaluationAiResultSchema,"Unchanged evaluation instructions.");
 expect(SERVER_PAIRED_JSONL_GENERATION_VERSION).toBe("paired-jsonl-generation-v2-explicit-records");
 expect(output.system).toContain(JSON.stringify(records[0]));expect(output.system).toContain(JSON.stringify(records.at(-1)));
 const grammar=JSON.parse(output.system.split("record schema:\n")[1]!);
 expect(grammar).not.toHaveProperty("$schema");expect(output.system).toContain("NOT a record to copy");
 const invalid=structuredClone(records);Object.assign(invalid[0]!,{$schema:"https://json-schema.org/draft/2020-12/schema"});
 expect(()=>output.parse(invalid.map(r=>JSON.stringify(r)).join("\n"))).toThrow();
});
for(const protocol of ["chat-completions","responses"] as const){
 it("parses the explicit "+protocol+" line transport without an object-format constraint",async()=>{
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));expect(body).not.toHaveProperty("response_format");expect(body).not.toHaveProperty("text");
   const system=protocol==="responses"?body.input[0].content[0].text:body.messages[0].content;
   expect(system).toContain(PAIRED_JSONL_PROTOCOL);expect(system).toContain("one complete JSON object per line");
   return new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:text}:{choices:[{message:{content:text}}]}),{status:200});
  });vi.stubGlobal("fetch",fetch);
  const result=await scoped(()=>withExplicitServerAiConnection({...input,protocol},()=>runServerAi("evaluate-paired",payload)));
  expect(result.versions.map(v=>v.result)).toEqual([1,2,3].map(()=>({...summary,criteria:[row]})));expect(fetch).toHaveBeenCalledTimes(1);
 });
 it("separates a complete leading reasoning envelope from "+protocol+" JSONL without another request",async()=>{
  const final='<think>PRIVATE_REASONING with {"kind":"invented"}</think>\n\n'+text;
  const fetch=vi.fn(async()=>new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:final}
   :{choices:[{message:{content:final},finish_reason:"stop"}]}),{status:200}));vi.stubGlobal("fetch",fetch);
  const result=await scoped(()=>withExplicitServerAiConnection({...input,protocol},()=>runServerAi("evaluate-paired",payload)));
  expect(result.versions.map(v=>v.result)).toEqual([1,2,3].map(()=>({...summary,criteria:[row]})));
  expect(JSON.stringify(result)).not.toContain("PRIVATE_REASONING");expect(fetch).toHaveBeenCalledTimes(1);
 });
}
it.each([
 ['<think>unfinished',"AI_OUTPUT_INCOMPLETE"],
 ['<think>only reasoning</think>',"AI_OUTPUT_MISSING_FINAL"],
 ['<think>complete</think>\n'+text.slice(0,-1),"AI_OUTPUT_INVALID_JSONL"],
 ['<think>complete</think>\n```json\n'+text+'\n```',"AI_OUTPUT_INVALID_JSONL"],
 ['<think>complete</think>\n'+text+'\n\n',"AI_OUTPUT_INVALID_JSONL"],
 ['\uFEFF<think>complete</think>\n'+text,"AI_OUTPUT_INVALID_JSONL"],
 ['<think>complete</think>\n\uFEFF'+text,"AI_OUTPUT_INVALID_JSONL"],
 ['<think>complete</think>\n\u00A0'+text,"AI_OUTPUT_INVALID_JSONL"],
])("retains strict final rejection for wrapped output %#",async(content,code)=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content},finish_reason:"stop"}]}),{status:200}));vi.stubGlobal("fetch",fetch);
 await expect(scoped(()=>withExplicitServerAiConnection(input,()=>runServerAi("evaluate-paired",payload)))).rejects.toMatchObject({code});
 expect(fetch).toHaveBeenCalledTimes(1);
});
it("never retries malformed JSONL or falls back to a valid object reply",async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:text.slice(0,-1)}}]}),{status:200}));vi.stubGlobal("fetch",fetch);
 await expect(scoped(()=>withExplicitServerAiConnection(input,()=>runServerAi("evaluate-paired",payload)))).rejects.toMatchObject({code:"AI_OUTPUT_INVALID_JSONL"});expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects other operations before provider I/O",async()=>{
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 await expect(scoped(()=>withExplicitServerAiConnection(input,()=>runServerAi("visual-judge",{})))).rejects.toThrow("evaluate-paired only");expect(fetch).not.toHaveBeenCalled();
});
it("binds line transport into scoring identity without changing the default identity",async()=>{
 await withExplicitServerAiConnection(input,async()=>{
  const original=await serverAiScoringRouteFingerprint();const changed=await scoped(()=>serverAiScoringRouteFingerprint());
  expect(changed).not.toBe(original);expect(await serverAiScoringRouteFingerprint()).toBe(original);
 });
});
