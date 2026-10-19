// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {EvolveProjectSchema,EvolutionJobSchema,type EvolveProject,type MissionEnvelope,missionEnvelope,type EvolutionJob,type EvolutionWorkflowRunInput} from "@evolution/contracts";
import {acceptedPackageFixture,recoveredControlAiFixture} from "@evolution/testkit";
import {recoverServerMainFlowWait,serverFailedControlRetryWire,serverMainFlowRecoveryActive} from "@evolution/harness";
import {checkpointServerMainFlowWait,hasServerMainFlowRecoveryBinding} from "./server-main-flow-recovery";
import route from "../../server/api/evolution/start.post";
import {MissionRevisionConflictError} from "./production-runtime";
import {initializeWorkflowControlStep} from "../../../../workflows/evolution-mission/steps";
const mocks=vi.hoisted(()=>({start:vi.fn(),getRun:vi.fn(),readRun:vi.fn(),create:vi.fn(),bind:vi.fn(),readPrior:vi.fn(),runtime:vi.fn(),readEnvelope:vi.fn(),cas:vi.fn(),save:vi.fn(),put:vi.fn(),append:vi.fn(),cancel:vi.fn()}));
vi.mock("workflow/api",()=>({start:mocks.start,getRun:mocks.getRun}));
vi.mock("workflow/runtime",()=>({getWorld:()=>({runs:{get:mocks.readRun}})}));
vi.mock("../../../../workflows/evolution-mission",()=>({evolutionMissionWorkflow:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./production-runtime",async(original)=>({...await original<typeof import("./production-runtime")>(),getServerProductionRuntime:mocks.runtime,getServerMissionEnvelope:mocks.readEnvelope,compareAndSwapServerMissionEnvelope:mocks.cas,createServerJobIdempotentReceipt:mocks.create,bindServerJobWorkflowRun:mocks.bind,getServerJobByIdempotencyKey:mocks.readPrior}));
const fixture=acceptedPackageFixture().project;
let mission:EvolveProject={...fixture,campaign:{...fixture.campaign,status:"running" as const}};
const sourceUpdatedAt=mission.updatedAt;
const old=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"old-control",missionId:mission.id,type:"campaign",status:"running",label:"old",idempotencyKey:`workflow-control:${mission.id}:original`,generation:1,attempts:1,priority:70,outputRef:"old-run",createdAt:"2026-10-12T00:00:00Z",updatedAt:"2026-10-12T00:00:00Z"});
const jobs=new Map<string,EvolutionJob>();
const key="server-failed-control-retry:"+createHash("sha256").update(serverFailedControlRetryWire(mission.id,sourceUpdatedAt,old.id,"old-run")).digest("hex");
function event(body:unknown){return mockEvent(new Request("http://localhost/api/evolution/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));}
function retryRequest(){return event({missionId:mission.id,intent:"retry-failed-control",retryOfControlJobId:old.id,retryOfRunId:"old-run",expectedMissionUpdatedAt:sourceUpdatedAt,idempotencyKey:key});}
beforeEach(()=>{
 for(const fn of Object.values(mocks))fn.mockReset();jobs.clear();jobs.set(old.id,structuredClone(old));
 let revision=29;
 mocks.readEnvelope.mockImplementation(async()=>missionEnvelope(mission,revision));
 mocks.cas.mockImplementation(async(next:MissionEnvelope)=>{if(next.revision!==revision)throw new MissionRevisionConflictError(mission.id,next.revision,revision);revision++;mission=next.payload;return {...next,revision};});
 mission={...structuredClone(fixture),campaign:{...structuredClone(fixture.campaign),status:"running"}};
 mocks.runtime.mockReturnValue({missions:{get:async()=>mission,save:mocks.save},jobs:{list:async()=>[...jobs.values()],get:async(id:string)=>jobs.get(id),put:async(job:EvolutionJob)=>{mocks.put(job);jobs.set(job.id,job);}},events:{append:mocks.append}});
 mocks.readPrior.mockImplementation(async(key:string)=>[...jobs.values()].find(job=>job.idempotencyKey===key));
 mocks.create.mockImplementation(async(job:EvolutionJob)=>{const prior=[...jobs.values()].find(value=>value.idempotencyKey===job.idempotencyKey);if(prior)return {job:prior,reused:true};jobs.set(job.id,job);return {job,reused:false};});
 mocks.bind.mockImplementation(async(id:string,generation:number,runId:string)=>{const bound=EvolutionJobSchema.parse({...jobs.get(id),generation,outputRef:runId});jobs.set(id,bound);return bound;});
 mocks.start.mockResolvedValue({runId:"new-run"});
 mocks.getRun.mockReturnValue({exists:Promise.resolve(true),get status(){throw new Error("FULL_USER_DATA_READ_FORBIDDEN");},cancel:mocks.cancel});
 mocks.readRun.mockImplementation(async(runId:string)=>({runId,status:runId==="old-run"?"failed":"running",get input(){throw new Error("USER_INPUT_READ_FORBIDDEN");},get output(){throw new Error("USER_OUTPUT_READ_FORBIDDEN");}}));

});
describe("governed failed control retry through normal start",()=>{
 it("creates a distinct bound Job/Run and starts only the new control",async()=>{
  const result=await route(retryRequest());expect(result).toMatchObject({runId:"new-run",status:"queued"});
  expect(mocks.start).toHaveBeenCalledOnce();expect(mocks.cancel).not.toHaveBeenCalled();
  const input=mocks.start.mock.calls[0][1][0] as EvolutionWorkflowRunInput;
  expect(input.controlJobId).not.toBe(old.id);expect(input.failedControlRetry).toMatchObject({retryOfControlJobId:old.id,retryOfRunId:"old-run",sourceUpdatedAt});
  await initializeWorkflowControlStep(input);
  expect(jobs.get(old.id)).toEqual(old);expect(jobs.size).toBe(2);
  expect(mocks.put.mock.calls.every(([value])=>value.id===input.controlJobId)).toBe(true);
  expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({id:`evt-${input.controlJobId}-started`,jobId:input.controlJobId,type:"JobStarted"}));
  expect(mocks.save).not.toHaveBeenCalled();
 });
 it("preserves a failed bound idle first Run while starting its explicit normal retry",async()=>{
  mission={...mission,candidates:[],searchChampion:undefined,evolutionArchive:[],attentionRequests:[],
    baselineRun:{...mission.baselineRun,status:"idle",runs:[],result:undefined},
    experimentRun:{...mission.experimentRun,status:"idle",winnerId:undefined,candidateResults:[]},
    validationRun:{...mission.validationRun,status:"idle",candidateId:undefined,evaluation:undefined,baselineEvaluation:undefined,runs:[],baselineRuns:[],checks:[]},
    artifactAcceptance:{...mission.artifactAcceptance,status:"idle",attempts:0,hardGatePass:false,candidateId:undefined,frozenArtifacts:undefined,acceptedAt:undefined},
    campaign:{...mission.campaign,status:"idle",currentRound:0,startedAt:undefined,stopReason:undefined,
      serverControlOwner:{schemaVersion:"server-workflow-control-owner-v1",controlJobId:old.id,runId:"old-run",operationKey:old.idempotencyKey,
        phase:"bound",sourceUpdatedAt,inputFingerprint:"a".repeat(64),requestedAt:old.createdAt}}};
  // Match the production read port: normalize the envelope payload through its public schema.
  mission=EvolveProjectSchema.parse(mission);
  const firstSource=structuredClone(mission.sourceArtifacts),result=await route(retryRequest());
  expect(result).toMatchObject({runId:"new-run",status:"queued"});expect(mocks.start).toHaveBeenCalledOnce();
  await initializeWorkflowControlStep(mocks.start.mock.calls[0][1][0]);
  expect(jobs.get(old.id)).toEqual(old);expect(mocks.cancel).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
  expect(mission.sourceArtifacts).toEqual(firstSource);expect(mission.candidates).toEqual([]);expect(mission.baselineRun.status).toBe("idle");
 });
 it("replays the same retry acknowledgement after Mission advancement without starting another Run",async()=>{
  const first=await route(retryRequest());mission={...mission,updatedAt:"2026-10-12T02:00:00Z"};
  expect(await route(retryRequest())).toMatchObject({...first,reused:true});
  expect(mocks.start).toHaveBeenCalledOnce();expect(mocks.bind).toHaveBeenCalledOnce();expect(jobs.get(old.id)).toEqual(old);
 });
 it("rejects the original stable request for the failed old SDK Run",async()=>{
  const request=event({missionId:mission.id,idempotencyKey:"original"});
  expect(await route(request)).toMatchObject({error:expect.any(String),controlJobId:old.id});expect(request.res.status).toBe(409);
  expect(mocks.start).not.toHaveBeenCalled();expect(jobs.size).toBe(1);expect(jobs.get(old.id)).toEqual(old);
 });
 it("rejects Mission changes between accepted retry and actual initialization before Job/Event writes",async()=>{
  await route(retryRequest());const input=mocks.start.mock.calls[0][1][0] as EvolutionWorkflowRunInput;
  mission={...mission,goal:mission.goal+" changed",updatedAt:"2026-10-12T02:00:00Z"};
  await expect(initializeWorkflowControlStep(input)).rejects.toThrow("后台重试的输入或当前断点已变化");
  expect(mocks.put).not.toHaveBeenCalled();expect(mocks.append).not.toHaveBeenCalled();expect(jobs.get(old.id)).toEqual(old);
 }); it("recovers a known Run whose owner binding receipt was lost without starting another Run",async()=>{
  const original=mocks.cas.getMockImplementation()!;let failures=1;
  mocks.cas.mockImplementation(async(next:MissionEnvelope)=>{
   if(next.payload.campaign.serverControlOwner?.phase==="bound"&&failures-->0)throw new Error("bind transport lost");
   return original(next);
  });
  const req=retryRequest();
  expect(await route(req)).toMatchObject({code:"WORKFLOW_OWNER_BIND_PENDING",runId:"new-run"});
  expect(req.res.status).toBe(503);expect(mission.campaign.serverControlOwner?.phase).toBe("dispatching");
  expect(await route(retryRequest())).toMatchObject({runId:"new-run",reused:true});
  expect(mission.campaign.serverControlOwner?.phase).toBe("bound");
  await initializeWorkflowControlStep(mocks.start.mock.calls[0][1][0]);
  expect(mocks.start).toHaveBeenCalledOnce();expect(jobs.get(old.id)).toEqual(old);
 });
 it("resumes failed retry reservation before Job creation using its fixed control ID",async()=>{
  mocks.create.mockRejectedValueOnce(new Error("Job transport lost"));
  await expect(route(retryRequest())).rejects.toThrow("Job transport lost");
  const fixedId=mission.campaign.serverControlOwner!.controlJobId;
  expect(jobs.size).toBe(1);expect(mocks.start).not.toHaveBeenCalled();
  expect(await route(retryRequest())).toMatchObject({controlJobId:fixedId,runId:"new-run"});
  expect(mocks.start).toHaveBeenCalledOnce();expect(jobs.get(old.id)).toEqual(old);
 });
 it("ordinary same-key unsent reservation resumes before or after Job creation",async()=>{
  jobs.clear();const req=()=>event({missionId:mission.id,idempotencyKey:"ordinary"});
  mocks.create.mockRejectedValueOnce(new Error("Job transport lost"));
  await expect(route(req())).rejects.toThrow("Job transport lost");
  const owner=mission.campaign.serverControlOwner!;
  const saved={...old,id:owner.controlJobId,outputRef:undefined,idempotencyKey:owner.operationKey,status:"queued" as const,createdAt:owner.requestedAt};
  jobs.set(saved.id,saved);
  expect(await route(req())).toMatchObject({controlJobId:owner.controlJobId,runId:"new-run"});
  expect(mocks.start).toHaveBeenCalledOnce();
 });
 it("a start result unknown never sends a second Run for the same request",async()=>{
  mocks.start.mockRejectedValueOnce(new Error("response lost"));
  const first=retryRequest();expect(await route(first)).toMatchObject({code:"WORKFLOW_START_RESULT_UNKNOWN"});
  expect(first.res.status).toBe(503);expect(mission.campaign.serverControlOwner?.phase).toBe("dispatching");
  const second=retryRequest();expect(await route(second)).toMatchObject({error:expect.any(String)});
  expect(second.res.status).toBe(409);expect(mocks.start).toHaveBeenCalledOnce();expect(jobs.get(old.id)).toEqual(old);
 });
 it("different ordinary keys and missing keys do not disguise a failed Run retry",async()=>{
  for(const body of [{missionId:mission.id,idempotencyKey:"different"},{missionId:mission.id}]){
   const req=event(body);expect(await route(req)).toMatchObject({error:expect.any(String)});expect(req.res.status).toBe(409);
  }
  expect(mocks.create).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();expect(mission.campaign.serverControlOwner).toBeUndefined();
 });
 it("concurrent same-key explicit retries send start only once",async()=>{
  const requests=[retryRequest(),retryRequest()];
  const results=await Promise.all(requests.map(req=>route(req)));
  expect(results.filter(result=>"runId" in result)).toHaveLength(1);
  expect(requests.some(req=>req.res.status===409)).toBe(true);
  expect(mocks.start).toHaveBeenCalledOnce();expect(jobs.get(old.id)).toEqual(old);
 });

 it("recovers scheduled Job/Run binding and schedule acknowledgement using the same request",async()=>{
  jobs.clear();const scheduledFor="2026-10-13T03:00:00Z";
  mission={...mission,campaign:{...mission.campaign,status:"scheduled",schedule:{...mission.campaign.schedule,enabled:true,nextRunAt:scheduledFor}}};
  mocks.save.mockImplementation(async(value:EvolveProject)=>{mission=value;});
  const original=mocks.cas.getMockImplementation()!;let fail=true;
  mocks.cas.mockImplementation(async(next:MissionEnvelope)=>{
   if(next.payload.campaign.serverControlOwner?.phase==="bound"&&fail){fail=false;throw new Error("bind response lost");}
   return original(next);
  });
  const req=()=>event({missionId:mission.id,scheduledFor,idempotencyKey:"schedule"});
  const first=req();expect(await route(first)).toMatchObject({code:"WORKFLOW_OWNER_BIND_PENDING"});
  expect(first.res.status).toBe(503);expect(mission.campaign.schedule.durableRunId).toBeUndefined();
  expect(await route(req())).toMatchObject({runId:"new-run",reused:true});
  expect(mission.campaign.schedule.durableRunId).toBe("new-run");expect(mission.campaign.serverControlOwner?.phase).toBe("bound");
  expect(mocks.start).toHaveBeenCalledOnce();
 });

});

function recoveringFailedMission(){
 const x=recoveredControlAiFixture();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(x.at));
 const p=EvolveProjectSchema.parse({...x.project,id:old.missionId,campaign:{...x.project.campaign,
  serverControlOwner:{...x.project.campaign.serverControlOwner!,controlJobId:old.id,runId:"old-run",operationKey:old.idempotencyKey}}});
 mission=recoverServerMainFlowWait(checkpointServerMainFlowWait(p,"predecessor-control"),x.at,old.id);
 expect(serverMainFlowRecoveryActive(mission)).toBe(true);expect(hasServerMainFlowRecoveryBinding(mission)).toBe(true);
 mocks.save.mockImplementation(async(next:EvolveProject)=>{mission=EvolveProjectSchema.parse(next);});
 const currentKey="server-failed-control-retry:"+createHash("sha256").update(serverFailedControlRetryWire(mission.id,mission.updatedAt,old.id,"old-run")).digest("hex");
 return event({missionId:mission.id,intent:"retry-failed-control",retryOfControlJobId:old.id,retryOfRunId:"old-run",expectedMissionUpdatedAt:mission.updatedAt,idempotencyKey:currentKey});
}
describe("terminal failed recovering control transfers only its bound generation",()=>{
 afterEach(()=>vi.useRealTimers());
 it("rebinds the recovering pointer through normal retry while retaining old Job, paper and budget",async()=>{
  const req=recoveringFailedMission(),before=structuredClone(mission);
  const result=await route(req);expect(result).toMatchObject({runId:"new-run",status:"queued"});
  const input=mocks.start.mock.calls[0]![1][0] as EvolutionWorkflowRunInput;
  await initializeWorkflowControlStep(input);
  expect(mission.campaign.serverRecoveryWait).toEqual({...before.campaign.serverRecoveryWait,resumedByControlJobId:input.controlJobId});
  expect(mission.campaign.status).toBe("idle");expect(serverMainFlowRecoveryActive(mission)).toBe(true);expect(hasServerMainFlowRecoveryBinding(mission)).toBe(true);
  expect(mission.baselineRun).toEqual(before.baselineRun);expect(mission.diagnosis).toEqual(before.diagnosis);
  expect(mission.campaign.startedAt).toBe(before.campaign.startedAt);expect(mission.campaign.checkpoint).toEqual(before.campaign.checkpoint);
  expect(jobs.get(old.id)).toEqual(old);expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.put.mock.calls.every(([value])=>value.id===input.controlJobId)).toBe(true);
  expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({id:`evt-${input.controlJobId}-recovery-owner-transfer`,type:"ActionCompleted",payload:expect.objectContaining({priorControlJobId:old.id,priorRunId:"old-run",resumedByControlJobId:input.controlJobId})}));
  await initializeWorkflowControlStep(input);expect(mission.baselineRun).toEqual(before.baselineRun);expect(mocks.start).toHaveBeenCalledOnce();
 });
 it("rejects an unverified full SHA even when the fast context still matches",async()=>{
  const req=recoveringFailedMission();mission.campaign.serverRecoveryWait!.inputFingerprint="b".repeat(64);
  expect(serverMainFlowRecoveryActive(mission)).toBe(true);expect(hasServerMainFlowRecoveryBinding(mission)).toBe(false);
  expect(await route(req)).toMatchObject({error:expect.any(String)});expect(req.res.status).toBe(409);expect(mocks.start).not.toHaveBeenCalled();expect(jobs.get(old.id)).toEqual(old);
 });
 it("rejects a recovery generation changed during SDK terminal lookup",async()=>{
  const req=recoveringFailedMission();mocks.readRun.mockImplementation(async(runId:string)=>{
   if(runId==="old-run")mission.campaign.serverRecoveryWait!.resumedByControlJobId="other-control";
   return {runId,status:"failed"};
  });
  expect(await route(req)).toMatchObject({error:expect.any(String)});expect(req.res.status).toBe(409);expect(mocks.start).not.toHaveBeenCalled();expect(jobs.get(old.id)).toEqual(old);
 });

 describe("initialization transfer boundaries",()=>{
  it.each(["generation","sha","metadata"] as const)("rejects changed %s after reservation before new Job/Event writes",async kind=>{
   const req=recoveringFailedMission();await route(req);const input=mocks.start.mock.calls[0]![1][0] as EvolutionWorkflowRunInput;
   if(kind==="generation")mission.campaign.serverRecoveryWait!.resumedByControlJobId="other-control";
   if(kind==="sha")mission.campaign.serverRecoveryWait!.inputFingerprint="b".repeat(64);
   if(kind==="metadata")mission.campaign.serverControlOwner!.retryOfControlJobId="other-control";
   await expect(initializeWorkflowControlStep(input)).rejects.toThrow();expect(mocks.put).not.toHaveBeenCalled();expect(mocks.append).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();expect(jobs.get(old.id)).toEqual(old);
  });
  it("does not initialize the new Job or append transfer after a failed CAS write",async()=>{
   const req=recoveringFailedMission();await route(req);const input=mocks.start.mock.calls[0]![1][0] as EvolutionWorkflowRunInput;
   const before=structuredClone(mission);mocks.save.mockRejectedValue(new Error("synthetic recovery transfer CAS conflict"));
   await expect(initializeWorkflowControlStep(input)).rejects.toThrow("synthetic recovery transfer CAS conflict");expect(mocks.put).not.toHaveBeenCalled();expect(mocks.append).not.toHaveBeenCalled();expect(mission).toEqual(before);expect(jobs.get(old.id)).toEqual(old);
  });
 });
});
