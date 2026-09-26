// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type ArtifactStorePort,type EvolutionJob,type ProductionRuntimePorts,
  type SourceParseWorkflowInputV2} from "@evolution/contracts";

const state=vi.hoisted(()=>({
  job:undefined as EvolutionJob|undefined,
  blobs:new Map<string,Blob>(),
  metadataHashes:new Map<string,string>(),
  outputPut:false,
  cancelOnOutput:true,
  changeJobOnParse:false,
  failOutputAfterWrite:false,
  failCompletionBeforeWrite:false,
  failCompletionAfterWrite:false,
}));

vi.mock("./production-runtime",async(importOriginal)=>{
  const actual=await importOriginal<typeof import("./production-runtime")>();
  const runtime:Pick<ProductionRuntimePorts,"jobs">={
    jobs:{
      list:async()=>state.job?[state.job]:[],
      get:async()=>state.job,
      put:async(job)=>{
        if(job.status==="completed"&&state.failCompletionBeforeWrite){
          state.failCompletionBeforeWrite=false;
          throw new Error("completion request failed");
        }
        state.job=EvolutionJobSchema.parse(job);
        if(job.status==="completed"&&state.failCompletionAfterWrite){
          state.failCompletionAfterWrite=false;
          throw new Error("completion response lost");
        }
      },
      cancel:async()=>undefined,
    },
  };
  return {...actual,getServerProductionRuntime:()=>runtime};
});

vi.mock("./artifact-runtime",()=>({
  getServerArtifactStore:():ArtifactStorePort=>({
    put:async(id,blob)=>{
      state.blobs.set(id,blob);
      state.metadataHashes.set(id,createHash("sha256").update(Buffer.from(await blob.arrayBuffer())).digest("hex"));
      if(id==="parse-output"||id.startsWith("parse-result-")){
        state.outputPut=true;
        if(state.failOutputAfterWrite){
          state.failOutputAfterWrite=false;
          throw new Error("upload response lost");
        }
        if(state.cancelOnOutput&&state.job){
          state.job=EvolutionJobSchema.parse({
            ...state.job,
            status:"cancelled",
            finishedAt:"2026-09-23T02:00:00.000Z",
            updatedAt:"2026-09-23T02:00:00.000Z",
          });
        }
      }
    },
    get:async(id)=>state.blobs.get(id),
    getMetadata:async(id)=>{
      const blob=state.blobs.get(id);
      const sha256=state.metadataHashes.get(id);
      return blob&&sha256?{
        id,schemaVersion:"artifact-v1" as const,bucket:"private",objectPath:id,
        mimeType:blob.type,sizeBytes:blob.size,sha256,
        createdAt:"2026-09-23T01:00:00.000Z",updatedAt:"2026-09-23T01:00:00.000Z",
      }:undefined;
    },
    delete:async(id)=>{state.blobs.delete(id);state.metadataHashes.delete(id);},
  }),
}));

vi.mock("./server-source-parser",()=>({
  parseServerSource:vi.fn(async(args:{storageRef:string})=>{
    if(state.changeJobOnParse&&state.job){
      state.job=EvolutionJobSchema.parse({...state.job,generation:state.job.generation+1,
        status:"queued",inputRef:"next-input",outputRef:"next-output",
        updatedAt:"2026-09-23T02:00:00.000Z"});
    }
    return {
    id:"artifact-1",
    name:"input.txt",
    role:"target",
    kind:"text",
    mimeType:"text/plain",
    size:5,
    inputMode:"upload",
    content:"hello",
    createdAt:"2026-09-23T01:00:00.000Z",
    storageRef:args.storageRef,
  };}),
}));

import {executeSourceParseStep} from "../../../../workflows/source-parse";
import {readSourceParseResult} from "./source-parse-result";
import {parseServerSource} from "./server-source-parser";

function queuedV2Run():SourceParseWorkflowInputV2{
  const contentSha256=createHash("sha256").update("hello").digest("hex");
  const input:SourceParseWorkflowInputV2={
    schemaVersion:"source-parse-workflow-v2",generation:2,contentSha256,
    jobId:"parse-job",inputRef:"parse-input-parse-job-g2",outputRef:"parse-result-parse-job-g2",
    artifactId:"artifact-1",name:"input.txt",mimeType:"text/plain",size:5,
    role:"target",requestedAt:"2026-09-23T01:00:00.000Z",
  };
  state.job=EvolutionJobSchema.parse({
    schemaVersion:"job-v1",id:input.jobId,type:"parse",status:"queued",label:"Parse input.txt",
    idempotencyKey:"parse:artifact-1:5:1",generation:input.generation,attempts:0,priority:80,
    inputRef:input.inputRef,outputRef:input.outputRef,
    metadata:{identityVersion:"parse-v2",artifactId:input.artifactId,name:input.name,
      mimeType:input.mimeType,size:input.size,role:input.role,contentSha256},
    createdAt:input.requestedAt,updatedAt:input.requestedAt,
  });
  state.blobs.set(input.inputRef,new Blob(["hello"],{type:"text/plain"}));
  return input;
}

describe("source parse workflow cancellation",()=>{
  afterEach(()=>{
    state.job=undefined;
    state.blobs.clear();
    state.metadataHashes.clear();
    state.outputPut=false;
    state.cancelOnOutput=true;
    state.changeJobOnParse=false;
    state.failOutputAfterWrite=false;
    state.failCompletionBeforeWrite=false;
    state.failCompletionAfterWrite=false;
    vi.clearAllMocks();
  });

  it("keeps cancellation authoritative and removes output written during the race",async()=>{
    state.job=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",
      id:"parse-job",
      type:"parse",
      status:"queued",
      label:"Parse input.txt",
      idempotencyKey:"parse:artifact-1:5:1",
      generation:1,
      attempts:0,
      priority:80,
      inputRef:"parse-input",
      outputRef:"parse-output",
      metadata:{artifactId:"artifact-1"},
      createdAt:"2026-09-23T01:00:00.000Z",
      updatedAt:"2026-09-23T01:00:00.000Z",
    });
    state.blobs.set("parse-input",new Blob(["hello"],{type:"text/plain"}));

    const result=await executeSourceParseStep({
      jobId:"parse-job",
      inputRef:"parse-input",
      outputRef:"parse-output",
      artifactId:"artifact-1",
      name:"input.txt",
      mimeType:"text/plain",
      size:5,
      role:"target",
      requestedAt:"2026-09-23T01:00:00.000Z",
    });

    expect(state.outputPut).toBe(true);
    expect(result.status).toBe("cancelled");
    expect(state.job?.status).toBe("cancelled");
    expect(state.blobs.has("parse-input")).toBe(false);
    expect(state.blobs.has("parse-output")).toBe(false);
  });

  it("persists a result hash that binds the completed Job to its parsed Artifact",async()=>{
    state.cancelOnOutput=false;
    const input=queuedV2Run();
    const result=await executeSourceParseStep(input);

    expect(result.status).toBe("completed");
    expect(state.job?.status).toBe("completed");
    expect(state.job?.metadata?.resultSha256).toMatch(/^[a-f0-9]{64}$/);
    const parsed=await readSourceParseResult(state.job!,{get:async(id)=>state.blobs.get(id)});
    expect(parsed.artifact).toMatchObject({id:"artifact-1",storageRef:input.inputRef});
    expect(parsed.resultIssue).toBeUndefined();
  });

  it("recovers a same-generation output after the upload response is lost",async()=>{
    state.cancelOnOutput=false;
    state.failOutputAfterWrite=true;
    const input=queuedV2Run();
    await expect(executeSourceParseStep(input)).rejects.toThrow("Parse result Artifact write could not be confirmed");
    expect(state.job?.status).toBe("running");
    expect(state.blobs.has(input.outputRef)).toBe(true);
    vi.mocked(parseServerSource).mockClear();

    const result=await executeSourceParseStep(input);
    expect(result.status).toBe("completed");
    expect(parseServerSource).not.toHaveBeenCalled();
    expect((await readSourceParseResult(state.job!,{get:async(id)=>state.blobs.get(id)})).resultIssue).toBeUndefined();
  });

  it("accepts an authoritative completed Job after its response is lost",async()=>{
    state.cancelOnOutput=false;
    state.failCompletionAfterWrite=true;
    const input=queuedV2Run();
    const result=await executeSourceParseStep(input);
    expect(result.status).toBe("completed");
    expect(state.job?.status).toBe("completed");
    expect((await readSourceParseResult(state.job!,{get:async(id)=>state.blobs.get(id)})).resultIssue).toBeUndefined();
  });

  it("settles a saved result after a transient Job completion failure",async()=>{
    state.cancelOnOutput=false;
    state.failCompletionBeforeWrite=true;
    const input=queuedV2Run();
    await expect(executeSourceParseStep(input)).rejects.toThrow("Parse Job completion could not be confirmed");
    expect(state.job?.status).toBe("running");
    expect(state.blobs.has(input.outputRef)).toBe(true);
    vi.mocked(parseServerSource).mockClear();

    const result=await executeSourceParseStep(input);
    expect(result.status).toBe("completed");
    expect(parseServerSource).not.toHaveBeenCalled();
    expect((await readSourceParseResult(state.job!,{get:async(id)=>state.blobs.get(id)})).resultIssue).toBeUndefined();
  });

  it("rejects a preexisting result with a different source identity",async()=>{
    state.cancelOnOutput=false;
    const input=queuedV2Run();
    const existing=new Blob([JSON.stringify({
      id:input.artifactId,name:input.name,mimeType:input.mimeType,size:input.size,
      role:input.role,inputMode:"upload",storageRef:"another-input",
      createdAt:input.requestedAt,
    })],{type:"application/json"});
    state.blobs.set(input.outputRef,existing);
    state.metadataHashes.set(input.outputRef,createHash("sha256").update(Buffer.from(await existing.arrayBuffer())).digest("hex"));
    await expect(executeSourceParseStep(input)).rejects.toThrow("Parse result Artifact does not match its Workflow input");
    expect(parseServerSource).not.toHaveBeenCalled();
    expect(state.job?.status).toBe("failed");
    expect(state.outputPut).toBe(false);
  });

  it("rejects a persisted result whose bytes differ from Artifact metadata",async()=>{
    state.cancelOnOutput=false;
    const input=queuedV2Run();
    state.blobs.set(input.outputRef,new Blob([JSON.stringify({
      id:input.artifactId,name:input.name,mimeType:input.mimeType,size:input.size,
      role:input.role,inputMode:"upload",storageRef:input.inputRef,
      createdAt:input.requestedAt,
    })],{type:"application/json"}));
    state.metadataHashes.set(input.outputRef,"0".repeat(64));
    await expect(executeSourceParseStep(input)).rejects.toThrow("Parse result Artifact metadata does not match its stored bytes");
    expect(parseServerSource).not.toHaveBeenCalled();
    expect(state.job?.status).toBe("failed");
  });

  it("fails a v2 Job before parsing when its raw Storage bytes change",async()=>{
    const input=queuedV2Run();
    state.blobs.set(input.inputRef,new Blob(["HELLO"],{type:"text/plain"}));
    await expect(executeSourceParseStep(input)).rejects.toThrow("Parse source Artifact content mismatch");
    expect(parseServerSource).not.toHaveBeenCalled();
    expect(state.job?.status).toBe("failed");
    expect(state.blobs.has(input.outputRef)).toBe(false);
  });

  it("rejects a stale v2 run before it changes a newer Job generation",async()=>{
    const input=queuedV2Run();
    state.job=EvolutionJobSchema.parse({...state.job,generation:3,
      inputRef:"next-input",outputRef:"next-output"});
    await expect(executeSourceParseStep(input)).rejects.toThrow("Parse Workflow 与当前 Job 绑定不一致");
    expect(state.job).toMatchObject({generation:3,status:"queued"});
    expect(parseServerSource).not.toHaveBeenCalled();
  });

  it("does not mark a newer generation failed when it replaces a run during parsing",async()=>{
    const input=queuedV2Run();
    state.changeJobOnParse=true;
    await expect(executeSourceParseStep(input)).rejects.toThrow("Parse Workflow generation changed");
    expect(state.job).toMatchObject({generation:3,status:"queued",inputRef:"next-input"});
    expect(state.blobs.has(input.outputRef)).toBe(false);
  });
});
