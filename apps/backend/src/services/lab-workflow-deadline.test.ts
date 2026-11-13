// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type EvolutionJob} from "@evolution/contracts";
import {createLabWorkflowPermit} from "./lab-workflow-permit";
import {boundLabWorkflowSleep,decideLabWorkflowDeadline} from "./lab-workflow-deadline";
import {cancelLabSubscriptionBudget} from "./server-ai-lab-subscription-budget";
import {inspectLabWorkflowDeadlineStep,stopExpiredLabWorkflowStep} from "../../../../workflows/evolution-mission/steps";

const db=vi.hoisted(()=>({jobGet:vi.fn(),jobCancel:vi.fn(),budgetCancel:vi.fn()}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({
  jobs:{get:db.jobGet,cancel:db.jobCancel},missions:{get:vi.fn()},events:{append:vi.fn()},
})}));
vi.mock("./server-ai-lab-subscription-budget",()=>({
  initializeLabSubscriptionBudget:vi.fn(),cancelLabSubscriptionBudget:db.budgetCancel,
}));
const keys=["EVOLUTION_EXPERIMENT_MODE","EVOLUTION_LAB_EXPERIMENT_ARMED","EVOLUTION_LAB_APPROVED_MISSION_ID"] as const;
const original=new Map<string,string|undefined>();
const start="2026-11-12T01:00:00.000Z";
function make(){
  const permit=createLabWorkflowPermit("lab-synthetic-html-1","admin",start);
  const input={missionId:permit.missionId,controlJobId:"lab-control",requestedAt:start,labExperiment:permit};
  const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"lab-control",missionId:permit.missionId,
    type:"campaign",status:"running",label:"Lab",idempotencyKey:"workflow-control:lab-synthetic-html-1:test",
    generation:1,attempts:0,priority:70,createdAt:start,updatedAt:start,metadata:{labExperiment:permit}});
  return {input,job,permit};
}
beforeEach(()=>{
  for(const k of keys)original.set(k,process.env[k]);
  process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
  process.env.EVOLUTION_LAB_EXPERIMENT_ARMED="true";
  process.env.EVOLUTION_LAB_APPROVED_MISSION_ID="lab-synthetic-html-1";
  vi.useFakeTimers();vi.setSystemTime(new Date(start));
  db.jobGet.mockReset();db.jobCancel.mockReset();db.budgetCancel.mockReset().mockResolvedValue({allowed:true,reason:"cancelled"});
});
afterEach(()=>{
  vi.useRealTimers();for(const k of keys){const v=original.get(k);if(v===undefined)delete process.env[k];else process.env[k]=v;}
  original.clear();
});
describe("P3-K durable Lab workflow deadline decision and terminalization",()=>{
  it("caps a 1-hour durable sleep to the exact remaining 20-minute window",async()=>{
    const {input,job}=make();
    const read=decideLabWorkflowDeadline(input,job,Date.now());
    expect(read).toEqual({kind:"continue",remainingMs:20*60*1000});
    expect(boundLabWorkflowSleep(60*60*1000,read)).toBe(20*60*1000);
    vi.setSystemTime(new Date(Date.parse(start)+20*60*1000));
    expect(decideLabWorkflowDeadline(input,job,Date.now())).toEqual({kind:"stop",reason:"deadline",remainingMs:0});
    expect(boundLabWorkflowSleep(60*60*1000,decideLabWorkflowDeadline(input,job,Date.now()))).toBe(0);
  });
  it("stops a sleeping Workflow when operator disarms it, without waiting for the deadline",()=>{
    const {input,job}=make();
    delete process.env.EVOLUTION_LAB_EXPERIMENT_ARMED;
    expect(decideLabWorkflowDeadline(input,job)).toEqual({kind:"stop",reason:"disarmed",remainingMs:0});
  });
  it("rejects forged Job metadata before any timeout-related writes",async()=>{
    const {input,job}=make();
    db.jobGet.mockResolvedValue({...job,metadata:{labExperiment:{...input.labExperiment,maxCalls:99}}});
    await expect(stopExpiredLabWorkflowStep(input,1)).rejects.toThrow();
    expect(db.budgetCancel).not.toHaveBeenCalled();expect(db.jobCancel).not.toHaveBeenCalled();
  });
  it("never cancels an active Job before its deadline or disarm",async()=>{
    const {input,job}=make();db.jobGet.mockResolvedValue(job);
    await expect(stopExpiredLabWorkflowStep(input,1)).rejects.toThrow(/not yet reached/);
    expect(db.budgetCancel).not.toHaveBeenCalled();
  });
  it("atomically fences subscription tokens first, then cancels the same Job after a durable wake-up",async()=>{
    const {input,job}=make();let current:EvolutionJob=job;const order:string[]=[];
    db.jobGet.mockImplementation(async()=>current);
    db.budgetCancel.mockImplementation(async()=>{order.push("budget-cancel");return {allowed:true,reason:"cancelled"};});
    db.jobCancel.mockImplementation(async(id:string)=>{
      expect(id).toBe(input.controlJobId);order.push("job-cancel");
      current=EvolutionJobSchema.parse({...current,status:"cancelled",finishedAt:input.labExperiment.deadlineAt});
    });
    vi.setSystemTime(new Date(input.labExperiment.deadlineAt));
    const inspection=await inspectLabWorkflowDeadlineStep(input,60*60*1000);
    expect(inspection).toEqual({kind:"stop",reason:"deadline",remainingMs:0,sleepMs:0});
    const result=await stopExpiredLabWorkflowStep(input,3);
    expect(result).toMatchObject({status:"blocked",iterations:3,reason:"LAB_EXPERIMENT_DEADLINE_EXPIRED"});
    expect(order).toEqual(["budget-cancel","job-cancel"]);expect(current.status).toBe("cancelled");
  });
  it("does not mark cancellation complete if subscription budget cancellation cannot be acknowledged",async()=>{
    const {input,job}=make();db.jobGet.mockResolvedValue(job);
    db.budgetCancel.mockRejectedValueOnce(new Error("mock Lab DB unavailable"));
    vi.setSystemTime(new Date(input.labExperiment.deadlineAt));
    await expect(stopExpiredLabWorkflowStep(input,2)).rejects.toThrow("mock Lab DB unavailable");
    expect(db.jobCancel).not.toHaveBeenCalled();
  });
  it("accepts another instance's already terminal Job after a cancellation race",async()=>{
    const {input,job}=make();let current:EvolutionJob=job;db.jobGet.mockImplementation(async()=>current);
    db.jobCancel.mockImplementation(async()=>{
      current=EvolutionJobSchema.parse({...current,status:"cancelled",finishedAt:input.labExperiment.deadlineAt});
      throw new Error("synthetic optimistic cancellation conflict");
    });
    vi.setSystemTime(new Date(input.labExperiment.deadlineAt));
    await expect(stopExpiredLabWorkflowStep(input,2)).resolves.toMatchObject({status:"blocked",reason:"LAB_EXPERIMENT_DEADLINE_EXPIRED"});
    expect(db.budgetCancel).toHaveBeenCalledOnce();expect(db.jobCancel).toHaveBeenCalledOnce();
  });
  it("does not accept a replacement Job with different Lab metadata during a cancellation race",async()=>{
    const {input,job}=make();let current:EvolutionJob=job;db.jobGet.mockImplementation(async()=>current);
    db.jobCancel.mockImplementation(async()=>{
      current=EvolutionJobSchema.parse({...current,status:"cancelled",generation:2,finishedAt:input.labExperiment.deadlineAt});
      throw new Error("synthetic cancellation generation conflict");
    });
    vi.setSystemTime(new Date(input.labExperiment.deadlineAt));
    await expect(stopExpiredLabWorkflowStep(input,2)).rejects.toThrow();
    expect(db.budgetCancel).toHaveBeenCalledOnce();
  });
  it("does not resurrect an already-completed Job when the deadline passes",async()=>{
    const {input,job}=make();db.jobGet.mockResolvedValue({...job,status:"completed",finishedAt:input.labExperiment.approvedAt});
    vi.setSystemTime(new Date(input.labExperiment.deadlineAt));
    const result=await stopExpiredLabWorkflowStep(input,2);
    expect(result).toMatchObject({status:"blocked",reason:"LAB_CONTROL_JOB_ALREADY_TERMINAL"});
    expect(cancelLabSubscriptionBudget).toHaveBeenCalledOnce();expect(db.jobCancel).not.toHaveBeenCalled();
  });
});