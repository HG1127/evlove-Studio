// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {EvolutionJobSchema,type EvolveProject,type EvolutionJob} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import route from "../../server/api/evolution/start.post";

const mocks=vi.hoisted(()=>({start:vi.fn(),getRun:vi.fn(),create:vi.fn(),bind:vi.fn(),readPrior:vi.fn(),runtime:vi.fn(),save:vi.fn(),put:vi.fn(),append:vi.fn(),cancel:vi.fn()}));
vi.mock("workflow/api",()=>({start:mocks.start,getRun:mocks.getRun}));
vi.mock("../../../../workflows/evolution-mission",()=>({evolutionMissionWorkflow:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./production-runtime",async(original)=>({...await original<typeof import("./production-runtime")>(),getServerProductionRuntime:mocks.runtime,createServerJobIdempotentReceipt:mocks.create,bindServerJobWorkflowRun:mocks.bind,getServerJobByIdempotencyKey:mocks.readPrior}));

const at="2026-10-10T07:00:00.000Z",scheduledFor="2026-10-10T08:00:00.000Z",runId="wrun_current_world_fixture";
let mission:EvolveProject,prior:EvolutionJob;
beforeEach(()=>{
 for(const fn of Object.values(mocks))fn.mockReset();
 mission=structuredClone(acceptedPackageFixture().project);
 mission.updatedAt=at;
 prior=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"workflow-control-fixture",missionId:mission.id,type:"campaign",status:"queued",label:"Workflow",idempotencyKey:`workflow-control:${mission.id}:request-key`,generation:1,attempts:0,priority:70,outputRef:runId,createdAt:at,updatedAt:at});
 mocks.runtime.mockReturnValue({missions:{get:vi.fn(async()=>mission),save:mocks.save},jobs:{get:vi.fn(async()=>prior),put:mocks.put},events:{append:mocks.append}});
 mocks.create.mockImplementation(async()=>({job:prior,reused:true}));
 mocks.readPrior.mockImplementation(async()=>prior);
 mocks.getRun.mockReturnValue({exists:Promise.resolve(true),get status(){throw new Error("USER_PAYLOAD_STATUS_READ_FORBIDDEN");},cancel:mocks.cancel});
});
function request(kind:"normal"|"scheduled"|"remeasure"){
 const body:{missionId:string;idempotencyKey:string;scheduledFor?:string;intent?:"remeasure-current-input";expectedMissionUpdatedAt?:string}={missionId:mission.id,idempotencyKey:"request-key"};
 if(kind==="scheduled"){
  mission.campaign={...mission.campaign,status:"scheduled",schedule:{...mission.campaign.schedule,enabled:true,nextRunAt:scheduledFor,durableScheduledFor:scheduledFor,durableJobId:prior.id,durableRunId:runId}};
  body.scheduledFor=scheduledFor;
 }
 if(kind==="remeasure"){
  prior={...prior,metadata:{workflowIntent:"remeasure-current-input",sourceUpdatedAt:at}};
  body.intent="remeasure-current-input";body.expectedMissionUpdatedAt=at;
 }
 return mockEvent(new Request("http://localhost/api/evolution/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
}
function noNewExecution(){
 expect(mocks.start).not.toHaveBeenCalled();expect(mocks.bind).not.toHaveBeenCalled();expect(mocks.cancel).not.toHaveBeenCalled();
 expect(mocks.save).not.toHaveBeenCalled();expect(mocks.put).not.toHaveBeenCalled();expect(mocks.append).not.toHaveBeenCalled();
}
describe.each(["normal","scheduled","remeasure"] as const)("current-World %s Workflow reuse",kind=>{
 it("rejects a stored binding absent from the current World without starting or repairing it",async()=>{
  mocks.getRun.mockReturnValue({exists:Promise.resolve(false),get status(){throw new Error("MISSING_RUN_STATUS_READ_FORBIDDEN");},cancel:mocks.cancel});
  const event=request(kind),before=structuredClone({mission,prior});const result=await route(event);
  expect(event.res.status).toBe(409);expect(result).toMatchObject({error:expect.any(String),controlJobId:prior.id});
  expect(mocks.getRun).toHaveBeenCalledWith(runId);expect({mission,prior}).toEqual(before);noNewExecution();
 });
 it("returns retryable unavailability on a lookup failure, preserving the same request",async()=>{
  mocks.getRun.mockReturnValue({get exists(){return Promise.reject(new Error("PRIVATE_TOKEN_MUST_NOT_ESCAPE"));},cancel:mocks.cancel});
  const event=request(kind),before=structuredClone({mission,prior});const result=await route(event);
  expect(event.res.status).toBe(503);expect(result).toMatchObject({error:expect.any(String),controlJobId:prior.id});
  expect(JSON.stringify(result)).not.toContain("PRIVATE_TOKEN_MUST_NOT_ESCAPE");expect({mission,prior}).toEqual(before);noNewExecution();
 });
 it("rejects a non-boolean SDK presence value instead of claiming successful reuse",async()=>{
  mocks.getRun.mockReturnValue({exists:Promise.resolve("true"),cancel:mocks.cancel});
  const event=request(kind);expect(await route(event)).toMatchObject({error:expect.any(String),controlJobId:prior.id});expect(event.res.status).toBe(503);noNewExecution();
 });
 it("replays a present binding using metadata presence only",async()=>{
  const event=request(kind),before=structuredClone({mission,prior});expect(await route(event)).toMatchObject({controlJobId:prior.id,runId,reused:true,status:"queued"});
  expect(mocks.getRun).toHaveBeenCalledOnce();expect(mocks.getRun).toHaveBeenCalledWith(runId);expect({mission,prior}).toEqual(before);noNewExecution();
 });
});
