// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema} from "@evolution/contracts";
import {demoProject} from "../../../../src/features/evolve/data/mock-project";
import {initializeWorkflowControlStep} from "../../../../workflows/evolution-mission/steps";
import {createLabWorkflowPermit} from "./lab-workflow-permit";

const mocks=vi.hoisted(()=>({
  missionGet:vi.fn(),jobGet:vi.fn(),jobPut:vi.fn(),eventAppend:vi.fn(),
  budgetInitialize:vi.fn(async()=>({allowed:true,reason:"enrolled"})),budgetCancel:vi.fn(),
}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({
  missions:{get:mocks.missionGet},jobs:{get:mocks.jobGet,put:mocks.jobPut},events:{append:mocks.eventAppend},
})}));
vi.mock("./server-confirmation-admission",()=>({assertServerConfirmationAdmission:vi.fn(async()=>undefined)}));
vi.mock("./server-ai-lab-subscription-budget",()=>({
  initializeLabSubscriptionBudget:mocks.budgetInitialize,cancelLabSubscriptionBudget:mocks.budgetCancel,
}));
const keys=["EVOLUTION_EXPERIMENT_MODE","EVOLUTION_LAB_EXPERIMENT_ARMED",
  "EVOLUTION_LAB_APPROVED_MISSION_ID"] as const;
const saved=new Map<string,string|undefined>();
function caseData(){
  const requestedAt=new Date().toISOString(),missionId="lab-synthetic-html-1",controlJobId="control";
  const permit=createLabWorkflowPermit(missionId,"admin-fixture",requestedAt);
  const job=EvolutionJobSchema.parse({
    schemaVersion:"job-v1",id:controlJobId,missionId,type:"campaign",status:"queued",
    label:"Synthetic",idempotencyKey:"workflow-control:lab-synthetic-html-1:fixture",
    generation:1,attempts:0,priority:70,metadata:{labExperiment:permit},
    createdAt:requestedAt,updatedAt:requestedAt,
  });
  return {job,input:{missionId,controlJobId,requestedAt,labExperiment:permit}};
}
beforeEach(()=>{
  for(const key of keys)saved.set(key,process.env[key]);
  process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
  process.env.EVOLUTION_LAB_EXPERIMENT_ARMED="true";
  process.env.EVOLUTION_LAB_APPROVED_MISSION_ID="lab-synthetic-html-1";
  vi.clearAllMocks();
  const mission=structuredClone(demoProject);
  mission.id="lab-synthetic-html-1";
  mocks.missionGet.mockResolvedValue(mission);
  mocks.jobGet.mockResolvedValue(caseData().job);
  mocks.budgetInitialize.mockReset().mockResolvedValue({allowed:true,reason:"enrolled"});
});
afterEach(()=>{
  for(const key of keys){const value=saved.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  saved.clear();
});
describe("P3-J Workflow Step 0 Lab enrollment",()=>{
  it("enrolls the exact saved control Job before setting running or emitting JobStarted",async()=>{
    const {input,job}=caseData();
    mocks.jobGet.mockResolvedValue(job);
    const order:string[]=[];
    mocks.budgetInitialize.mockImplementationOnce(async()=>{order.push("budget");return {allowed:true,reason:"enrolled"};});
    mocks.jobPut.mockImplementationOnce(async()=>{order.push("job-running");});
    mocks.eventAppend.mockImplementationOnce(async()=>{order.push("event");});
    await initializeWorkflowControlStep(input);
    expect(order).toEqual(["budget","job-running","event"]);
    expect(mocks.budgetInitialize).toHaveBeenCalledWith({
      missionId:input.missionId,controlJobId:input.controlJobId,maxCalls:6,
      maxTokens:300_000,minIntervalRemainingPercent:50,minWeeklyRemainingPercent:50,
      deadline:input.labExperiment.deadlineAt,
    });
  });
  it("refuses an unapproved or mismatched Job before state writes",async()=>{
    const {input}=caseData();
    await expect(initializeWorkflowControlStep({...input,labExperiment:undefined})).rejects.toThrow();
    expect(mocks.budgetInitialize).not.toHaveBeenCalled();
    expect(mocks.jobPut).not.toHaveBeenCalled();
    expect(mocks.eventAppend).not.toHaveBeenCalled();
  });
  it("fails closed when durable budget enrollment cannot be acknowledged",async()=>{
    const {input,job}=caseData();
    mocks.jobGet.mockResolvedValue(job);
    mocks.budgetInitialize.mockRejectedValueOnce(new Error("synthetic DB unavailable"));
    await expect(initializeWorkflowControlStep(input)).rejects.toThrow(/Lab.*预算/);
    expect(mocks.jobPut).not.toHaveBeenCalled();
    expect(mocks.eventAppend).not.toHaveBeenCalled();
  });
});