// @vitest-environment node
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {runServerAi} from "./ai-gateway";
const key="fictional-final-output-key";
const artifact='<html><body>原文 <think>{"literal":true}</think>\n```json\n{"literal":"must remain"}\n```\n结束; @</body></html>';
const candidate={artifacts:[{sourceArtifactId:"synthetic-source",name:"candidate.html",mimeType:"text/html",content:artifact,notes:[]}],summary:"Synthetic Candidate"};
const hash=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
const wrapped=(json:string)=>'<think>Intermediate {"invented":"not final"}.</think>\n```json\n'+json+'\n```';
async function nativeModel(content:string,protocol:"chat-completions"|"responses",responseFormat:"json-schema"|"json-object"|"prompt-json",run:(settings:Parameters<typeof withExplicitServerAiConnection>[0])=>Promise<void>,expectedRequests=1){
 const requests:string[]=[];const errors:string[]=[];
 const server=createServer(async(req,res)=>{
  try{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
   expect(req.headers.authorization).toBe("Bearer "+key);expect(body.model).toBe("x");expect(req.url).toBe(protocol==="responses"?"/v1/responses":"/v1/chat/completions");
   const format=protocol==="responses"?body.text?.format?.type:body.response_format?.type;expect(format).toBe(responseFormat==="prompt-json"?undefined:responseFormat==="json-object"?"json_object":"json_schema");
   requests.push(req.url!);res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(protocol==="responses"?{status:"completed",output_text:content}:{choices:[{finish_reason:"stop",message:{content}}]}));
  }catch(error){errors.push(String(error));res.writeHead(500);res.end('{"error":{"message":"Synthetic assertion"}}');}
 });
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 const address=server.address();if(!address||typeof address==="string")throw new Error("Invalid listener");
 try{await run({connectionId:"synthetic",label:"Synthetic final",apiKey:key,model:"x",baseUrl:`http://127.0.0.1:${address.port}/v1`,protocol,responseFormat});expect(requests).toHaveLength(expectedRequests);expect(errors).toEqual([]);}
 finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
}
describe("native model final JSON and exact Candidate content",()=>{
 it.each((['chat-completions','responses'] as const).flatMap(protocol=>(['json-schema','json-object','prompt-json'] as const).map(responseFormat=>({protocol,responseFormat}))))("keeps Candidate bytes through $protocol/$responseFormat reasoning and outer fences",async({protocol,responseFormat})=>{
  await nativeModel(wrapped(JSON.stringify(candidate)),protocol,responseFormat,async settings=>{
   const result=await withExplicitServerAiConnection(settings,()=>runServerAi("build-candidate",{command:"Synthetic only",artifacts:[]}));expect(result.artifacts[0].content).toBe(artifact);expect(hash(result.artifacts[0].content)).toBe(hash(artifact));expect(result.summary).toBe(candidate.summary);
  });
 });
 it.each(['chat-completions','responses'] as const)("keeps plain JSON containing artifact fences intact via %s",async protocol=>{
  await nativeModel(JSON.stringify(candidate),protocol,'json-object',async settings=>{const result=await withExplicitServerAiConnection(settings,()=>runServerAi("build-candidate",{}));expect(result.artifacts[0].content).toBe(artifact);});
 });
 it.each([["<think>unfinished","AI_OUTPUT_INCOMPLETE"],["<think>only reasoning</think>","AI_OUTPUT_MISSING_FINAL"],[wrapped('{"invented":"not a Candidate"}'),"AI_OUTPUT_SCHEMA_MISMATCH"],[wrapped('private-source '+key),"AI_OUTPUT_INVALID_JSON"]])("rejects nonfinal or malformed output with a safe code",async(content,code)=>{
  await nativeModel(content,'chat-completions','json-object',async settings=>{const error=await withExplicitServerAiConnection(settings,()=>runServerAi("build-candidate",{})).catch(value=>value);expect(error).toBeInstanceOf(Error);expect(error.code).toBe(code);expect(error.message).not.toContain(key);expect(error.message).not.toContain('private-source');},code==='AI_OUTPUT_SCHEMA_MISMATCH'?2:1);
 });
});