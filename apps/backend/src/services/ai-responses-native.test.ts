// @vitest-environment node
import {createServer} from "node:http";
import {afterEach,describe,expect,it} from "vitest";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {runServerAi,serverAiUnavailableReason} from "./ai-gateway";
import {probeServerAiRuntime,resetServerAiRuntimeProbeCache} from "./server-ai-health";
const key="fictional-native-model-key";
const answer={answer:"Native backend reply",suggestedAction:"none",evidence:[]};
afterEach(()=>resetServerAiRuntimeProbeCache());
async function nativeProvider(body:unknown,status=200){
 const requests:Array<{path:string|undefined;model:string;format:string|undefined}>=[];
 const errors:string[]=[];
 const server=createServer(async(req,res)=>{
  try{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const request=JSON.parse(Buffer.concat(chunks).toString("utf8"));
   expect(req.method).toBe("POST");expect(req.headers.authorization).toBe("Bearer "+key);
   expect(req.url).toBe("/v1/responses");expect(request.model).toBe("x");expect(request.store).toBe(false);
   requests.push({path:req.url,model:request.model,format:request.text?.format?.type});
   res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(body));
  }catch(error){errors.push(error instanceof Error?error.message:String(error));res.writeHead(500);res.end('{"error":{"message":"Synthetic fixture assertion"}}');}
 });
 await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 const address=server.address();if(!address||typeof address==="string")throw new Error("Invalid fixture listener");
 const settings={connectionId:"native",label:"Synthetic native",apiKey:key,baseUrl:`http://127.0.0.1:${address.port}/v1`,model:"x",protocol:"responses" as const,responseFormat:"json-object" as const};
 return {settings,requests,errors,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
describe("native backend Responses HTTP path (synthetic provider only)",()=>{
 it.each(["json-schema","json-object","prompt-json"] as const)("decodes multipart JSON through actual fetch using selected %s",async responseFormat=>{
  const fixture=await nativeProvider({status:"completed",output:[{type:"reasoning"},{content:[{type:"output_text",text:'{"answer":"Native'}]},{content:[{type:"output_text",text:' backend reply","suggestedAction":"none","evidence":[]}'}]}]});
  try{
   expect(await withExplicitServerAiConnection({...fixture.settings,responseFormat},()=>runServerAi("copilot",{command:"Synthetic only",artifacts:[]}))).toEqual(answer);
   expect(fixture.requests).toEqual([{path:"/v1/responses",model:"x",format:responseFormat==="prompt-json"?undefined:responseFormat==="json-object"?"json_object":"json_schema"}]);expect(fixture.errors).toEqual([]);
  }finally{await fixture.close();}
 });
 it("keeps real HTTP 200 error bodies out of runtime-ready state",async()=>{
  const understanding={intentRestatement:"Synthetic health",implicitRequirements:[],assumptions:[],clarifications:[],acceptanceFocus:[],confidence:0.8};
  const fixture=await nativeProvider({status:"completed",output_text:JSON.stringify(understanding),error:{message:"Rejected "+key}});
  try{
   const health=await withExplicitServerAiConnection(fixture.settings,()=>probeServerAiRuntime(undefined,{force:true,isolated:true}));
   expect(health.ready).toBe(false);expect(health.status).not.toBe("ready");expect(health.message).not.toContain(key);expect(fixture.requests).toHaveLength(1);expect(fixture.errors).toEqual([]);
  }finally{await fixture.close();}
 });
 it("retains authorization classification from a real non-success HTTP response",async()=>{
  const fixture=await nativeProvider({error:{message:"Denied "+key}},401);
  try{
   const error=await withExplicitServerAiConnection(fixture.settings,()=>runServerAi("copilot",{artifacts:[]})).catch(value=>value);
   expect(error).toBeInstanceOf(Error);expect(serverAiUnavailableReason(error)).toBe("provider-auth-or-billing");expect(error.message).not.toContain(key);expect(fixture.requests).toHaveLength(1);expect(fixture.errors).toEqual([]);
  }finally{await fixture.close();}
 });
});