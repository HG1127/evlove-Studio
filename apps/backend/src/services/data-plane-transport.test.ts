// @vitest-environment node
import {createServer,type Server,type ServerResponse} from "node:http";
import type {Socket} from "node:net";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {dataPlaneFetch} from "./data-plane-http";
import {getServerProductionRuntime} from "./production-runtime";

let server:Server|undefined;
let base="";
const sockets=new Set<Socket>();
let requests=0;
async function listen(handler:(response:ServerResponse)=>void){
  server=createServer((_request,response)=>{requests+=1;handler(response);});
  server.on("connection",socket=>{sockets.add(socket);socket.once("close",()=>sockets.delete(socket));});
  await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));
  const address=server.address();if(!address||typeof address==="string")throw Error("HTTP_FIXTURE_ADDRESS_REQUIRED");
  base=`http://127.0.0.1:${address.port}`;
}
beforeEach(()=>{requests=0;vi.stubEnv("EVOLUTION_DATA_PLANE_TIMEOUT_MS","400");});
afterEach(async()=>{
  vi.unstubAllEnvs();vi.unstubAllGlobals();
  for(const socket of sockets)socket.destroy();sockets.clear();
  if(server){await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));server=undefined;}
});

describe("actual Data Plane HTTP deadlines",()=>{
  it("bounds a successful response whose body never finishes",async()=>{
    await listen(response=>{response.writeHead(200,{"content-type":"application/json"});response.write('[{"id":"');});
    const response=await dataPlaneFetch("production-runtime",base+"/missions");
    await expect(response.text()).rejects.toMatchObject({statusCode:503,data:{code:"SERVER_DATA_PLANE_UNAVAILABLE",reason:"rate-limited-or-timeout",upstreamStatus:200}});
    expect(requests).toBe(1);
  },2000);
  it("bounds a request that never sends response headers",async()=>{
    await listen(()=>undefined);
    await expect(dataPlaneFetch("production-runtime",base+"/missions")).rejects.toMatchObject({statusCode:503,data:{reason:"rate-limited-or-timeout"}});
    expect(requests).toBe(1);
  },2000);
  it("bounds an error body without replaying a POST",async()=>{
    await listen(response=>{response.writeHead(503,{"content-type":"application/json"});response.write('private-upstream-secret');});
    const error=await dataPlaneFetch("production-runtime",base+"/write",{method:"POST",body:"{}"}).catch(error=>error);
    expect(error).toMatchObject({statusCode:503,data:{reason:"rate-limited-or-timeout",upstreamStatus:503}});
    expect(JSON.stringify(error)).not.toContain("private-upstream-secret");expect(requests).toBe(1);
  },2000);
  it("sanitizes a post-header socket loss instead of leaking a fetch error",async()=>{
    await listen(response=>{response.writeHead(200,{"content-type":"application/json"});response.write('[{"id":"');setTimeout(()=>response.destroy(Error("private-socket-detail")),25);});
    const response=await dataPlaneFetch("production-runtime",base+"/missions");
    const error=await response.text().catch(error=>error);
    expect(error).toMatchObject({statusCode:503,data:{reason:"network-error",upstreamStatus:200}});
    expect(JSON.stringify(error)).not.toContain("private-socket-detail");expect(requests).toBe(1);
  },2000);
  it("retains actual status, headers, URL and body on a completed read",async()=>{
    await listen(response=>{response.writeHead(200,{"content-type":"application/json","content-range":"0-0/1","x-safe-fixture":"yes"});response.end('[{"id":"fixture"}]');});
    const response=await dataPlaneFetch("production-runtime",base+"/missions");
    expect(response.status).toBe(200);expect(response.url).toBe(base+"/missions");expect(response.headers.get("content-range")).toBe("0-0/1");
    expect(await response.json()).toEqual([{id:"fixture"}]);expect(requests).toBe(1);
  },2000);
  it("uses one deadline for retries and the final response body",async()=>{
    vi.stubEnv("EVOLUTION_DATA_PLANE_TIMEOUT_MS","350");
    await listen(response=>{if(requests===1){response.writeHead(503);response.end("retry");}else{response.writeHead(200);response.write("partial");}});
    const response=await dataPlaneFetch("production-runtime",base+"/missions");
    await expect(response.text()).rejects.toMatchObject({statusCode:503,data:{reason:"rate-limited-or-timeout"}});
    expect(requests).toBe(2);
  },2000);
  it("propagates caller abort during a body read as sanitized availability",async()=>{
    vi.stubEnv("EVOLUTION_DATA_PLANE_TIMEOUT_MS","1000");
    await listen(response=>{response.writeHead(200);response.write("partial");});
    const controller=new AbortController(),response=await dataPlaneFetch("production-runtime",base+"/missions",{signal:controller.signal});
    const pending=response.text().catch(error=>error);controller.abort(Error("private-caller-reason"));
    const error=await pending;expect(error).toMatchObject({statusCode:503,data:{reason:"network-error"}});
    expect(JSON.stringify(error)).not.toContain("private-caller-reason");expect(requests).toBe(1);
  },2000);
});

it("does not replay a successful POST whose response body is incomplete",async()=>{
  await listen(response=>{response.writeHead(200);response.write("partial");});
  const response=await dataPlaneFetch("production-runtime",base+"/write",{method:"POST",body:"{}"});
  await expect(response.text()).rejects.toMatchObject({statusCode:503,data:{reason:"rate-limited-or-timeout"}});
  expect(requests).toBe(1);
},2000);
it("preserves credential rejection without waiting for its stalled error body",async()=>{
  await listen(response=>{response.writeHead(403);response.write("private-credential-detail");});
  await expect(dataPlaneFetch("production-runtime",base+"/missions")).rejects.toMatchObject({statusCode:503,data:{reason:"credential-rejected",upstreamStatus:403}});
  expect(requests).toBe(1);
},2000);
it("preserves clone metadata and exact multibyte body bytes",async()=>{
  const expected=Buffer.from(JSON.stringify({id:"fixture",source:"文件😀".repeat(12000)}));
  await listen(response=>{response.writeHead(200,{"content-type":"application/json","content-length":expected.length});response.write(expected.subarray(0,24));response.end(expected.subarray(24));});
  const response=await dataPlaneFetch("production-runtime",base+"/missions"),clone=response.clone();
  expect(clone.url).toBe(response.url);expect(clone.type).toBe(response.type);expect(clone.headers.get("content-length")).toBe(String(expected.length));
  const [left,right]=await Promise.all([response.arrayBuffer(),clone.arrayBuffer()]);
  expect(Buffer.from(left).equals(expected)).toBe(true);expect(Buffer.from(right).equals(expected)).toBe(true);expect(requests).toBe(1);
},2000);

it.each(["missions","jobs"] as const)("keeps the actual %s store body timeout inside the safe Data Plane boundary",async(table)=>{
  await listen(response=>{response.writeHead(200,{"content-type":"application/json"});response.write('[{"id":"');});
  vi.stubEnv("SUPABASE_URL",base);vi.stubEnv("SUPABASE_SECRET_KEY","sb_secret_synthetic-response-fixture");
  const runtime=getServerProductionRuntime();
  await expect(runtime[table].get("fixture-never-persisted")).rejects.toMatchObject({statusCode:503,data:{code:"SERVER_DATA_PLANE_UNAVAILABLE",service:"production-runtime",reason:"rate-limited-or-timeout",upstreamStatus:200}});
  expect(requests).toBe(1);
},2000);
