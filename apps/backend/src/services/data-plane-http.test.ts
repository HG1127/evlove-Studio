// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {classifyDataPlaneUpstreamFailure,dataPlaneFetch} from "./data-plane-http";

afterEach(()=>vi.unstubAllGlobals());

describe("Data Plane upstream error semantics",()=>{
  it("classifies infrastructure failures as unavailable",()=>{
    expect(classifyDataPlaneUpstreamFailure(401)).toBe("credential-rejected");
    expect(classifyDataPlaneUpstreamFailure(403)).toBe("credential-rejected");
    expect(classifyDataPlaneUpstreamFailure(404)).toBe("schema-unavailable");
    expect(classifyDataPlaneUpstreamFailure(400,'{"code":"PGRST202"}')).toBe("schema-unavailable");
    expect(classifyDataPlaneUpstreamFailure(429)).toBe("rate-limited-or-timeout");
    expect(classifyDataPlaneUpstreamFailure(503)).toBe("upstream-unavailable");
  });

  it("preserves conflict separately and treats unexpected client rejection as gateway error",()=>{
    expect(classifyDataPlaneUpstreamFailure(409)).toBe("conflict");
    expect(classifyDataPlaneUpstreamFailure(400,"bad request")).toBe("request-rejected");
    expect(classifyDataPlaneUpstreamFailure(422)).toBe("request-rejected");
  });

  it("returns 503 for credential rejection without leaking upstream response text",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(
      '{"message":"secret-upstream-detail-must-not-leak"}',
      {status:403,headers:{"content-type":"application/json"}},
    )));
    let caught:unknown;
    try{await dataPlaneFetch("evidence-ledger","https://db.test/rest/v1/events");}catch(error){caught=error;}
    const error=caught as {statusCode?:number;data?:Record<string,unknown>;message?:string};
    expect(error.statusCode).toBe(503);
    expect(error.data).toMatchObject({
      code:"SERVER_DATA_PLANE_UNAVAILABLE",
      service:"evidence-ledger",
      reason:"credential-rejected",
      upstreamStatus:403,
    });
    expect(JSON.stringify(error)).not.toContain("secret-upstream-detail-must-not-leak");
  });

  it("normalizes network failures to 503 and duplicate conflicts to 409",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("socket reset with private host");}));
    await expect(dataPlaneFetch("outcome-store","https://db.test/rest/v1/samples"))
      .rejects.toMatchObject({statusCode:503,data:{reason:"network-error"}});

    vi.stubGlobal("fetch",vi.fn(async()=>new Response("duplicate",{status:409})));
    await expect(dataPlaneFetch("outcome-store","https://db.test/rest/v1/samples"))
      .rejects.toMatchObject({statusCode:409,data:{code:"SERVER_DATA_PLANE_CONFLICT"}});
  });
});

describe("bounded read-only Data Plane recovery",()=>{
  beforeEach(()=>vi.useFakeTimers());
  afterEach(()=>vi.useRealTimers());
  const settle=async(promise:Promise<Response>)=>{
    const captured=promise.then(value=>value,error=>error);
    await vi.runAllTimersAsync();
    return captured;
  };
  it("retries a reset GET with the same URL, headers and request scope",async()=>{
    const ok=new Response("canonical mission",{status:200});
    const fetch=vi.fn().mockRejectedValueOnce(new Error("private TLS detail")).mockResolvedValueOnce(ok);
    vi.stubGlobal("fetch",fetch);
    const init={headers:{apikey:"private-test-key"}};
    expect(await settle(dataPlaneFetch("production-runtime","https://db.test/rest/v1/missions?id=eq.M1",init))).toBe(ok);
    expect(fetch.mock.calls).toEqual([["https://db.test/rest/v1/missions?id=eq.M1",init],["https://db.test/rest/v1/missions?id=eq.M1",init]]);
  });
  it.each([408,425,429,500,502,503,504])("recovers transient HTTP %s for a read",async(status)=>{
    const ok=new Response("readback",{status:200});
    const fetch=vi.fn().mockResolvedValueOnce(new Response("private upstream error",{status})).mockResolvedValueOnce(ok);
    vi.stubGlobal("fetch",fetch);
    expect(await settle(dataPlaneFetch("production-runtime","https://db.test/rest/v1/missions"))).toBe(ok);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("stops after three network attempts with a sanitized unavailable result",async()=>{
    const fetch=vi.fn().mockRejectedValue(new Error("private socket detail"));vi.stubGlobal("fetch",fetch);
    const error=await settle(dataPlaneFetch("production-runtime","https://db.test/rest/v1/missions"));
    expect(error).toMatchObject({statusCode:503,data:{reason:"network-error"}});
    expect(JSON.stringify(error)).not.toContain("private socket");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each(["POST","PUT","PATCH","DELETE"])("does not replay %s after an ambiguous network failure",async(method)=>{
    const fetch=vi.fn().mockRejectedValue(new Error("lost response"));vi.stubGlobal("fetch",fetch);
    const error=await settle(dataPlaneFetch("production-runtime","https://db.test/rest/v1/rpc/write",{method,body:"{}"}));
    expect(error).toMatchObject({statusCode:503});expect(fetch).toHaveBeenCalledOnce();
  });
  it("recognizes a Request object's POST method rather than treating it as GET",async()=>{
    const fetch=vi.fn().mockRejectedValue(new Error("lost response"));vi.stubGlobal("fetch",fetch);
    expect(await settle(dataPlaneFetch("production-runtime",new Request("https://db.test/rest/v1/rpc/write",{method:"POST",body:"{}"})))).toMatchObject({statusCode:503});
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([401,403,404,409,422])("preserves permanent HTTP %s without retries",async(status)=>{
    const fetch=vi.fn().mockResolvedValue(new Response("private upstream error",{status}));vi.stubGlobal("fetch",fetch);
    expect(await settle(dataPlaneFetch("production-runtime","https://db.test/rest/v1/missions"))).not.toBeInstanceOf(Response);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not retry a schema failure disguised as HTTP 500",async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('{"code":"42P01","message":"relation missing"}',{status:500}));vi.stubGlobal("fetch",fetch);
    expect(await settle(dataPlaneFetch("production-runtime","https://db.test/rest/v1/missions"))).toMatchObject({data:{reason:"schema-unavailable"}});
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("honors a short Retry-After and stops if the server asks for a longer wait",async()=>{
    const ok=new Response("readback",{status:200});
    const fetch=vi.fn().mockResolvedValueOnce(new Response("wait",{status:429,headers:{"retry-after":"1"}})).mockResolvedValueOnce(ok);vi.stubGlobal("fetch",fetch);
    const started=Date.now();expect(await settle(dataPlaneFetch("production-runtime","https://db.test/rest/v1/missions"))).toBe(ok);
    expect(Date.now()-started).toBe(1000);
    fetch.mockReset().mockResolvedValue(new Response("wait",{status:429,headers:{"retry-after":"60"}}));
    expect(await settle(dataPlaneFetch("production-runtime","https://db.test/rest/v1/missions"))).toMatchObject({data:{reason:"rate-limited-or-timeout"}});
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("respects abort before the request and during retry backoff",async()=>{
    const controller=new AbortController();
    const fetch=vi.fn().mockRejectedValue(new Error("reset"));vi.stubGlobal("fetch",fetch);
    const pending=dataPlaneFetch("production-runtime","https://db.test/rest/v1/missions",{signal:controller.signal}).catch(error=>error);
    await Promise.resolve();await Promise.resolve();
    controller.abort();
    expect(await pending).toMatchObject({statusCode:503});
    await vi.runAllTimersAsync();expect(fetch).toHaveBeenCalledOnce();
    fetch.mockClear();
    expect(await settle(dataPlaneFetch("production-runtime","https://db.test/rest/v1/missions",{signal:controller.signal}))).toMatchObject({statusCode:503});
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
