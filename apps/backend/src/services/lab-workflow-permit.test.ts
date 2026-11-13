// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema} from "@evolution/contracts";
import {assertLabMissionArmed,assertLabWorkflowPermit,createLabWorkflowPermit,isLabPermitJob,LAB_MAX_DURATION_MS} from "./lab-workflow-permit";
import {serverControlExecutionSignal,withServerControlExecution} from "./server-control-execution";

const keys=["EVOLUTION_EXPERIMENT_MODE","EVOLUTION_LAB_EXPERIMENT_ARMED","EVOLUTION_LAB_APPROVED_MISSION_ID"] as const;
const saved=new Map<string,string|undefined>();
beforeEach(()=>{
  for(const key of keys)saved.set(key,process.env[key]);
  process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
  process.env.EVOLUTION_LAB_EXPERIMENT_ARMED="true";
  process.env.EVOLUTION_LAB_APPROVED_MISSION_ID="lab-synthetic-html-1";
});
afterEach(()=>{
  vi.useRealTimers();
  for(const key of keys){const value=saved.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  saved.clear();
});
function make(){
  const at=new Date().toISOString();
  const permit=createLabWorkflowPermit("lab-synthetic-html-1","admin-fixture",at);
  const input={missionId:"lab-synthetic-html-1",controlJobId:"lab-control-1",requestedAt:at,labExperiment:permit};
  const job=EvolutionJobSchema.parse({
    schemaVersion:"job-v1",id:input.controlJobId,missionId:input.missionId,
    type:"campaign",status:"running",label:"Lab Synthetic",idempotencyKey:"workflow-control:lab-synthetic-html-1:test",
    generation:1,attempts:0,priority:70,createdAt:at,updatedAt:at,metadata:{labExperiment:permit},
  });
  return {permit,input,job};
}
describe("P3-J explicit isolated Lab experiment permit",()=>{
  it("issues an exact-Mission, 20-minute immutable six-call, 300k-token subscription permit",()=>{
    const {permit,input,job}=make();
    expect(Date.parse(permit.deadlineAt)-Date.parse(permit.approvedAt)).toBe(LAB_MAX_DURATION_MS);
    expect(permit).toMatchObject({schemaVersion:"lab-synthetic-experiment-v2",maxCalls:6,maxTokens:300_000,approvedActorId:"admin-fixture"});
    expect(assertLabWorkflowPermit(input,job)).toEqual(permit);
    expect(isLabPermitJob(job)).toBe(true);
  });
  it("refuses a missing Lab approval or switched Mission even before a Job is dispatched",()=>{
    delete process.env.EVOLUTION_LAB_EXPERIMENT_ARMED;
    expect(()=>assertLabMissionArmed("lab-synthetic-html-1")).toThrow();
    process.env.EVOLUTION_LAB_EXPERIMENT_ARMED="true";
    expect(()=>assertLabMissionArmed("other")).toThrow();
    const {input,job}=make();
    expect(()=>assertLabWorkflowPermit({...input,missionId:"other"},job))
      .toThrow();
  });
  it("rejects missing/mismatched persisted Job metadata and stale execution",()=>{
    const {permit,input,job}=make();
    expect(()=>assertLabWorkflowPermit(input,{...job,metadata:undefined}))
      .toThrow();
    expect(()=>assertLabWorkflowPermit(input,{...job,id:"another"}))
      .toThrow();
    expect(()=>assertLabWorkflowPermit({...input,scheduledFor:new Date().toISOString()},job))
      .toThrow();
    expect(()=>assertLabWorkflowPermit(input,job,Date.parse(permit.deadlineAt)))
      .toThrow();
  });
  it("rejects carrying an isolated permit into production mode",()=>{
    const {input}=make();
    delete process.env.EVOLUTION_EXPERIMENT_MODE;
    expect(()=>assertLabWorkflowPermit(input)).toThrow();
    expect(assertLabWorkflowPermit({missionId:input.missionId,controlJobId:input.controlJobId,requestedAt:input.requestedAt}))
      .toBeUndefined();
  });
  it("aborts a pending step no later than its immutable 20-minute deadline",async()=>{
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T00:00:00.000Z"));
    const {input,job}=make();
    let entered!:()=>void;
    const ready=new Promise<void>(resolve=>{entered=resolve;});
    const active=withServerControlExecution(input,async()=>job,async()=>{
      const signal=serverControlExecutionSignal()!;
      entered();
      return new Promise<void>((_resolve,reject)=>{
        signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
      });
    },LAB_MAX_DURATION_MS+100);
    await ready;
    const rejected=expect(active).rejects.toMatchObject({code:"SERVER_CONTROL_EXECUTION_STOPPED"});
    await vi.advanceTimersByTimeAsync(LAB_MAX_DURATION_MS);
    await rejected;
  });
});