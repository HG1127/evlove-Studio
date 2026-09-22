import {afterEach,describe,expect,it,vi} from "vitest";
import {
  ServerParseUnavailableError,
  listServerParseJobs,
  startServerParseFile,
} from "./server-source-client";

describe("server source client degraded fallback classification",()=>{
  afterEach(()=>vi.unstubAllGlobals());

  it.each([401,403,404,503])("treats HTTP %s as server-parse unavailable so callers can fall back locally",async(status)=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      statusCode:status,
      statusMessage:status===401?"Trusted Evolution actor headers are required":"Server Parse unavailable",
    }),{status,headers:{"Content-Type":"application/json"}})));

    await expect(startServerParseFile(
      new File(["hello"],"source.txt",{type:"text/plain"}),
      "target",
      "artifact-1",
      "session-1",
    )).rejects.toBeInstanceOf(ServerParseUnavailableError);

    await expect(listServerParseJobs("session-1")).rejects.toBeInstanceOf(ServerParseUnavailableError);
  });

  it("keeps semantic request errors fatal instead of hiding them behind local fallback",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      statusCode:422,statusMessage:"Invalid parse request",
    }),{status:422,headers:{"Content-Type":"application/json"}})));

    await expect(startServerParseFile(
      new File(["hello"],"source.txt",{type:"text/plain"}),
      "target",
      "artifact-1",
    )).rejects.toThrow("Invalid parse request");
    await expect(startServerParseFile(
      new File(["hello"],"source.txt",{type:"text/plain"}),
      "target",
      "artifact-1",
    )).rejects.not.toBeInstanceOf(ServerParseUnavailableError);
  });
});
