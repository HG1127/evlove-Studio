// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {
  EvolutionJobSchema,
  type EvolutionEvent,
  type EvolutionJob,
  type ProductionRuntimePorts,
} from "@evolution/contracts";
import {cancelServerJobWithWorkflow} from "./job-workflow-cancel";
import {serverControlExecutionSignal,withServerControlExecution} from "./server-control-execution";

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
  it("aborts an in-flight local execution after the durable cancellation settles",async()=>{
    const initial={...makeJob(),generation:1,idempotencyKey:"workflow-control:job-cancel"};
    const state=runtimeFor(initial);
    await withServerControlExecution({missionId:initial.missionId!,controlJobId:initial.id,requestedAt:at},state.runtime.jobs.get,async()=>{
      const signal=serverControlExecutionSignal()!;
      await cancelServerJobWithWorkflow(state.runtime,initial,undefined,async()=>({bound:false,cancelIssued:false,reason:"workflow-run-unbound"}));
      expect(state.job.status).toBe("cancelled");expect(signal.aborted).toBe(true);
    });
  });
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

  it("does not infer a completed Job from a completed Workflow",async()=>{
    const state=runtimeFor(makeJob());
    const result=await cancelServerJobWithWorkflow(
      state.runtime,state.job,undefined,
      async()=>({
        runId:"run-2",bound:true,exists:true,statusBefore:"completed" as const,statusAfter:"completed" as const,
        cancelIssued:false,reason:"workflow-run-terminal" as const,
      }),
    );
    expect(state.cancel).not.toHaveBeenCalled();
    expect(state.put).not.toHaveBeenCalled();
    expect(result.job.status).toBe("running");
    expect(result.requiresReconciliation).toBe(true);
  });

  it("settles a failed Workflow as failed instead of cancelling it",async()=>{
    const state=runtimeFor(makeJob());
    const result=await cancelServerJobWithWorkflow(
      state.runtime,state.job,undefined,
      async()=>({
        runId:"run-failed",bound:true,exists:true,statusBefore:"failed" as const,statusAfter:"failed" as const,
        cancelIssued:false,reason:"workflow-run-terminal" as const,
      }),
    );
    expect(state.cancel).not.toHaveBeenCalled();
    expect(state.put).toHaveBeenCalledWith(expect.objectContaining({status:"failed"}));
    expect(result.job.status).toBe("failed");
    expect(result.requiresReconciliation).toBe(false);
  });

  it("keeps an already terminal Job immutable when a late Workflow status differs",async()=>{
    const state=runtimeFor(makeJob("completed"));
    const result=await cancelServerJobWithWorkflow(
      state.runtime,state.job,undefined,
      async()=>({
        runId:"run-late",bound:true,exists:true,statusBefore:"failed" as const,statusAfter:"failed" as const,
        cancelIssued:false,reason:"workflow-run-terminal" as const,
      }),
    );
    expect(state.put).not.toHaveBeenCalled();
    expect(state.cancel).not.toHaveBeenCalled();
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
