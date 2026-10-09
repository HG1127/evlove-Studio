import {afterEach,describe,expect,it,vi} from "vitest";
import {BuildCandidateAiResultSchema,jsonSchemas} from "@evolution/contracts";
import {callByokStructured,type ResolvedByok} from "./byok";
const resolved:ResolvedByok={preset:{id:"custom",name:"Synthetic final",kind:"openai",defaultBaseUrl:"https://provider.example.test/v1",consoleUrl:"",defaultModel:"x",vision:false,cors:"yes",note:""},config:{enabled:true,providerId:"custom",apiKey:"fictional-final-key",model:"x"},baseUrl:"https://provider.example.test/v1"};
const artifact='<html><body>原文 <think>{"literal":true}</think>\n```json\n{"literal":"must remain"}\n```\n结束;</body></html>';
const candidate={artifacts:[{sourceArtifactId:"synthetic-source",name:"candidate.html",mimeType:"text/html",content:artifact}],summary:"Synthetic Candidate"};
const json=JSON.stringify(candidate);
const call=(schemaRetries=0,connection=resolved)=>callByokStructured({resolved:connection,system:"Synthetic only",user:"No original files",schema:jsonSchemas.buildCandidate,parser:BuildCandidateAiResultSchema,schemaRetries});
afterEach(()=>{vi.unstubAllGlobals();window.localStorage.clear();});
describe("browser final Candidate JSON boundary",()=>{
 it.each([json,'```json\n'+json+'\n```','<think>Intermediate {"wrong":"reasoning"}.</think>\n'+json,'<think>Intermediate</think>\n```json\n'+json+'\n```'].flatMap(output=>["chat","responses"].map(protocol=>({output,protocol}))))("preserves literal artifact wrappers and final JSON via $protocol",async({output,protocol})=>{
  const connection={...resolved,preset:{...resolved.preset,responsesFirst:protocol==="responses"}};
  const request=vi.fn(async(url:string)=>{expect(url.endsWith(protocol==="responses"?"/responses":"/chat/completions")).toBe(true);return new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:output}:{choices:[{finish_reason:"stop",message:{content:output}}]}));});vi.stubGlobal("fetch",request);
  expect((await call(0,connection)).artifacts[0].content).toBe(artifact);expect(request).toHaveBeenCalledTimes(1);
 });
 it.each(['<think>'+json+'</think>','<think>'+json,'{"artifacts":[{"sourceArtifactId":"synthetic-source","name":"candidate.html","mimeType":"text/html","content":"truncated artifact'])('rejects nonfinal output instead of closing strings and inventing an Artifact',async output=>{
  const request=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:output}}]})));vi.stubGlobal("fetch",request);await expect(call()).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
 });
 it("can retry malformed JSON with a new complete reply while preserving final artifact content",async()=>{
  let index=0;const bodies:string[]=[];const request=vi.fn(async(_url:string,init?:RequestInit)=>{bodies.push(String(init?.body));return new Response(JSON.stringify({choices:[{message:{content:index++===0?'private-source malformed':json}}]}));});vi.stubGlobal("fetch",request);
  expect((await call(1)).artifacts[0].content).toBe(artifact);expect(request).toHaveBeenCalledTimes(2);
  expect(bodies[1]).not.toContain('private-source malformed');
 });
});