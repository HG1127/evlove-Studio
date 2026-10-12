// @vitest-environment node
import {createHash} from "node:crypto";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,EvolutionWorkflowStartRequestSchema,type ProductionRuntimePorts} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {serverFailedControlRetryWire} from "@evolution/harness";
import {prepareServerFailedControlRetry} from "./workflow-failed-control-retry";

const project={...acceptedPackageFixture().project,campaign:{...acceptedPackageFixture().project.campaign,status:"running" as const}};
const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"control-1",missionId:project.id,type:"campaign",status:"running",label:"control",idempotencyKey:`workflow-control:${project.id}:old-key`,generation:1,attempts:1,priority:70,outputRef:"run-1",createdAt:"2026-10-12T00:00:00Z",updatedAt:"2026-10-12T00:00:00Z"});
const key="server-failed-control-retry:"+createHash("sha256").update(serverFailedControlRetryWire(project.id,project.updatedAt,job.id,"run-1")).digest("hex");
const request=EvolutionWorkflowStartRequestSchema.parse({missionId:project.id,intent:"retry-failed-control",retryOfControlJobId:job.id,retryOfRunId:"run-1",expectedMissionUpdatedAt:project.updatedAt,idempotencyKey:key});
const get=vi.fn(),list=vi.fn(),readJob=vi.fn(),save=vi.fn(),put=vi.fn(),readPrior=vi.fn(),readRun=vi.fn();
const runtime={missions:{get,save},jobs:{get:readJob,list,put}} as unknown as Pick<ProductionRuntimePorts,"missions"|"jobs">;
beforeEach(()=>{vi.resetAllMocks();get.mockResolvedValue(structuredClone(project));list.mockResolvedValue([structuredClone(job)]);readJob.mockResolvedValue(structuredClone(job));readPrior.mockResolvedValue(undefined);readRun.mockResolvedValue({exists:true,status:"failed"});});
describe("explicit failed control retry preparation",()=>{
  it("binds a new normal operation while preserving the original Mission and Job",async()=>{
    const before=structuredClone({project,job});const prepared=await prepareServerFailedControlRetry(runtime,project,request,readPrior,readRun);
    expect(prepared).toMatchObject({binding:{sourceUpdatedAt:project.updatedAt,retryOfControlJobId:job.id,retryOfRunId:"run-1"},metadata:{workflowIntent:"retry-failed-control"}});
    expect({project,job}).toEqual(before);expect(save).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
    expect(readPrior).toHaveBeenCalledWith(`workflow-control:${project.id}:${key}`);
  });
  it("rejects a random key before any identity lookup",async()=>{
    await expect(prepareServerFailedControlRetry(runtime,project,{...request,idempotencyKey:"random"},readPrior,readRun)).rejects.toMatchObject({statusCode:400});
    expect(readPrior).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();
  });
  it.each(["pending","running","completed",undefined])("does not restart old Run %s",status=>{
    readRun.mockResolvedValue({exists:status!==undefined,status});
    return expect(prepareServerFailedControlRetry(runtime,project,request,readPrior,readRun)).rejects.toMatchObject({statusCode:409});
  });
  it("reports safe unavailability without exposing provider data",async()=>{
    readRun.mockRejectedValue(new Error("PRIVATE_TOKEN"));
    await expect(prepareServerFailedControlRetry(runtime,project,request,readPrior,readRun)).rejects.toMatchObject({statusCode:503});
    try{await prepareServerFailedControlRetry(runtime,project,request,readPrior,readRun);}catch(error){expect(String(error)).not.toContain("PRIVATE_TOKEN");}
  });
  it("rejects an initially stale Mission version",async()=>{
    await expect(prepareServerFailedControlRetry(runtime,{...project,updatedAt:"changed"},request,readPrior,readRun)).rejects.toMatchObject({statusCode:409});expect(readRun).not.toHaveBeenCalled();
  });
  it("rejects a Mission changed during status I/O",async()=>{
    get.mockResolvedValue({...project,updatedAt:"changed"});
    await expect(prepareServerFailedControlRetry(runtime,project,request,readPrior,readRun)).rejects.toMatchObject({statusCode:409});
  });
  it("rejects a newer control both before and after status I/O",async()=>{
    const newer={...job,id:"control-2",createdAt:"2026-10-12T00:01:00Z",outputRef:"run-2"};
    list.mockResolvedValue([job,newer]);
    await expect(prepareServerFailedControlRetry(runtime,project,request,readPrior,readRun)).rejects.toMatchObject({statusCode:409});expect(readRun).not.toHaveBeenCalled();
    list.mockReset().mockResolvedValueOnce([job]).mockResolvedValueOnce([job,newer]);
    await expect(prepareServerFailedControlRetry(runtime,project,request,readPrior,readRun)).rejects.toMatchObject({statusCode:409});
  });
  it("recovers a lost acknowledgement using the same generated retry identity after Mission advancement",async()=>{
    const existing={...job,id:"new-control",idempotencyKey:`workflow-control:${project.id}:${key}`,outputRef:"run-2",metadata:{workflowIntent:"retry-failed-control",sourceUpdatedAt:project.updatedAt,retryOfControlJobId:job.id,retryOfRunId:"run-1"}};
    readPrior.mockResolvedValue(existing);
    expect(await prepareServerFailedControlRetry(runtime,{...project,updatedAt:"advanced"},request,readPrior,readRun)).toEqual({reused:existing});
    expect(list).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();
  });
  it("rejects an existing request with conflicting original Run identity",async()=>{
    readPrior.mockResolvedValue({...job,idempotencyKey:`workflow-control:${project.id}:${key}`,metadata:{workflowIntent:"retry-failed-control",sourceUpdatedAt:project.updatedAt,retryOfControlJobId:job.id,retryOfRunId:"foreign"}});
    await expect(prepareServerFailedControlRetry(runtime,project,request,readPrior,readRun)).rejects.toMatchObject({statusCode:409});
  });
});
