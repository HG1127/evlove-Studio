// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
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
