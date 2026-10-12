// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type EvolutionJob,type ProductionRuntimePorts} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {reserveServerWorkflowControl,beginServerWorkflowDispatchForMission,bindServerWorkflowOwner,requireServerNewControlAllowed} from "./workflow-control-owner";
import {MissionRevisionConflictError} from "./production-runtime";
import {serverMainFlowRecoveryDigest} from "./server-main-flow-recovery";
import {workflowControlTestStore} from "./workflow-control-test-fixture";
const readRun=vi.hoisted(()=>vi.fn());
vi.mock("./workflow-run-metadata",()=>({readWorkflowRunMetadata:readRun}));
const project={...acceptedPackageFixture().project,campaign:{...acceptedPackageFixture().project.campaign,status:"running" as const}};
const at="2026-10-12T03:00:00.000Z",key="workflow-control:"+project.id+":one";
const job=(id="control",runId="run-1")=>EvolutionJobSchema.parse({schemaVersion:"job-v1",id,missionId:project.id,type:"campaign",status:"running",label:"control",idempotencyKey:"workflow-control:"+project.id+":"+id,generation:1,attempts:1,priority:70,outputRef:runId,createdAt:"2026-10-12T00:00:00Z",updatedAt:at});
const runtime=(jobs:EvolutionJob[])=>({jobs:{list:async()=>jobs}} as unknown as Pick<ProductionRuntimePorts,"jobs">);
beforeEach(()=>{readRun.mockReset().mockResolvedValue({exists:true,status:"completed"});});
describe("Mission envelope atomic control ownership",()=>{
 it("allows only one different-key reservation from the same checked snapshot",async()=>{
  const store=workflowControlTestStore(project);
  const result=await Promise.allSettled([
    reserveServerWorkflowControl(project,key,at,undefined,store.read,store.save),
    reserveServerWorkflowControl(project,key+"-other",at,undefined,store.read,store.save),
  ]);
  expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(result.filter(r=>r.status==="rejected")).toHaveLength(1);
  expect(store.revision()).toBe(30);
 });
 it("resumes a proven unsent same-key reservation with the original source version and fixed Job ID",async()=>{
  const store=workflowControlTestStore(project),owner=await reserveServerWorkflowControl(project,key,at,undefined,store.read,store.save);
  expect(store.current().updatedAt).toBe(at);
  expect(await reserveServerWorkflowControl(store.current(),key,"later",undefined,store.read,store.save)).toEqual(owner);
  expect(store.revision()).toBe(30);
  await expect(requireServerNewControlAllowed(runtime([]),store.current(),key)).resolves.toBeUndefined();
 });
 it("does not adopt a changed Mission revision to repeat an old-state decision",async()=>{
  const store=workflowControlTestStore(project);
  store.replace({...project,name:"changed",updatedAt:at});
  await expect(reserveServerWorkflowControl(project,key,at,undefined,store.read,store.save)).rejects.toMatchObject({statusCode:409});
  expect(store.current().campaign.serverControlOwner).toBeUndefined();
 });
 it("rejects an operation for a foreign Mission before any storage access",async()=>{
  const read=vi.fn();
  await expect(reserveServerWorkflowControl(project,"workflow-control:foreign:x",at,undefined,read)).rejects.toMatchObject({statusCode:409});
  expect(read).not.toHaveBeenCalled();
 });
 it("records only one start dispatch permission under concurrent same-key requests",async()=>{
  const store=workflowControlTestStore(project),owner=await reserveServerWorkflowControl(project,key,at,undefined,store.read,store.save);
  const result=await Promise.allSettled([
    beginServerWorkflowDispatchForMission(project.id,owner,store.read,store.save),
    beginServerWorkflowDispatchForMission(project.id,owner,store.read,store.save),
  ]);
  expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(store.current().campaign.serverControlOwner?.phase).toBe("dispatching");
  await expect(beginServerWorkflowDispatchForMission(project.id,owner,store.read,store.save)).rejects.toMatchObject({code:"WORKFLOW_START_RESULT_UNKNOWN"});
 });
 it("rejects changed input before dispatch without giving start permission",async()=>{
  const store=workflowControlTestStore(project),owner=await reserveServerWorkflowControl(project,key,at,undefined,store.read,store.save);
  store.replace({...store.current(),goal:"changed"});
  await expect(beginServerWorkflowDispatchForMission(project.id,owner,store.read,store.save)).rejects.toMatchObject({statusCode:409});
  expect(store.current().campaign.serverControlOwner?.phase).toBe("reserved");
 });
 it("binds the exact Run while preserving concurrent Mission fields and original source identity",async()=>{
  const store=workflowControlTestStore(project),owner=await reserveServerWorkflowControl(project,key,at,undefined,store.read,store.save);
  await beginServerWorkflowDispatchForMission(project.id,owner,store.read,store.save);
  store.replace({...store.current(),name:"human edit"});
  await bindServerWorkflowOwner(project.id,owner,"new-run",store.read,store.save);
  expect(store.current()).toMatchObject({name:"human edit",campaign:{serverControlOwner:{phase:"bound",runId:"new-run",sourceUpdatedAt:project.updatedAt}}});
  await bindServerWorkflowOwner(project.id,owner,"new-run",store.read,store.save);
  await expect(bindServerWorkflowOwner(project.id,owner,"foreign",store.read,store.save)).rejects.toMatchObject({statusCode:409});
 });
 it("rereads a bind CAS conflict only for the same owner",async()=>{
  const store=workflowControlTestStore(project),owner=await reserveServerWorkflowControl(project,key,at,undefined,store.read,store.save);
  await beginServerWorkflowDispatchForMission(project.id,owner,store.read,store.save);
  const save=vi.fn().mockImplementationOnce(async()=>{store.replace({...store.current(),name:"edited"});throw new MissionRevisionConflictError(project.id,30,31);}).mockImplementation(store.save);
  await bindServerWorkflowOwner(project.id,owner,"new-run",store.read,save);
  expect(store.current().name).toBe("edited");expect(save).toHaveBeenCalledTimes(2);
 });
 it("cannot bind or dispatch after a foreign owner wins",async()=>{
  const store=workflowControlTestStore(project),owner=await reserveServerWorkflowControl(project,key,at,undefined,store.read,store.save);
  store.replace({...store.current(),campaign:{...store.current().campaign,serverControlOwner:{...owner,controlJobId:"foreign"}}});
  await expect(bindServerWorkflowOwner(project.id,owner,"run",store.read,store.save)).rejects.toMatchObject({statusCode:409});
  await expect(beginServerWorkflowDispatchForMission(project.id,owner,store.read,store.save)).rejects.toMatchObject({statusCode:409});
 });
 it("replaces a completed owner with the next reservation in one CAS without an ownerless window",async()=>{
  const store=workflowControlTestStore(project),old=await reserveServerWorkflowControl(project,key,at,undefined,store.read,store.save);
  await beginServerWorkflowDispatchForMission(project.id,old,store.read,store.save);
  await bindServerWorkflowOwner(project.id,old,"run-1",store.read,store.save);
  const oldJob={...job(old.controlJobId),idempotencyKey:key};
  await requireServerNewControlAllowed(runtime([oldJob]),store.current(),key+"-next");
  const before=store.revision();
  const next=await reserveServerWorkflowControl(store.current(),key+"-next","2026-10-12T04:00:00Z",undefined,store.read,store.save);
  expect(store.revision()).toBe(before+1);expect(next.controlJobId).not.toBe(old.controlJobId);
  expect(store.current().campaign.serverControlOwner).toEqual(next);
 });
 it.each(["pending","running","failed","cancelled"])("ordinary new keys cannot disguise Run %s as a fresh start",async(status)=>{
  readRun.mockResolvedValue({exists:true,status});
  await expect(requireServerNewControlAllowed(runtime([job()]),project,key)).rejects.toMatchObject({statusCode:409});
 });
 it.each([undefined,{exists:false}])("missing and unavailable states fail closed %o",async(state)=>{
  if(state)readRun.mockResolvedValue(state);else readRun.mockRejectedValue(new Error("PRIVATE"));
  await expect(requireServerNewControlAllowed(runtime([job()]),project,key)).rejects.toMatchObject({statusCode:state?409:503});
 });
 it("newer synthetic completed Job cannot supersede an active authoritative owner",async()=>{
  const store=workflowControlTestStore(project),owner=await reserveServerWorkflowControl(project,key,at,undefined,store.read,store.save);
  await beginServerWorkflowDispatchForMission(project.id,owner,store.read,store.save);
  await bindServerWorkflowOwner(project.id,owner,"run-1",store.read,store.save);
  const newer={...job("newer","completed-run"),createdAt:"2026-10-12T05:00:00Z"};
  await expect(requireServerNewControlAllowed(runtime([job(owner.controlJobId),newer]),store.current(),key+"-other")).rejects.toMatchObject({statusCode:409});
  expect(readRun).not.toHaveBeenCalled();
 });
 it.each(["reserved","dispatching"] as const)("a different key cannot supersede %s even with another completed Job",async(phase)=>{
  const store=workflowControlTestStore(project),owner=await reserveServerWorkflowControl(project,key,at,undefined,store.read,store.save);
  store.replace({...store.current(),campaign:{...store.current().campaign,serverControlOwner:{...owner,phase}}});
  await expect(requireServerNewControlAllowed(runtime([job()]),store.current(),key+"-other")).rejects.toMatchObject({code:"WORKFLOW_START_RESULT_UNKNOWN"});
 });
 it("bind is not allowed before dispatch and matching source digest excludes reservation bookkeeping",async()=>{
  const store=workflowControlTestStore(project),owner=await reserveServerWorkflowControl(project,key,at,undefined,store.read,store.save);
  expect(serverMainFlowRecoveryDigest(store.current())).toBe(owner.inputFingerprint);
  await expect(bindServerWorkflowOwner(project.id,owner,"new-run",store.read,store.save)).rejects.toMatchObject({statusCode:409});
 });
});
