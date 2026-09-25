// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type ArtifactStorePort,type EvolutionJob,type ProductionRuntimePorts} from "@evolution/contracts";

const state=vi.hoisted(()=>({
  job:undefined as EvolutionJob|undefined,
  blobs:new Map<string,Blob>(),
  outputPut:false,
  cancelOnOutput:true,
}));

vi.mock("./production-runtime",async(importOriginal)=>{
  const actual=await importOriginal<typeof import("./production-runtime")>();
  const runtime:Pick<ProductionRuntimePorts,"jobs">={
    jobs:{
      list:async()=>state.job?[state.job]:[],
      get:async()=>state.job,
      put:async(job)=>{state.job=EvolutionJobSchema.parse(job);},
      cancel:async()=>undefined,
    },
  };
  return {...actual,getServerProductionRuntime:()=>runtime};
});

vi.mock("./artifact-runtime",()=>({
  getServerArtifactStore:():ArtifactStorePort=>({
    put:async(id,blob)=>{
      state.blobs.set(id,blob);
      if(id==="parse-output"){
        state.outputPut=true;
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
    delete:async(id)=>{state.blobs.delete(id);},
  }),
}));

vi.mock("./server-source-parser",()=>({
  parseServerSource:vi.fn(async()=>({
    id:"artifact-1",
    name:"input.txt",
    role:"target",
    kind:"text",
    mimeType:"text/plain",
    size:5,
    content:"hello",
    createdAt:"2026-09-23T01:00:00.000Z",
    storageRef:"parse-input",
  })),
}));

import {executeSourceParseStep} from "../../../../workflows/source-parse";
import {readSourceParseResult} from "./source-parse-result";

describe("source parse workflow cancellation",()=>{
  afterEach(()=>{
    state.job=undefined;
    state.blobs.clear();
    state.outputPut=false;
    state.cancelOnOutput=true;
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
    state.job=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"parse-job",type:"parse",status:"queued",label:"Parse input.txt",
      idempotencyKey:"parse:artifact-1:5:1",generation:1,attempts:0,priority:80,
      inputRef:"parse-input",outputRef:"parse-output",
      metadata:{identityVersion:"parse-v2",artifactId:"artifact-1",name:"input.txt",
        mimeType:"text/plain",size:5,role:"target"},
      createdAt:"2026-09-23T01:00:00.000Z",updatedAt:"2026-09-23T01:00:00.000Z",
    });
    state.blobs.set("parse-input",new Blob(["hello"],{type:"text/plain"}));

    const result=await executeSourceParseStep({
      jobId:"parse-job",inputRef:"parse-input",outputRef:"parse-output",
      artifactId:"artifact-1",name:"input.txt",mimeType:"text/plain",size:5,
      role:"target",requestedAt:"2026-09-23T01:00:00.000Z",
    });

    expect(result.status).toBe("completed");
    expect(state.job?.status).toBe("completed");
    expect(state.job?.metadata?.resultSha256).toMatch(/^[a-f0-9]{64}$/);
    const parsed=await readSourceParseResult(state.job!,{get:async(id)=>state.blobs.get(id)});
    expect(parsed.artifact).toMatchObject({id:"artifact-1",storageRef:"parse-input"});
    expect(parsed.resultIssue).toBeUndefined();
  });
});
