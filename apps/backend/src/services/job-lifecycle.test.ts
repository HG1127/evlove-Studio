// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type ProductionRuntimePorts} from "@evolution/contracts";

const transition=vi.hoisted(()=>vi.fn());
vi.mock("./production-runtime",()=>({transitionServerJobWithEvent:transition}));
import {isAllowedJobTransition,transitionJob} from "./job-lifecycle";

const job=EvolutionJobSchema.parse({
  schemaVersion:"job-v1",id:"job-1",missionId:"mission-1",type:"campaign",
  status:"queued",label:"Run",idempotencyKey:"run-1",generation:2,attempts:0,
  priority:50,createdAt:"2026-09-24T00:00:00.000Z",updatedAt:"2026-09-24T00:00:00.000Z",
});
const runtime={jobs:{get:vi.fn(async()=>job)}} as unknown as ProductionRuntimePorts;

describe("Job lifecycle",()=>{
  beforeEach(()=>{transition.mockReset();transition.mockImplementation(async(next)=>next);});

  it("rejects jumps and terminal rewrites",()=>{
    expect(isAllowedJobTransition("queued","completed")).toBe(false);
    expect(isAllowedJobTransition("running","waiting")).toBe(true);
    expect(isAllowedJobTransition("completed","running")).toBe(false);
  });

  it("writes the new state and authoritative Event through one atomic RPC",async()=>{
    const saved=await transitionJob(runtime,"job-1","running","started");
    expect(saved.status).toBe("running");
    expect(transition).toHaveBeenCalledOnce();
    const [next,event]=transition.mock.calls[0]!;
    expect(next.generation).toBe(2);
    expect(event.jobId).toBe("job-1");
    expect(event.missionId).toBe("mission-1");
    expect(event.payload).toMatchObject({from:"queued",to:"running",priorUpdatedAt:job.updatedAt});
  });

  it("does not write a duplicate transition for an unchanged state",async()=>{
    expect(await transitionJob(runtime,"job-1","queued")).toEqual(job);
    expect(transition).not.toHaveBeenCalled();
  });

  it("refuses reconciliation when the observed Job generation, timestamp, or run binding changed",async()=>{
    const observed=EvolutionJobSchema.parse({...job,idempotencyKey:"workflow-control:job-1",outputRef:"run-1"});
    const expectation={generation:2,updatedAt:observed.updatedAt,runId:"run-1"};
    for(const current of [
      {...observed,generation:3},
      {...observed,updatedAt:"2026-09-24T00:01:00.000Z"},
      {...observed,outputRef:"run-2"},
    ]){
      const changed={jobs:{get:vi.fn(async()=>EvolutionJobSchema.parse(current))}} as unknown as ProductionRuntimePorts;
      await expect(transitionJob(changed,"job-1","failed","reconcile",expectation))
        .rejects.toThrow("Job changed since reconciliation inspection");
    }
    expect(transition).not.toHaveBeenCalled();
  });
});
