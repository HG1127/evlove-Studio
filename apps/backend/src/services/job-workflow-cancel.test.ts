// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {
  EvolutionJobSchema,
  type EvolutionEvent,
  type EvolutionJob,
  type ProductionRuntimePorts,
} from "@evolution/contracts";
import {cancelServerJobWithWorkflow} from "./job-workflow-cancel";

const at="2026-09-23T04:00:00.000Z";
function makeJob(status:EvolutionJob["status"]="running"){
  return EvolutionJobSchema.parse({
    schemaVersion:"job-v1",id:"job-cancel",missionId:"mission-1",type:"campaign",
    status,label:"Campaign",idempotencyKey:"job-cancel-key",generation:2,attempts:2,priority:70,
    createdAt:at,startedAt:at,updatedAt:at,
  });
}

function runtimeFor(initial:EvolutionJob){
  let job=initial;
  const events:EvolutionEvent[]=[];
  const cancel=vi.fn(async()=>{
    job=EvolutionJobSchema.parse({
      ...job,status:"cancelled",finishedAt:"2026-09-23T04:01:00.000Z",updatedAt:"2026-09-23T04:01:00.000Z",
    });
  });
  const put=vi.fn(async(next:EvolutionJob)=>{job=EvolutionJobSchema.parse(next);});
  const runtime={
    jobs:{
      list:async()=>[job],
      get:async()=>job,
      put,
      cancel,
    },
    events:{
      append:async(event:EvolutionEvent)=>{events.push(event);},
      list:async()=>events,
    },
  } satisfies Pick<ProductionRuntimePorts,"jobs"|"events">;
  return {runtime,get job(){return job;},events,cancel,put};
}

describe("server Job + Workflow cancellation",()=>{
  it("cancels an active Workflow before settling the Job cancelled",async()=>{
    const state=runtimeFor(makeJob());
    const cancelRun=vi.fn(async()=>({
      runId:"run-1",bound:true,exists:true,statusBefore:"running" as const,statusAfter:"cancelled" as const,
      cancelIssued:true,reason:"workflow-run-cancelled" as const,
    }));
    const result=await cancelServerJobWithWorkflow(state.runtime,state.job,undefined,cancelRun);
    expect(cancelRun).toHaveBeenCalledTimes(1);
    expect(state.cancel).toHaveBeenCalledWith("job-cancel");
    expect(result.job.status).toBe("cancelled");
    expect(state.events[0]).toMatchObject({type:"JobProgress",source:"workflow-cancel"});
  });

  it("does not rewrite a completed Workflow as cancelled",async()=>{
    const state=runtimeFor(makeJob());
    const result=await cancelServerJobWithWorkflow(
      state.runtime,state.job,undefined,
      async()=>({
        runId:"run-2",bound:true,exists:true,statusBefore:"completed" as const,statusAfter:"completed" as const,
        cancelIssued:false,reason:"workflow-run-terminal" as const,
      }),
    );
    expect(state.cancel).not.toHaveBeenCalled();
    expect(state.put).toHaveBeenCalledWith(expect.objectContaining({status:"completed"}));
    expect(result.job.status).toBe("completed");
  });

  it("still cancels the Job when no Workflow run was ever bound",async()=>{
    const state=runtimeFor(makeJob("queued"));
    const result=await cancelServerJobWithWorkflow(
      state.runtime,state.job,undefined,
      async()=>({bound:false,cancelIssued:false,reason:"workflow-run-unbound" as const}),
    );
    expect(state.cancel).toHaveBeenCalledTimes(1);
    expect(result.job.status).toBe("cancelled");
  });
});
