// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {EvolutionJobSchema} from "@evolution/contracts";
import route from "../../server/api/evolution/parse-cancel.post";

const mocks=vi.hoisted(()=>({runtime:vi.fn(),cancel:vi.fn(),artifacts:vi.fn(),remove:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./production-runtime",async(importOriginal)=>({
  ...await importOriginal<typeof import("./production-runtime")>(),
  getServerProductionRuntime:mocks.runtime,
}));
vi.mock("./job-workflow-cancel",()=>({cancelServerJobWithWorkflow:mocks.cancel}));
vi.mock("./artifact-runtime",()=>({getServerArtifactStore:mocks.artifacts}));

const at="2026-09-24T00:00:00.000Z";
const job=EvolutionJobSchema.parse({
  schemaVersion:"job-v1",id:"parse-1",type:"parse",status:"running",label:"Parse",
  idempotencyKey:"parse-key",generation:1,attempts:1,priority:80,
  inputRef:"source-1",outputRef:"result-1",createdAt:at,updatedAt:at,
});
const workflow={runId:"run-1",bound:true,exists:true,statusBefore:"running" as const,
  statusAfter:"cancelled" as const,cancelIssued:true,reason:"workflow-run-cancelled" as const};

function request(){
  return mockEvent(new Request("http://localhost/api/evolution/parse-cancel",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({jobId:job.id,deleteArtifact:true}),
  }));
}

describe("Parse cancellation route",()=>{
  beforeEach(()=>{
    for(const mock of Object.values(mocks))mock.mockReset();
    mocks.runtime.mockReturnValue({jobs:{get:vi.fn(async()=>job)}});
    mocks.artifacts.mockReturnValue({delete:mocks.remove});
  });
  afterEach(()=>vi.restoreAllMocks());

  it("reports an unresolved completed Workflow as a conflict",async()=>{
    mocks.cancel.mockResolvedValue({job,workflow,requiresReconciliation:true});
    await expect(route(request())).rejects.toMatchObject({status:409});
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("reports incomplete Artifact cleanup and retries it on the next request",async()=>{
    const cancelled=EvolutionJobSchema.parse({...job,status:"cancelled",finishedAt:at});
    mocks.cancel.mockResolvedValue({job:cancelled,workflow,requiresReconciliation:false});
    mocks.remove.mockImplementationOnce(async()=>{throw new Error("Storage unavailable");});
    await expect(route(request())).rejects.toMatchObject({
      status:503,data:{jobId:job.id,failedArtifactIds:["source-1"]},
    });
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    mocks.remove.mockClear();
    expect(await route(request())).toEqual({jobId:job.id,status:"cancelled",workflow});
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });
});
