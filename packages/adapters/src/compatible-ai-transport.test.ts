// @vitest-environment node
import {createServer} from "node:http";
import {afterEach,describe,expect,it,vi} from "vitest";
import {requestCompatibleAiJson} from "./compatible-ai-transport";
afterEach(()=>vi.unstubAllGlobals());

describe("compatible AI transport boundary",()=>{
  it.each(["ENOTFOUND","EAI_AGAIN","ECONNREFUSED","ECONNRESET","EHOSTUNREACH","ENETUNREACH","EPIPE","UND_ERR_SOCKET"])("classifies Node network cause %s without copying private diagnostics",async code=>{
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new TypeError("private request body",{
      cause:Object.assign(new Error("private provider endpoint"),{code}),
    });}));
    const error=await requestCompatibleAiJson("https://synthetic.example.test",{}).catch(caught=>caught);
    expect(error).toMatchObject({code:"AI_REQUEST_NETWORK_ERROR"});
    expect(error.message).not.toContain("private");
  });

  it.each(["ETIMEDOUT","ESOCKETTIMEDOUT","UND_ERR_CONNECT_TIMEOUT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT"])("classifies Node timeout cause %s",async code=>{
    vi.stubGlobal("fetch",vi.fn(async()=>{throw Object.assign(new Error("private"),{code});}));
    await expect(requestCompatibleAiJson("https://synthetic.example.test",{})).rejects.toMatchObject({code:"AI_REQUEST_TIMEOUT"});
  });

  it("preserves redirect policy, one signal and a non-JSON HTTP status",async()=>{
    const signal=AbortSignal.timeout(500);
    const fetchMock=vi.fn(async()=>new Response("<html>HTTP error</html>",{status:404}));
    vi.stubGlobal("fetch",fetchMock);
    const result=await requestCompatibleAiJson("https://synthetic.example.test",{signal,redirect:"error"});
    expect(result.response.status).toBe(404);
    expect(result.json).toEqual({});
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://synthetic.example.test",{signal,redirect:"error"});
  });

  it("leaves arbitrary body exceptions and non-timeout cancellations unclassified",async()=>{
    for(const failure of [new Error("decoder failure"),new DOMException("cancelled","AbortError")]){
      vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>{throw failure;}})));
      const signal=AbortSignal.abort(new Error("user cancelled"));
      await expect(requestCompatibleAiJson("https://synthetic.example.test",{signal})).rejects.toBe(failure);
    }
  });

  it("keeps a real body timeout after HTTP 200 headers in the transport error path",async()=>{
    const server=createServer((_req,res)=>{
      res.writeHead(200,{"Content-Type":"application/json"});
      res.write('{"unfinished":');
    });
    await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
    const address=server.address();
    if(!address||typeof address==="string")throw new Error("Missing synthetic address");
    const signal=AbortSignal.timeout(120);
    try{
      await expect(requestCompatibleAiJson("http://127.0.0.1:"+address.port,{signal})).rejects.toMatchObject({code:"AI_REQUEST_TIMEOUT"});
      expect(signal.aborted).toBe(true);
    }finally{
      server.closeAllConnections();
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  });

  it("keeps a real socket loss after HTTP 200 headers in the transport error path",async()=>{
    const server=createServer((_req,res)=>{
      res.writeHead(200,{"Content-Type":"application/json"});
      res.write('{"unfinished":');
      setTimeout(()=>res.destroy(),30);
    });
    await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
    const address=server.address();
    if(!address||typeof address==="string")throw new Error("Missing synthetic address");
    try{
      await expect(requestCompatibleAiJson("http://127.0.0.1:"+address.port,{signal:AbortSignal.timeout(1500)}))
        .rejects.toMatchObject({code:"AI_REQUEST_NETWORK_ERROR"});
    }finally{
      server.closeAllConnections();
      await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  });
});
