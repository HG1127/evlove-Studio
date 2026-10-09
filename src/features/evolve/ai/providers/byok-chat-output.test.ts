import {afterEach,describe,expect,it,vi} from "vitest";
import {z} from "zod";
import {callByokStructured,testByokConnection,type ResolvedByok} from "./byok";
const resolved:ResolvedByok={preset:{id:"custom",name:"Synthetic Chat",kind:"openai",defaultBaseUrl:"https://provider.example.test/v1",consoleUrl:"",defaultModel:"x",vision:false,cors:"yes",note:""},config:{enabled:true,providerId:"custom",apiKey:"fictional-chat-key",model:"x"},baseUrl:"https://provider.example.test/v1"};
const text='{"answer":"Synthetic reply"}';
const call=()=>callByokStructured({resolved,system:"Synthetic",user:"No files",schema:{name:"task",schema:{type:"object"}},parser:z.object({answer:z.string()})});
afterEach(()=>{vi.unstubAllGlobals();window.localStorage.clear();});
describe("browser Chat output boundary",()=>{
 it.each([{error:{message:"Synthetic error"}},{error:{}},{message:"Synthetic error"}])("rejects 200 body errors before JSON repair",async fields=>{
  const request=vi.fn(async()=>new Response(JSON.stringify({...fields,choices:[{message:{content:text}}]})));vi.stubGlobal("fetch",request);
  await expect(call()).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
 });
 it.each(["length","content_filter","tool_calls","function_call"])("rejects parseable JSON ending with %s in task and health probes",async finish_reason=>{
  const request=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason,message:{content:text}}],usage:{completion_tokens:24000}})));vi.stubGlobal("fetch",request);
  await expect(call()).rejects.toThrow();await expect(testByokConnection(resolved)).rejects.toThrow();expect(request).toHaveBeenCalledTimes(2);
 });
 it("rejects a refusal and redacts a key echoed by a body error",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:text,refusal:"Synthetic refusal"}}]}))));
  await expect(call()).rejects.toThrow();
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:text}}],error:{message:"Rejected "+resolved.config.apiKey}}))));
  for(const run of [call,()=>testByokConnection(resolved)]){const error=await run().catch(value=>value);expect(error).toBeInstanceOf(Error);expect(error.message).not.toContain(resolved.config.apiKey);expect(error.stack).not.toContain(resolved.config.apiKey);}
 });
 it("keeps legacy choices.text and multipart Responses-shaped Chat replies",async()=>{
  for(const body of [{choices:[{text}]},{status:"completed",output:[{content:[{type:"output_text",text:text.slice(0,12)}]},{content:[{type:"output_text",text:text.slice(12)}]}]}]){
   vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(body))));expect(await call()).toEqual({answer:"Synthetic reply"});
  }
 });
});