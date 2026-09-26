import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type SourceParseStatusResponse} from "@evolution/contracts";
import {loadRecoveredParseSource,recoveredParseState} from "./server-parse-recovery";

const bytes=new TextEncoder().encode("original source");
const at="2026-09-24T00:00:00.000Z";
const baseJob=EvolutionJobSchema.parse({
  schemaVersion:"job-v1",id:"parse-1",type:"parse",status:"completed",label:"Parse input.txt",
  idempotencyKey:"parse-key",generation:1,attempts:1,priority:80,
  inputRef:"parse-input-1",outputRef:"parse-result-1",createdAt:at,updatedAt:at,finishedAt:at,
  metadata:{identityVersion:"parse-v2",artifactId:"artifact-1",name:"input.txt",mimeType:"text/plain",
    size:bytes.byteLength,role:"target",contentSha256:createHash("sha256").update(bytes).digest("hex"),
    lastModified:1_700_000_000_000},
});

describe("recovered Server Parse",()=>{
  it("resumes a completed Job whose result Storage is temporarily unavailable",()=>{
    expect(recoveredParseState({job:baseJob,resultIssue:"Storage unavailable",
      resultIssueCode:"temporary-storage-unavailable"})).toEqual({status:"parsing",resume:true});
    expect(recoveredParseState({job:baseJob,resultIssue:"Artifact damaged"}))
      .toEqual({status:"error",resume:false});
    expect(recoveredParseState({job:{...baseJob,status:"running"},resultIssue:undefined}))
      .toEqual({status:"parsing",resume:true});
  });

  it("restores the exact original input bytes for a retry",async()=>{
    const read=vi.fn(async()=>new Blob([bytes],{type:"text/plain"}));
    const file=await loadRecoveredParseSource(baseJob,read);
    expect(read).toHaveBeenCalledWith("parse-input-1",{preferRemote:true});
    expect(file.name).toBe("input.txt");
    expect(file.lastModified).toBe(1_700_000_000_000);
    expect(await file.text()).toBe("original source");
  });

  it("never retries with missing, changed, or unbound source bytes",async()=>{
    await expect(loadRecoveredParseSource(baseJob,async()=>undefined)).rejects.toThrow("不可读取");
    await expect(loadRecoveredParseSource(baseJob,async()=>new Blob(["short"]))).rejects.toThrow("大小不一致");
    await expect(loadRecoveredParseSource(baseJob,async()=>new Blob(["changed source!"]))).rejects.toThrow("内容不一致");
    const legacy=EvolutionJobSchema.parse({...baseJob,metadata:{...baseJob.metadata,contentSha256:undefined}});
    const read=vi.fn(async()=>new Blob([bytes]));
    await expect(loadRecoveredParseSource(legacy,read)).rejects.toThrow("身份无法验证");
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps an already recovered result ready",()=>{
    const artifact={id:"artifact-1",name:"input.txt",role:"target" as const,mimeType:"text/plain",
      size:bytes.byteLength,inputMode:"upload" as const,storageRef:"parse-input-1",createdAt:at};
    const record:SourceParseStatusResponse={job:baseJob,artifact:artifact as SourceParseStatusResponse["artifact"]};
    expect(recoveredParseState(record)).toEqual({status:"ready",resume:false});
  });
});
