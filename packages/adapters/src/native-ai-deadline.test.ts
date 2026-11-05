// @vitest-environment node
import {afterEach,expect,it,vi} from "vitest";
import {createServer} from "node:http";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath,pathToFileURL} from "node:url";
import {Agent,getGlobalDispatcher} from "undici";
import {nativeAiDeadlineOptions,type AiRequestDispatcher} from "./native-ai-deadline";
afterEach(()=>vi.doUnmock("undici"));

it("preserves the explicit dispatch receiver, options, body, headers and handler without owning its lifecycle",async()=>{
 const body=Buffer.from("fixture"),headers={"x-fixture":"only"},handler={},captured:unknown[]=[];
 const parent={dispatch(options:unknown,value:unknown){expect(this).toBe(parent);captured.push(options,value);return true;}} as AiRequestDispatcher;
 const before=getGlobalDispatcher(),options=await nativeAiDeadlineOptions(600000,parent);
 const request={path:"/",method:"POST" as const,body,headers};expect(options.dispatcher.dispatch(request,handler)).toBe(true);
 expect(captured[0]).toEqual({...request,headersTimeout:600000,bodyTimeout:600000});expect((captured[0] as typeof request).body).toBe(body);expect((captured[0] as typeof request).headers).toBe(headers);expect(captured[1]).toBe(handler);
 expect(Object.keys(options.dispatcher)).toEqual(["dispatch"]);expect(getGlobalDispatcher()).toBe(before);
});

it.each([0,-1,900001,Infinity,NaN,1000.5])("rejects invalid duration %s before dispatch",async ms=>{
 await expect(nativeAiDeadlineOptions(ms,{dispatch(){throw Error("must not dispatch");}} as AiRequestDispatcher)).rejects.toMatchObject({code:"AI_NATIVE_DEADLINE_INVALID"});
});
it("does not fall back from a malformed explicit custom dispatcher",async()=>{
 await expect(nativeAiDeadlineOptions(600000,{} as AiRequestDispatcher)).rejects.toMatchObject({code:"AI_NATIVE_DISPATCHER_UNAVAILABLE"});
});
it.each(["import","getter"])("normalizes a native dependency %s failure as unavailable without losing its cause",async mode=>{
 const failure=new Error("synthetic dependency failure");
 vi.doMock("undici",()=>{if(mode==="import")throw failure;return{getGlobalDispatcher(){throw failure;}};});
 await expect(nativeAiDeadlineOptions(600000)).rejects.toMatchObject({code:"AI_NATIVE_DISPATCHER_UNAVAILABLE",cause:expect.any(Error)});
});
it("normalizes a throwing custom dispatcher capability getter before dispatch",async()=>{
 const cause=new Error("synthetic getter failure"),parent=Object.defineProperty({},"dispatch",{get(){throw cause;}}) as AiRequestDispatcher;
 await expect(nativeAiDeadlineOptions(600000,parent)).rejects.toMatchObject({code:"AI_NATIVE_DISPATCHER_UNAVAILABLE",cause});
});

it("extends actual native header and body waits but respects an earlier AbortSignal",async()=>{
 let requests=0;const server=createServer((req,res)=>{requests++;if(req.url==="/body"){res.writeHead(200);res.flushHeaders();}setTimeout(()=>{if(!res.destroyed)res.end("loopback fixture");},1600);});
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();if(!address||typeof address==="string")throw Error("missing loopback listener");
 const url="http://127.0.0.1:"+address.port,agent=new Agent({headersTimeout:100,bodyTimeout:100}),before=getGlobalDispatcher(),defaults={method:"GET",dispatcher:agent};
 try{
  await expect(fetch(url+"/header",defaults)).rejects.toMatchObject({cause:{code:"UND_ERR_HEADERS_TIMEOUT"}});
  const options=await nativeAiDeadlineOptions(4000,agent);
  expect(await (await fetch(url+"/header",options)).text()).toBe("loopback fixture");
  await expect((await fetch(url+"/body",defaults)).text()).rejects.toMatchObject({cause:{code:"UND_ERR_BODY_TIMEOUT"}});
  expect(await (await fetch(url+"/body",options)).text()).toBe("loopback fixture");
  const began=performance.now();await expect(fetch(url+"/header",{...options,signal:AbortSignal.timeout(100)})).rejects.toMatchObject({name:"TimeoutError"});expect(performance.now()-began).toBeLessThan(1500);
  expect(requests).toBe(5);expect(getGlobalDispatcher()).toBe(before);
 }finally{await agent.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},15000);

it("fails before native initialization and preserves a fresh native dispatcher after a data-only initialization",async()=>{
 const file=fileURLToPath(new URL("./native-ai-deadline.ts",import.meta.url)),exec=promisify(execFile);
 const script=`import assert from 'node:assert/strict';import net from 'node:net';let sockets=0;net.Socket.prototype.connect=function(){sockets++;throw Error('No sockets permitted');};const key=Symbol.for('undici.globalDispatcher.1');assert.equal(globalThis[key],undefined);const lib=await import(${JSON.stringify(pathToFileURL(file).href)});await assert.rejects(lib.nativeAiDeadlineOptions(600000),{code:'AI_NATIVE_DISPATCHER_UNAVAILABLE'});assert.equal(globalThis[key],undefined);await fetch('data:,native-init');const parent=globalThis[key];assert(parent);const options=await lib.nativeAiDeadlineOptions(600000);assert.equal(globalThis[key],parent);assert.equal(typeof options.dispatcher.dispatch,'function');assert.equal(sockets,0);console.log('native-identity-ok');`;
 const env=Object.fromEntries(Object.entries(process.env).filter(([name,value])=>value!==undefined&&/^(SystemRoot|WINDIR|PATH|TEMP|TMP|PATHEXT)$/i.test(name)));
 const result=await exec(process.execPath,["--input-type=module","-e",script],{env,timeout:15000});expect(result.stdout.trim()).toBe("native-identity-ok");
},20000);
