// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type EvolutionWorkflowRunInput} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {getServerWorkflowControlRuntime,requireServerWorkflowControlOwner} from "./workflow-control-runtime";
import {reserveServerWorkflowControl,beginServerWorkflowDispatchForMission,bindServerWorkflowOwner} from "./workflow-control-owner";
import {workflowControlTestStore} from "./workflow-control-test-fixture";
const mocks=vi.hoisted(()=>({runtime:vi.fn(),read:vi.fn(),save:vi.fn(),get:vi.fn()}));
vi.mock("./production-runtime",async(original)=>({...await original<typeof import("./production-runtime")>(),getServerProductionRuntime:mocks.runtime,getServerMissionEnvelope:mocks.read}));
const project=acceptedPackageFixture().project;
let store:ReturnType<typeof workflowControlTestStore>,input:EvolutionWorkflowRunInput;
beforeEach(async()=>{
 vi.resetAllMocks();store=workflowControlTestStore(project);
 const key="workflow-control:"+project.id+":own";
 const owner=await reserveServerWorkflowControl(project,key,"2026-10-12T03:00:00Z",undefined,store.read,store.save);
 await beginServerWorkflowDispatchForMission(project.id,owner,store.read,store.save);
 await bindServerWorkflowOwner(project.id,owner,"own-run",store.read,store.save);
 input={missionId:project.id,controlJobId:owner.controlJobId,controlOwnerKey:key,requestedAt:owner.requestedAt};
 mocks.read.mockImplementation(store.read);mocks.get.mockImplementation(async()=>store.current());
 mocks.runtime.mockReturnValue({missions:{get:mocks.get,save:mocks.save},jobs:{get:async()=>EvolutionJobSchema.parse({schemaVersion:"job-v1",id:input.controlJobId,missionId:input.missionId,type:"campaign",status:"running",label:"own",idempotencyKey:input.controlOwnerKey,generation:1,attempts:1,priority:70,outputRef:"own-run",createdAt:input.requestedAt,updatedAt:input.requestedAt})},events:{}});
});
describe("Workflow ownership before business and Mission writes",()=>{
 it("blocks an old Step at entry after a foreign controller reserves ownership",async()=>{
  await expect(requireServerWorkflowControlOwner({...input,controlJobId:"old"})).rejects.toThrow("其他后台控制");
  expect(mocks.save).not.toHaveBeenCalled();
 });
 it("fails closed for missing owner on a reservation-aware Run",async()=>{
  store.replace({...store.current(),campaign:{...store.current().campaign,serverControlOwner:undefined}});
  await expect(requireServerWorkflowControlOwner(input)).rejects.toThrow("其他后台控制");
 });
 it("defers a dispatched Run until binding is complete without doing a Mission write",async()=>{
  const current=store.current(),owner=current.campaign.serverControlOwner!;
  store.replace({...current,campaign:{...current.campaign,serverControlOwner:{...owner,phase:"dispatching",runId:undefined}}});
  await expect(requireServerWorkflowControlOwner(input)).rejects.toThrow("绑定尚未完成");expect(mocks.save).not.toHaveBeenCalled();
 });
 it("checks current owner before write without refreshing the writer revision token",async()=>{
  const runtime=getServerWorkflowControlRuntime(input),next=store.current();
  next.goal+=" changed";
  await runtime.missions.save(next);
  expect(mocks.read).toHaveBeenCalledOnce();expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledWith(next);
 });
 it("rejects a stale payload when ownership changes between entry and save",async()=>{
  await requireServerWorkflowControlOwner(input);
  const next=store.current(),owner=next.campaign.serverControlOwner!;
  store.replace({...next,campaign:{...next.campaign,serverControlOwner:{...owner,controlJobId:"foreign"}}});
  await expect(getServerWorkflowControlRuntime(input).missions.save(next)).rejects.toThrow("其他后台控制");
  expect(mocks.save).not.toHaveBeenCalled();
 });
 it("rejects payload owner removal and foreign Mission writes before storage",async()=>{
  const next=store.current();
  await expect(getServerWorkflowControlRuntime(input).missions.save({...next,campaign:{...next.campaign,serverControlOwner:undefined}})).rejects.toThrow("其他后台控制");
  await expect(getServerWorkflowControlRuntime(input).missions.save({...next,id:"foreign"})).rejects.toThrow("不属于当前");
  expect(mocks.read).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
 });
 it("retains backward compatibility for existing unreserved Workflow inputs",async()=>{
  await getServerWorkflowControlRuntime({missionId:project.id,controlJobId:"legacy",requestedAt:"old"}).missions.save(project);
  expect(mocks.save).toHaveBeenCalledWith(project);expect(mocks.read).not.toHaveBeenCalled();
 });
});
