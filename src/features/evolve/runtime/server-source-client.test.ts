import {afterEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema} from "@evolution/contracts";
import {
  ServerParseUnavailableError,
  cancelServerParseJob,
  listServerParseJobs,
  parseJobMetadata,
  startServerParseFile,
  waitForServerParseJob,
} from "./server-source-client";

describe("server source client degraded fallback classification",()=>{
  afterEach(()=>vi.unstubAllGlobals());

  it("validates persisted Parse metadata before restoring source identity",()=>{
    const at="2026-09-24T00:00:00.000Z";
    const metadata={artifactId:"artifact-1",name:"source.md",mimeType:"text/markdown",size:5,
      role:"reference",lastModified:0};
    const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"parse-1",type:"parse",
      status:"failed",label:"Parse source.md",idempotencyKey:"parse-key",metadata,
      createdAt:at,updatedAt:at});
    expect(parseJobMetadata(job)).toEqual(metadata);
    for(const damaged of [
      {...metadata,role:"administrator"},
      {...metadata,size:-1},
      {...metadata,name:""},
      {...metadata,lastModified:Number.POSITIVE_INFINITY},
      {...metadata,artifactId:undefined},
    ]){
      expect(()=>parseJobMetadata({...job,metadata:damaged})).toThrow("恢复元数据无效");
    }
  });

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

  it("retains the server Job when its completed result is temporarily unreadable",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      statusCode:503,statusMessage:"Parse result temporarily unavailable",
      data:{code:"PARSE_RESULT_TEMPORARILY_UNAVAILABLE",jobId:"parse-1"},
    }),{status:503,headers:{"Content-Type":"application/json"}})));
    expect(await startServerParseFile(
      new File(["hello"],"input.txt",{type:"text/plain"}),"target","artifact-1",
    )).toEqual({jobId:"parse-1",artifactId:"artifact-1",status:"completed",reused:true});
  });

  it("keeps an unconfirmed Job write visible instead of switching to local Parse",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
      statusCode:503,statusMessage:"Parse Job write unconfirmed",
      data:{code:"PARSE_JOB_WRITE_UNCONFIRMED",jobId:"parse-1",generation:1},
    }),{status:503,headers:{"Content-Type":"application/json"}})));
    const attempt=startServerParseFile(new File(["hello"],"input.txt",{type:"text/plain"}),"target","artifact-1");
    await expect(attempt).rejects.toThrow("Parse Job write unconfirmed（Job parse-1）");
    await expect(startServerParseFile(new File(["hello"],"input.txt",{type:"text/plain"}),"target","artifact-1"))
      .rejects.not.toBeInstanceOf(ServerParseUnavailableError);
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

  it("reports a completed Job's missing result immediately",async()=>{
    const at="2026-09-24T00:00:00.000Z";
    const job=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"parse-1",type:"parse",status:"completed",label:"Parse",
      idempotencyKey:"parse-key",generation:1,attempts:1,priority:80,
      createdAt:at,updatedAt:at,finishedAt:at,
    });
    const fetch=vi.fn(async()=>new Response(JSON.stringify({job,resultIssue:"Parse 结果 Artifact 缺失"}),{status:200}));
    vi.stubGlobal("fetch",fetch);
    await expect(waitForServerParseJob(job.id)).rejects.toThrow("Parse 结果 Artifact 缺失");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("waits for a temporarily unreadable completed result instead of treating it as Parse failure",async()=>{
    const at="2026-09-24T00:00:00.000Z";
    const job=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"parse-1",type:"parse",status:"completed",label:"Parse",
      idempotencyKey:"parse-key",generation:1,attempts:1,priority:80,
      createdAt:at,updatedAt:at,finishedAt:at,
    });
    const artifact={id:"artifact-1",name:"input.txt",role:"target",mimeType:"text/plain",size:5,
      inputMode:"upload",storageRef:"input-1",createdAt:at};
    const fetch=vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({job,resultIssue:"Parse 结果 Artifact 暂时不可读取",resultIssueCode:"temporary-storage-unavailable"}),{status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({job,artifact}),{status:200}));
    vi.stubGlobal("fetch",fetch);
    expect(await waitForServerParseJob(job.id)).toMatchObject(artifact);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
