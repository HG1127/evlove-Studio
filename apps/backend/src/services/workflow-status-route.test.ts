// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockEvent } from "nitro/h3";
import { EvolutionJobSchema } from "@evolution/contracts";
import route from "../../server/api/evolution/status.get";
import { WORKFLOW_STATUS_READ_TIMEOUT_MS } from "./workflow-status-read";

const mocks=vi.hoisted(()=>({getRun:vi.fn(),getJob:vi.fn(),listEvents:vi.fn(),authorize:vi.fn()}));
vi.mock("workflow/api",()=>({getRun:mocks.getRun}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.authorize}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({jobs:{get:mocks.getJob},events:{list:mocks.listEvents}})}));
const at="2026-11-04T00:00:00.000Z";
const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"job-1",missionId:"mission-1",type:"campaign",
  status:"failed",label:"Previous attempt",idempotencyKey:"workflow-control:mission-1:attempt-1",
  outputRef:"wrun-old",createdAt:at,updatedAt:at});
const request=(query="runId=wrun-old&jobId=job-1")=>mockEvent(new Request("http://localhost/api/evolution/status?"+query));
beforeEach(()=>{
  vi.resetAllMocks();
  mocks.getJob.mockResolvedValue(job);
  mocks.listEvents.mockResolvedValue([]);
});
afterEach(()=>vi.useRealTimers());

describe("durable status survives external Workflow read failure",()=>{
  it.each(["pending","running","completed","failed","cancelled"])("returns the actual %s Run and stored Job",async status=>{
    mocks.getRun.mockReturnValue({exists:Promise.resolve(true),status:Promise.resolve(status)});
    expect(await route(request())).toEqual({workflow:{exists:true,status},job,events:[]});
  });
  it("reports a missing Run only after an explicit negative existence observation",async()=>{
    mocks.getRun.mockReturnValue({exists:Promise.resolve(false),get status(){throw Error("must not read status");}});
    expect(await route(request())).toEqual({workflow:{exists:false},job,events:[]});
  });
  it.each(["lookup","exists","status"])("retains Job metadata when %s fails without leaking the provider error",async phase=>{
    const privateError=Error("private provider endpoint and credentials");
    if(phase==="lookup")mocks.getRun.mockImplementation(()=>{throw privateError;});
    else mocks.getRun.mockReturnValue(phase==="exists"
      ?{exists:Promise.reject(privateError)}
      :{exists:Promise.resolve(true),get status(){throw privateError;}});
    const result=await route(request());
    expect(result).toEqual({workflowReadError:"unavailable",job,events:[]});
    expect(JSON.stringify(result)).not.toContain(privateError.message);
    expect(mocks.listEvents).toHaveBeenCalledWith("mission-1",25);
  });
  it("bounds an external read and never converts a late response into an authoritative result",async()=>{
    vi.useFakeTimers();
    let finish:(value:boolean)=>void=()=>undefined;
    mocks.getRun.mockReturnValue({exists:new Promise<boolean>(resolve=>{finish=resolve;}),status:Promise.resolve("running")});
    const pending=route(request());
    await vi.advanceTimersByTimeAsync(WORKFLOW_STATUS_READ_TIMEOUT_MS);
    const result=await pending;
    expect(result).toEqual({workflowReadError:"timeout",job,events:[]});
    finish(true);
    await Promise.resolve();
    expect(result).not.toHaveProperty("workflow");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not query the external Workflow service for a Job-only request",async()=>{
    expect(await route(request("jobId=job-1"))).toEqual({job,events:[]});
    expect(mocks.getRun).not.toHaveBeenCalled();
  });
  it("preserves authentication and database errors instead of disguising them as Workflow uncertainty",async()=>{
    mocks.authorize.mockRejectedValueOnce(Error("unauthorized"));
    await expect(route(request())).rejects.toThrow("unauthorized");
    expect(mocks.getJob).not.toHaveBeenCalled();
    mocks.getJob.mockRejectedValueOnce(Error("database unavailable"));
    await expect(route(request())).rejects.toThrow("database unavailable");
    expect(mocks.getRun).not.toHaveBeenCalled();
  });
});
