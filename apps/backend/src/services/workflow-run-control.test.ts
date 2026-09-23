// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type EvolveProject} from "@evolution/contracts";
import {cancelBoundWorkflowRun,workflowRunIdForJob} from "./workflow-run-control";

const at="2026-09-23T03:00:00.000Z";
const job=EvolutionJobSchema.parse({
  schemaVersion:"job-v1",id:"workflow-job",missionId:"mission-1",type:"campaign",
  status:"running",label:"Workflow",idempotencyKey:"workflow-control:workflow-job",
  generation:1,attempts:1,priority:70,createdAt:at,updatedAt:at,
});

describe("workflow run control",()=>{
  it("resolves Parse metadata, Campaign outputRef, then scheduled Mission fallback",()=>{
    expect(workflowRunIdForJob({...job,type:"parse",metadata:{runId:"parse-run"}})).toBe("parse-run");
    expect(workflowRunIdForJob({...job,outputRef:"campaign-run"})).toBe("campaign-run");
    expect(workflowRunIdForJob({...job,idempotencyKey:"local-campaign",outputRef:"not-a-run"})).toBeUndefined();
    const mission={
      id:"mission-1",
      campaign:{schedule:{durableJobId:"workflow-job",durableRunId:"scheduled-run"}},
    } as unknown as EvolveProject;
    expect(workflowRunIdForJob(job,mission)).toBe("scheduled-run");
  });

  it("cancels only an active bound Workflow run",async()=>{
    const cancel=vi.fn(async()=>undefined);
    const result=await cancelBoundWorkflowRun(
      {...job,outputRef:"run-active"},
      undefined,
      ()=>({exists:Promise.resolve(true),status:Promise.resolve("running"),cancel}),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      runId:"run-active",statusBefore:"running",statusAfter:"cancelled",
      cancelIssued:true,reason:"workflow-run-cancelled",
    });
  });

  it("does not cancel a completed Workflow run",async()=>{
    const cancel=vi.fn(async()=>undefined);
    const result=await cancelBoundWorkflowRun(
      {...job,outputRef:"run-complete"},
      undefined,
      ()=>({exists:Promise.resolve(true),status:Promise.resolve("completed"),cancel}),
    );
    expect(cancel).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      statusBefore:"completed",statusAfter:"completed",
      cancelIssued:false,reason:"workflow-run-terminal",
    });
  });

  it("treats a cancel-vs-completion race as terminal instead of a provider failure",async()=>{
    const statuses=["running","completed"] as const;
    let read=0;
    const result=await cancelBoundWorkflowRun(
      {...job,outputRef:"run-race"},
      undefined,
      ()=>({
        exists:Promise.resolve(true),
        get status(){return Promise.resolve(statuses[Math.min(read++,1)]!);},
        cancel:async()=>{throw new Error("precondition");},
      }),
    );
    expect(result).toMatchObject({
      statusBefore:"running",statusAfter:"completed",
      cancelIssued:false,reason:"workflow-run-raced-terminal",
    });
  });
});
