// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema} from "@evolution/contracts";
import {inspectWorkflowRun,reconcileWorkflowJobs,type JobReconcileDependencies} from "./job-reconciliation";

const now=new Date("2026-09-24T12:00:00.000Z");
const base=EvolutionJobSchema.parse({
  schemaVersion:"job-v1",id:"control-1",missionId:"mission-1",type:"campaign",
  status:"running",label:"Workflow",idempotencyKey:"workflow-control:control-1",
  generation:1,attempts:1,priority:70,outputRef:"run-1",
  createdAt:"2026-09-24T10:00:00.000Z",updatedAt:"2026-09-24T10:00:00.000Z",
});

function deps(inspect:JobReconcileDependencies["inspect"],job=base):JobReconcileDependencies{
  return {list:vi.fn(async()=>[job]),inspect,transition:vi.fn(async(_id,status)=>({...job,status}))};
}

describe("Workflow Job reconciliation",()=>{
  it("validates the external Workflow run state before using it",async()=>{
    const handle=(exists:unknown,status:unknown)=>({
      exists:Promise.resolve(exists),status:Promise.resolve(status),returnValue:Promise.resolve(undefined),
    });
    await expect(inspectWorkflowRun("run-1",()=>handle(true,"running")))
      .resolves.toEqual({exists:true,status:"running"});
    await expect(inspectWorkflowRun("run-1",()=>handle("yes","running"))).rejects.toThrow();
    await expect(inspectWorkflowRun("run-1",()=>handle(true,"unknown"))).rejects.toThrow();
  });

  it("reports a missing run without changing the Job in inspection mode",async()=>{
    const ports=deps(vi.fn(async()=>({exists:false})));
    const report=await reconcileWorkflowJobs({},ports,now);
    expect(report.issues).toMatchObject([{jobId:"control-1",runId:"run-1",issue:"missing-run",repaired:false}]);
    expect(ports.transition).not.toHaveBeenCalled();
  });

  it("fails a stale Job whose Workflow run is confirmed missing",async()=>{
    const ports=deps(vi.fn(async()=>({exists:false})));
    const report=await reconcileWorkflowJobs({repair:true},ports,now);
    expect(report.repaired).toBe(1);
    expect(ports.transition).toHaveBeenCalledWith("control-1","failed",expect.stringContaining("missing-run"));
  });

  it("continues past one failed run inspection without guessing its status or blocking later repairs",async()=>{
    const second=EvolutionJobSchema.parse({...base,id:"control-2",outputRef:"run-2"});
    const ports=deps(vi.fn(async(runId)=>{
      if(runId==="run-1")throw new Error("private upstream diagnostic");
      return {exists:false};
    }));
    ports.list=vi.fn(async()=>[base,second]);
    const report=await reconcileWorkflowJobs({repair:true},ports,now);
    expect(report).toMatchObject({inspected:2,inspectionFailures:1,repaired:1});
    expect(report.issues).toMatchObject([
      {jobId:"control-1",runId:"run-1",issue:"inspection-failed",repaired:false,
        detail:"Workflow run inspection unavailable"},
      {jobId:"control-2",runId:"run-2",issue:"missing-run",repaired:true},
    ]);
    expect(ports.transition).toHaveBeenCalledOnce();
    expect(ports.transition).toHaveBeenCalledWith("control-2","failed",expect.stringContaining("missing-run"));
    expect(JSON.stringify(report)).not.toContain("private upstream diagnostic");
  });

  it("does not infer success from a completed Workflow with an active Job",async()=>{
    const ports=deps(vi.fn(async()=>({exists:true,status:"completed" as const})));
    const report=await reconcileWorkflowJobs({repair:true},ports,now);
    expect(report.issues).toMatchObject([{issue:"workflow-completed",repaired:false}]);
    expect(ports.transition).not.toHaveBeenCalled();
  });

  it("repairs a running Job only from its exact validated Workflow result",async()=>{
    const ports=deps(vi.fn(async()=>({
      exists:true,status:"completed" as const,
      result:{missionId:"mission-1",controlJobId:"control-1",status:"completed",iterations:3},
    })));
    const report=await reconcileWorkflowJobs({repair:true},ports,now);
    expect(report.issues).toMatchObject([{issue:"workflow-result-completed",resultStatus:"completed",repaired:true}]);
    expect(ports.transition).toHaveBeenCalledWith("control-1","completed",expect.stringContaining("workflow-result-completed"));
  });

  it("keeps a completed run unresolved when its result is missing, mismatched, or nonterminal",async()=>{
    for(const result of [
      undefined,
      {missionId:"mission-1",controlJobId:"another",status:"completed",iterations:3},
      {missionId:"mission-1",controlJobId:"control-1",status:"waiting-human",iterations:3},
    ]){
      const ports=deps(vi.fn(async()=>({exists:true,status:"completed" as const,result})));
      const report=await reconcileWorkflowJobs({repair:true},ports,now);
      expect(report.issues).toMatchObject([{issue:"workflow-completed",repaired:false}]);
      expect(ports.transition).not.toHaveBeenCalled();
    }
  });

  it("repairs a completed run that returned an exact failed Mission result",async()=>{
    const ports=deps(vi.fn(async()=>({
      exists:true,status:"completed" as const,
      result:{missionId:"mission-1",controlJobId:"control-1",status:"failed",iterations:2},
    })));
    const report=await reconcileWorkflowJobs({repair:true},ports,now);
    expect(report.issues).toMatchObject([{issue:"workflow-result-failed",resultStatus:"failed",repaired:true}]);
    expect(ports.transition).toHaveBeenCalledWith("control-1","failed",expect.stringContaining("workflow-result-failed"));
  });

  it("does not claim repair when the persisted transition returns another state",async()=>{
    const ports=deps(vi.fn(async()=>({exists:false})));
    ports.transition=vi.fn(async()=>({...base,status:"running" as const}));
    const report=await reconcileWorkflowJobs({repair:true},ports,now);
    expect(report.repaired).toBe(0);
    expect(report.issues).toMatchObject([{issue:"missing-run",repaired:false,
      detail:"Workflow reconciliation did not settle Job to failed"}]);
  });

  it("leaves recently updated Jobs alone",async()=>{
    const fresh=EvolutionJobSchema.parse({...base,updatedAt:"2026-09-24T11:59:00.000Z"});
    const ports=deps(vi.fn(async()=>({exists:false})),fresh);
    const report=await reconcileWorkflowJobs({repair:true},ports,now);
    expect(report.issues).toEqual([]);
    expect(ports.inspect).not.toHaveBeenCalled();
  });
});
