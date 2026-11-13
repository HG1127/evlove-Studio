// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type EvolutionJob,type EvolutionEvent,type ProductionRuntimePorts} from "@evolution/contracts";
import {cancelServerJobWithWorkflow} from "./job-workflow-cancel";
import {cancelLabSubscriptionBudget} from "./server-ai-lab-subscription-budget";
import {createLabWorkflowPermit} from "./lab-workflow-permit";

vi.mock("./server-ai-lab-subscription-budget",()=>({
  cancelLabSubscriptionBudget:vi.fn(async()=>({allowed:true,reason:"cancelled"})),
}));
const keys=["EVOLUTION_EXPERIMENT_MODE","EVOLUTION_LAB_EXPERIMENT_ARMED",
  "EVOLUTION_LAB_APPROVED_MISSION_ID"] as const;
const saved=new Map<string,string|undefined>();
beforeEach(()=>{
  for(const key of keys)saved.set(key,process.env[key]);
  process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
  process.env.EVOLUTION_LAB_EXPERIMENT_ARMED="true";
  process.env.EVOLUTION_LAB_APPROVED_MISSION_ID="lab-synthetic-html-1";
  vi.mocked(cancelLabSubscriptionBudget).mockClear();
});
afterEach(()=>{
  for(const key of keys){const value=saved.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  saved.clear();
});
function make(){
  const at=new Date().toISOString(),missionId="lab-synthetic-html-1",id="lab-control";
  const permit=createLabWorkflowPermit(missionId,"admin",at);
  let job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id,missionId,
    type:"campaign",status:"running",label:"Lab",idempotencyKey:"workflow-control:lab-synthetic-html-1:fixture",
    generation:1,attempts:0,priority:70,createdAt:at,updatedAt:at,metadata:{labExperiment:permit}});
  const calls:string[]=[];
  const runtime={jobs:{
    get:async()=>job,list:async()=>[job],put:async(next:EvolutionJob)=>{job=next;calls.push("job");},
    cancel:async()=>{job=EvolutionJobSchema.parse({...job,status:"cancelled",finishedAt:at});calls.push("cancel");},
  },events:{append:async(_e:EvolutionEvent)=>{void _e;calls.push("event");},list:async()=>[]}} as Pick<ProductionRuntimePorts,"jobs"|"events">;
  return {job,runtime,calls};
}
describe("P3-M Lab Workflow subscription budget cancellation",()=>{
  it("cancels control Job, then irrevocably cancels its subscription token budget",async()=>{
    const state=make();
    const result=await cancelServerJobWithWorkflow(state.runtime,state.job,undefined,
      async()=>({bound:true,exists:true,statusBefore:"running" as const,statusAfter:"cancelled" as const,
        cancelIssued:true,reason:"workflow-run-cancelled" as const}));
    expect(result.job.status).toBe("cancelled");
    expect(cancelLabSubscriptionBudget).toHaveBeenCalledWith({missionId:"lab-synthetic-html-1",controlJobId:"lab-control"});
    expect(state.calls[0]).toBe("cancel");
  });
  it("does not claim a fully settled cancellation if the subscription budget RPC fails",async()=>{
    const state=make();
    vi.mocked(cancelLabSubscriptionBudget).mockRejectedValueOnce(new Error("synthetic no receipt"));
    await expect(cancelServerJobWithWorkflow(state.runtime,state.job,undefined,
      async()=>({bound:false,cancelIssued:false,reason:"workflow-run-unbound" as const})))
      .rejects.toThrow("synthetic no receipt");
    expect(state.calls[0]).toBe("cancel");
  });
});