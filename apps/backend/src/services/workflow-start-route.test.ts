// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {EvolutionJobSchema} from "@evolution/contracts";
import {demoProject} from "../../../../src/features/evolve/data/mock-project";
import route from "../../server/api/evolution/start.post";

const mocks=vi.hoisted(()=>({
  workflowStart:vi.fn(),workflowGetRun:vi.fn(),createJob:vi.fn(),bindRun:vi.fn(),runtime:vi.fn(),
}));
vi.mock("workflow/api",()=>({start:mocks.workflowStart,getRun:mocks.workflowGetRun}));
vi.mock("../../../../workflows/evolution-mission",()=>({evolutionMissionWorkflow:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./production-runtime",async(importOriginal)=>({
  ...await importOriginal<typeof import("./production-runtime")>(),
  getServerProductionRuntime:mocks.runtime,
  createServerJobIdempotentReceipt:mocks.createJob,
  bindServerJobWorkflowRun:mocks.bindRun,
}));

const mission={...demoProject,id:"mission-1"};
const at="2026-09-24T00:00:00.000Z";
const priorJob=EvolutionJobSchema.parse({
  schemaVersion:"job-v1",id:"workflow-control-prior",missionId:mission.id,type:"campaign",
  status:"running",label:"Evolution Workflow Control",
  idempotencyKey:"workflow-control:mission-1:autopilot:revision-1",
  generation:1,attempts:0,priority:70,outputRef:"run-prior",createdAt:at,updatedAt:at,
});

function request(){
  return mockEvent(new Request("http://localhost/api/evolution/start",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({missionId:mission.id,idempotencyKey:"autopilot:revision-1"}),
  }));
}

describe("durable Workflow start idempotency",()=>{
  beforeEach(()=>{
    for(const mock of Object.values(mocks))mock.mockReset();
    mocks.runtime.mockReturnValue({missions:{get:vi.fn(async()=>mission)},jobs:{get:vi.fn(async()=>priorJob)}});
  });
  afterEach(()=>vi.restoreAllMocks());

  it("reuses the bound run without starting another Workflow",async()=>{
    mocks.createJob.mockResolvedValue({job:priorJob,reused:true});
    expect(await route(request())).toEqual({
      missionId:mission.id,controlJobId:priorJob.id,runId:"run-prior",status:"queued",reused:true,
    });
    expect(mocks.workflowStart).not.toHaveBeenCalled();
    expect(mocks.bindRun).not.toHaveBeenCalled();
  });

  it("does not start a second run while the first request is still binding",async()=>{
    mocks.createJob.mockResolvedValue({job:{...priorJob,outputRef:undefined},reused:true});
    expect(await route(request())).toMatchObject({
      error:expect.stringContaining("没有可复用的活动 run"),controlJobId:priorJob.id,
    });
    expect(mocks.workflowStart).not.toHaveBeenCalled();
  });

  it("starts and binds a run only for a newly created Control Job",async()=>{
    const fresh=EvolutionJobSchema.parse({...priorJob,id:"workflow-control-fresh",status:"queued",outputRef:undefined});
    mocks.createJob.mockResolvedValue({job:fresh,reused:false});
    mocks.runtime.mockReturnValue({missions:{get:vi.fn(async()=>mission)},jobs:{get:vi.fn(async()=>fresh)}});
    mocks.workflowStart.mockResolvedValue({runId:"run-fresh"});
    mocks.bindRun.mockResolvedValue({...fresh,outputRef:"run-fresh"});
    expect(await route(request())).toEqual({
      missionId:mission.id,controlJobId:expect.stringMatching(/^workflow-control-/),
      runId:"run-fresh",status:"queued",
    });
    expect(mocks.workflowStart).toHaveBeenCalledOnce();
    expect(mocks.bindRun).toHaveBeenCalledOnce();
  });

  it("reports cancellation failure when a started run loses its Control Job",async()=>{
    const fresh=EvolutionJobSchema.parse({...priorJob,id:"workflow-control-fresh",status:"queued",outputRef:undefined});
    mocks.createJob.mockResolvedValue({job:fresh,reused:false});
    mocks.runtime.mockReturnValue({missions:{get:vi.fn(async()=>mission)},jobs:{get:vi.fn(async()=>undefined)}});
    mocks.workflowStart.mockResolvedValue({runId:"run-orphan"});
    mocks.workflowGetRun.mockReturnValue({exists:Promise.resolve(true),status:Promise.resolve("running"),cancel:vi.fn().mockRejectedValue(new Error("unavailable"))});
    expect(await route(request())).toMatchObject({
      error:expect.stringContaining("取消未确认"),runId:"run-orphan",cleanup:{reason:"workflow-run-cancel-failed"},
    });
    expect(mocks.bindRun).not.toHaveBeenCalled();
  });

  it("returns the actual cleanup receipt when a Control Job disappeared",async()=>{
    const fresh=EvolutionJobSchema.parse({...priorJob,id:"workflow-control-fresh",status:"queued",outputRef:undefined});
    mocks.createJob.mockResolvedValue({job:fresh,reused:false});
    mocks.runtime.mockReturnValue({missions:{get:vi.fn(async()=>mission)},jobs:{get:vi.fn(async()=>undefined)}});
    mocks.workflowStart.mockResolvedValue({runId:"run-orphan"});
    mocks.workflowGetRun.mockReturnValue({exists:Promise.resolve(true),status:Promise.resolve("running"),cancel:vi.fn().mockResolvedValue(undefined)});
    expect(await route(request())).toMatchObject({
      runId:"run-orphan",cleanup:{reason:"workflow-run-cancelled",cancelIssued:true},
    });
  });
});
