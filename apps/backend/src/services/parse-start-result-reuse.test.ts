// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {EvolutionJobSchema,type EvolutionJob} from "@evolution/contracts";

const state=vi.hoisted(()=>( {
  existing:undefined as EvolutionJob|undefined,
  current:undefined as EvolutionJob|undefined,
  output:undefined as Blob|undefined,
  putJob:vi.fn(),putBlob:vi.fn(),start:vi.fn(),getRun:vi.fn(),
}));
vi.mock("nitro/h3",async(importOriginal)=>( {
  ...await importOriginal<typeof import("nitro/h3")>(),
  readMultipartFormData:async()=>[
    {name:"file",filename:"input.txt",type:"text/plain",data:new TextEncoder().encode("hello")},
    {name:"artifactId",data:new TextEncoder().encode("artifact-1")},
  ],
}));
vi.mock("workflow/api",()=>({start:state.start,getRun:state.getRun}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:async()=>undefined}));
vi.mock("../server-env",async(importOriginal)=>( {
  ...await importOriginal<typeof import("../server-env")>(),serverSupabaseSecureConfigured:()=>true,
}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:()=>({
  get:async(id:string)=>id==="parse-result-1"?state.output:undefined,
  put:state.putBlob,delete:async()=>undefined,
})}));
vi.mock("./production-runtime",async(importOriginal)=>( {
  ...await importOriginal<typeof import("./production-runtime")>(),
  getServerJobByIdempotencyKey:async()=>state.existing,
  getServerProductionRuntime:()=>({jobs:{
    get:async()=>state.current,
    put:state.putJob,
  }}),
  bindServerJobWorkflowRun:async(_id:string,_generation:number,runId:string)=>{
    state.current=EvolutionJobSchema.parse({...state.current,metadata:{...state.current?.metadata,runId}});
    return state.current;
  },
}));

import route from "../../server/api/evolution/parse-start.post";

function request(){
  return mockEvent(new Request("http://localhost/api/evolution/parse-start",{method:"POST",body:"test"}));
}

describe("completed Parse result reuse",()=>{
  beforeEach(()=>{
    const artifact={id:"artifact-1",name:"input.txt",role:"target",mimeType:"text/plain",
      size:5,inputMode:"upload",storageRef:"artifact-1",createdAt:"2026-09-24T00:00:00.000Z"};
    const serialized=JSON.stringify(artifact);
    state.output=new Blob([serialized]);
    state.existing=EvolutionJobSchema.parse({
      schemaVersion:"job-v1",id:"parse-1",type:"parse",status:"completed",label:"Parse input.txt",
      idempotencyKey:"parse-key",generation:1,attempts:1,priority:80,
      inputRef:"artifact-1",outputRef:"parse-result-1",
      metadata:{identityVersion:"parse-v2",artifactId:"artifact-1",name:"input.txt",
        mimeType:"text/plain",size:5,role:"target",resultSha256:createHash("sha256").update(serialized).digest("hex")},
      createdAt:"2026-09-24T00:00:00.000Z",updatedAt:"2026-09-24T00:00:00.000Z",
      finishedAt:"2026-09-24T00:00:00.000Z",
    });
    state.current=state.existing;
    state.putJob.mockReset().mockImplementation(async(job:EvolutionJob)=>{state.current=job;});
    state.putBlob.mockReset();
    state.start.mockReset().mockResolvedValue({runId:"run-2"});
    state.getRun.mockReset();
  });

  it("reuses a completed Job only when its stored result passes identity and hash checks",async()=>{
    const response=await route(request());
    expect(response).toMatchObject({jobId:"parse-1",status:"completed",reused:true});
    expect(response.runId).toBeUndefined();
    expect(state.putJob).not.toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
  });

  it("does not invent a Workflow runId for an active Job awaiting binding",async()=>{
    state.existing=EvolutionJobSchema.parse({...state.existing,status:"queued",finishedAt:undefined,outputRef:undefined});
    state.current=state.existing;
    await expect(route(request())).rejects.toMatchObject({status:409,data:{jobId:"parse-1",generation:1}});
    expect(state.start).not.toHaveBeenCalled();
  });

  it("starts a new generation when a completed result has substituted bytes",async()=>{
    state.output=new Blob([JSON.stringify({id:"other",name:"input.txt",role:"target",
      mimeType:"text/plain",size:5,inputMode:"upload",storageRef:"artifact-1",
      createdAt:"2026-09-24T00:00:00.000Z"})]);
    const response=await route(request());
    expect(state.putJob).toHaveBeenCalledWith(expect.objectContaining({id:"parse-1",generation:2,status:"queued"}));
    expect(state.putJob).toHaveBeenCalledWith(expect.objectContaining({
      inputRef:"parse-input-parse-1-g2",outputRef:"parse-result-parse-1-g2",
    }));
    expect(state.start).toHaveBeenCalledOnce();
    expect(state.start.mock.calls[0]?.[1]?.[0]).toMatchObject({
      schemaVersion:"source-parse-workflow-v2",generation:2,
      inputRef:"parse-input-parse-1-g2",outputRef:"parse-result-parse-1-g2",
    });
    expect(response).toMatchObject({jobId:"parse-1",runId:"run-2",status:"queued"});
  });

  it("reports an unconfirmed cancellation when the Parse Job disappears after start",async()=>{
    state.output=new Blob(["substituted result"]);
    state.start.mockImplementationOnce(async()=>{state.current=undefined;return {runId:"run-2"};});
    state.getRun.mockReturnValue({exists:Promise.resolve(true),status:Promise.resolve("running"),cancel:vi.fn().mockRejectedValue(new Error("unavailable"))});
    await expect(route(request())).rejects.toMatchObject({status:503,data:{runId:"run-2"}});
  });
});
