// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema} from "@evolution/contracts";
import {readSourceParseResult,readSourceParseResults} from "./source-parse-result";

const at="2026-09-24T00:00:00.000Z";
const completed=EvolutionJobSchema.parse({
  schemaVersion:"job-v1",id:"parse-1",type:"parse",status:"completed",label:"Parse",
  idempotencyKey:"parse-key",generation:1,attempts:1,priority:80,
  outputRef:"result-1",createdAt:at,updatedAt:at,finishedAt:at,
});

describe("Parse result reading",()=>{
  it("preserves a completed Job while reporting missing or unreadable output",async()=>{
    const missing=await readSourceParseResult(completed,{get:vi.fn(async()=>undefined)});
    expect(missing).toEqual({job:completed,resultIssue:"Parse 结果 Artifact 缺失"});
    const unavailable=await readSourceParseResult(completed,{get:vi.fn(async()=>{throw new Error("private storage detail");})});
    expect(unavailable).toEqual({job:completed,resultIssue:"Parse 结果 Artifact 暂时不可读取"});
  });

  it("reports malformed output and never invents a parsed Artifact",async()=>{
    const result=await readSourceParseResult(completed,{get:vi.fn(async()=>new Blob(["not-json"]))});
    expect(result).toEqual({job:completed,resultIssue:"Parse 结果 Artifact 已损坏或 schema 不兼容"});
  });

  it("does not read an output for an active Job",async()=>{
    const get=vi.fn();
    const result=await readSourceParseResult(EvolutionJobSchema.parse({...completed,status:"running",finishedAt:undefined}),{get});
    expect(result.job.status).toBe("running");
    expect(result.resultIssue).toBeUndefined();
    expect(get).not.toHaveBeenCalled();
  });

  it("reads recovery results with at most four concurrent Storage requests and retains Job order",async()=>{
    const jobs=Array.from({length:12},(_,index)=>EvolutionJobSchema.parse({
      ...completed,id:`parse-${index}`,outputRef:`result-${index}`,
    }));
    let active=0;
    let peak=0;
    const get=vi.fn(async()=>{
      active+=1;
      peak=Math.max(peak,active);
      await new Promise((resolve)=>setTimeout(resolve,5));
      active-=1;
      return undefined;
    });
    const results=await readSourceParseResults(jobs,{get});
    expect(peak).toBe(4);
    expect(get).toHaveBeenCalledTimes(12);
    expect(results.map((item)=>item.job.id)).toEqual(jobs.map((job)=>job.id));
    expect(results.every((item)=>item.resultIssue==="Parse 结果 Artifact 缺失")).toBe(true);
  });
});
