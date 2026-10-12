// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {EvolutionJobSchema,type EvolutionJob,type EvolutionWorkflowRunInput} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {serverFailedControlRetryWire} from "@evolution/harness";
import route from "../../server/api/evolution/start.post";
import {initializeWorkflowControlStep} from "../../../../workflows/evolution-mission/steps";
const mocks=vi.hoisted(()=>({start:vi.fn(),getRun:vi.fn(),readRun:vi.fn(),create:vi.fn(),bind:vi.fn(),readPrior:vi.fn(),runtime:vi.fn(),save:vi.fn(),put:vi.fn(),append:vi.fn(),cancel:vi.fn()}));
vi.mock("workflow/api",()=>({start:mocks.start,getRun:mocks.getRun}));
vi.mock("workflow/runtime",()=>({getWorld:()=>({runs:{get:mocks.readRun}})}));
vi.mock("../../../../workflows/evolution-mission",()=>({evolutionMissionWorkflow:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./production-runtime",async(original)=>({...await original<typeof import("./production-runtime")>(),getServerProductionRuntime:mocks.runtime,createServerJobIdempotentReceipt:mocks.create,bindServerJobWorkflowRun:mocks.bind,getServerJobByIdempotencyKey:mocks.readPrior}));
const fixture=acceptedPackageFixture().project;
let mission={...fixture,campaign:{...fixture.campaign,status:"running" as const}};
const sourceUpdatedAt=mission.updatedAt;
const old=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"old-control",missionId:mission.id,type:"campaign",status:"running",label:"old",idempotencyKey:`workflow-control:${mission.id}:original`,generation:1,attempts:1,priority:70,outputRef:"old-run",createdAt:"2026-10-12T00:00:00Z",updatedAt:"2026-10-12T00:00:00Z"});
const jobs=new Map<string,EvolutionJob>();
const key="server-failed-control-retry:"+createHash("sha256").update(serverFailedControlRetryWire(mission.id,sourceUpdatedAt,old.id,"old-run")).digest("hex");
function event(body:unknown){return mockEvent(new Request("http://localhost/api/evolution/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));}
function retryRequest(){return event({missionId:mission.id,intent:"retry-failed-control",retryOfControlJobId:old.id,retryOfRunId:"old-run",expectedMissionUpdatedAt:sourceUpdatedAt,idempotencyKey:key});}
beforeEach(()=>{
 for(const fn of Object.values(mocks))fn.mockReset();jobs.clear();jobs.set(old.id,structuredClone(old));
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
  mission={...mission,updatedAt:"2026-10-12T02:00:00Z"};
  await expect(initializeWorkflowControlStep(input)).rejects.toThrow("后台重试的输入或当前断点已变化");
  expect(mocks.put).not.toHaveBeenCalled();expect(mocks.append).not.toHaveBeenCalled();expect(jobs.get(old.id)).toEqual(old);
 });
});
