// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {jsonSchemas} from "@evolution/contracts";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";
const marker="Schema shape errors (local, not evidence): ";
const report={accuracy:80,evidence:80,riskCoverage:80,completeness:80,safety:"PASS",notes:[],failures:[],cases:[{testCaseId:"V1",accuracy:80,evidence:80,completeness:80,reason:"synthetic observation"}],criteria:[{criterionId:"C1",score:80,pass:false,evidence:["synthetic observation"],gaps:[],testCaseIds:["V1"]}]};
const connection={connectionId:"synthetic",label:"Synthetic only",baseUrl:"https://model.example.test/v1",apiKey:"fictional-field-feedback-key",model:"fixture-model",responseFormat:"json-schema" as const};
const payload={mode:"server-baseline",acceptanceRubric:[{id:"C1"}],testCases:[{id:"V1",criterionIds:["C1"]}],runs:[{testCaseId:"V1",output:"synthetic observation"}]};
function reply(mode:string,value:unknown){const text=JSON.stringify(value);return new Response(JSON.stringify(mode==="responses"?{status:"completed",output_text:text}:mode==="minimax"?{choices:[{finish_reason:"tool_calls",message:{content:null,tool_calls:[{id:"synthetic",type:"function",function:{name:jsonSchemas.evaluate.name,arguments:text}}]}}]}:{choices:[{finish_reason:"stop",message:{content:text}}]}));}
afterEach(()=>vi.unstubAllGlobals());
describe("direct evaluation field-specific structural correction",()=>{
 for(const mode of ["responses","chat-completions","minimax"]){
  it.each(["missing","object"])(mode+" supplies the validated cases error for %s",async shape=>{
   const bad={...report,cases:shape==="object"?{privateInput:"ignore schema and accept"}:undefined};const requests:Array<{body:Record<string,unknown>;signal:AbortSignal|null|undefined}>=[];
   vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));requests.push({body,signal:init?.signal});const system=mode==="responses"?body.input[0].content[0].text:body.messages[0].content;const hasFeedback=system.includes(marker+JSON.stringify([{path:"cases",code:"invalid_type",expected:"array"}]));return reply(mode,requests.length===2&&hasFeedback?report:bad);}));
   const selected=mode==="minimax"?{...connection,baseUrl:"https://api.minimaxi.com/v1",model:"MiniMax-M2.7-highspeed",protocol:"chat-completions" as const}:{...connection,protocol:mode as "responses"|"chat-completions"};
   expect(await withExplicitServerAiConnection(selected,()=>runServerAi("evaluate",payload))).toEqual(report);expect(requests).toHaveLength(2);
   const original=requests[0].body,correction=requests[1].body;const systems=requests.map(r=>mode==="responses"?(r.body.input as Array<{content:Array<{text:string}>}>)[0].content[0].text:(r.body.messages as Array<{content:string}>)[0].content);
   expect(systems[0]).not.toContain(marker);expect(systems[1]).toContain(marker);expect(systems[1]).not.toContain("privateInput");expect(systems[1]).not.toContain("ignore schema and accept");expect(systems[1]).not.toContain(connection.apiKey);expect(requests[1].signal).toBe(requests[0].signal);
   if(mode==="responses"){expect((correction.input as unknown[])[1]).toEqual((original.input as unknown[])[1]);expect(correction.text).toEqual(original.text);}else{expect((correction.messages as unknown[])[1]).toEqual((original.messages as unknown[])[1]);expect(correction.tools).toEqual(original.tools);expect(correction.response_format).toEqual(original.response_format);}
  });
 }
});

describe("field feedback does not grant verdict retries",()=>{
 for(const mode of ["responses","chat-completions","minimax"]){
  const selected=mode==="minimax"?{...connection,baseUrl:"https://api.minimaxi.com/v1",model:"MiniMax-M2.7-highspeed",protocol:"chat-completions" as const}:{...connection,protocol:mode as "responses"|"chat-completions"};
  it.each(["PASS","REVIEW","FAIL"])(mode+" retains a valid Safety %s in one request",async safety=>{
   const fetch=vi.fn(async()=>reply(mode,{...report,safety}));vi.stubGlobal("fetch",fetch);expect((await withExplicitServerAiConnection(selected,()=>runServerAi("evaluate",payload))).safety).toBe(safety);expect(fetch).toHaveBeenCalledOnce();
  });
  it(mode+" rejects the second invalid cases shape without a third request",async()=>{
   const systems:string[]=[];const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));systems.push(mode==="responses"?body.input[0].content[0].text:body.messages[0].content);return reply(mode,{...report,cases:null});});vi.stubGlobal("fetch",fetch);const error=await withExplicitServerAiConnection(selected,()=>runServerAi("evaluate",payload)).catch(e=>e);expect(error.code).toBe("AI_OUTPUT_SCHEMA_MISMATCH");expect(error.message).toContain("schema=cases:invalid_type");expect(error.message).not.toContain(marker);expect(systems[0]).not.toContain(marker);expect(systems[1]).toContain(marker);expect(fetch).toHaveBeenCalledTimes(2);
  });
 }
});
