import {afterEach,describe,expect,it,vi} from "vitest";
import {
  ServerParseUnavailableError,
  cancelServerParseJob,
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

  it("validates the Workflow cancellation receipt before returning it",async()=>{
    const receipt={jobId:"parse-1",status:"cancelled",workflow:{
      runId:"run-1",bound:true,exists:true,statusBefore:"running",statusAfter:"cancelled",
      cancelIssued:true,reason:"workflow-run-cancelled",
    }};
    vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(url)).toBe("/api/evolution/parse-cancel");
      expect(JSON.parse(String(init?.body))).toEqual({jobId:"parse-1",deleteArtifact:true});
      return new Response(JSON.stringify(receipt),{status:200});
    }));
    expect(await cancelServerParseJob("parse-1")).toEqual(receipt);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      ...receipt,workflow:{...receipt.workflow,cancelIssued:"yes"},
    }),{status:200})));
    await expect(cancelServerParseJob("parse-1")).rejects.toThrow();
  });
});
