// @vitest-environment node
import {describe,expect,it} from "vitest";
import {EvolutionJobSchema,EvolutionWorkflowResultSchema} from "@evolution/contracts";
import {planWorkflowResultFinalization} from "./workflow-result-finalization";

const at="2026-09-24T13:00:00.000Z";
const current=EvolutionJobSchema.parse({
  schemaVersion:"job-v1",id:"control-1",missionId:"mission-1",type:"campaign",
  status:"running",label:"Workflow",idempotencyKey:"workflow-control:control-1",
  generation:1,attempts:1,priority:70,
  createdAt:"2026-09-24T12:00:00.000Z",updatedAt:"2026-09-24T12:00:00.000Z",
});
function result(status:"completed"|"failed"|"waiting-human"){
  return EvolutionWorkflowResultSchema.parse({missionId:"mission-1",controlJobId:"control-1",status,iterations:1,reason:"step finished"});
}

describe("Workflow result finalization",()=>{
  it("records a waiting result as progress instead of completion",()=>{
    const planned=planWorkflowResultFinalization(current,result("waiting-human"),at);
    expect(planned).toMatchObject({write:true,eventType:"JobProgress",job:{status:"running"}});
  });

  it("finishes a verified terminal Workflow result",()=>{
    const completed=planWorkflowResultFinalization(current,result("completed"),at);
    expect(completed).toMatchObject({write:true,eventType:"JobCompleted",job:{status:"completed",finishedAt:at}});
    const failed=planWorkflowResultFinalization(current,result("failed"),at);
    expect(failed).toMatchObject({write:true,eventType:"JobFailed",job:{status:"failed",finishedAt:at}});
  });

  it("never reopens a cancelled Job or claims completion when the Job is missing",()=>{
    const cancelled=EvolutionJobSchema.parse({...current,status:"cancelled",finishedAt:at});
    expect(planWorkflowResultFinalization(cancelled,result("completed"),at)).toMatchObject({
      write:false,eventType:"JobProgress",job:{status:"cancelled"},
    });
    expect(planWorkflowResultFinalization(undefined,result("completed"),at)).toEqual({write:false,eventType:"JobProgress"});
  });
});
