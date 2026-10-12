import {describe,expect,it} from "vitest";
import {EvolutionJobSchema,type EvolutionWorkflowStatusResponse} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {serverFailedControlRetryEligibility,serverFailedControlRetryTarget,serverFailedControlRetryWire} from "./server-failed-control-retry";
const project={...acceptedPackageFixture().project,campaign:{...acceptedPackageFixture().project.campaign,status:"running" as const}};
const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"control-1",missionId:project.id,type:"campaign",status:"running",label:"control",idempotencyKey:`workflow-control:${project.id}:old-key`,generation:1,attempts:1,priority:70,outputRef:"run-1",createdAt:"2026-10-12T00:00:00Z",updatedAt:"2026-10-12T00:00:00Z"});
const target={missionId:project.id,jobId:job.id,runId:"run-1"};
const status:EvolutionWorkflowStatusResponse={job,workflow:{exists:true,status:"failed"},events:[]};
describe("failed control retry policy",()=>{
  it("selects latest control deterministically without reordering caller jobs",()=>{
    const newer={...job,id:"control-2",createdAt:"2026-10-12T00:01:00Z",outputRef:"run-2"};
    const jobs=[job,newer];expect(serverFailedControlRetryTarget(project,jobs)).toEqual({...target,jobId:newer.id,runId:"run-2"});
    expect(jobs).toEqual([job,newer]);
  });
  it("never falls back when a newer control is unbound or has contradictory Run refs",()=>{
    const newer={...job,id:"control-2",createdAt:"2026-10-12T00:01:00Z",outputRef:undefined};
    expect(serverFailedControlRetryTarget(project,[job,newer])).toBeUndefined();
    expect(serverFailedControlRetryTarget(project,[{...job,metadata:{runId:"foreign"}}])).toBeUndefined();
    expect(serverFailedControlRetryTarget(project,[{...job,generation:2}])).toBeUndefined();
  });
  it.each(["failed","cancelled"])("accepts bound actual terminal %s without changing old Job status",actual=>{
    expect(serverFailedControlRetryEligibility(project,{...status,workflow:{exists:true,status:actual}},target)).toBe(true);
    expect(job.status).toBe("running");
  });
  it.each(["pending","running","completed","unknown",undefined])("does not retry %s",actual=>{
    expect(serverFailedControlRetryEligibility(project,{...status,workflow:{exists:true,status:actual}},target)).toBe(false);
  });
  it.each([
    {...status,workflow:{exists:false}}, {...status,job:{...job,missionId:"foreign"}},
    {...status,job:{...job,id:"foreign"}}, {...status,job:{...job,outputRef:"foreign"}}, {...status,job:undefined},
  ])("rejects missing or foreign binding %o",value=>{
    expect(serverFailedControlRetryEligibility(project,value,target)).toBe(false);
  });
  it.each(["idle","completed","scheduled"] as const)("does not reenter Mission %s",state=>{
    expect(serverFailedControlRetryEligibility({...project,campaign:{...project.campaign,status:state}},status,target)).toBe(false);
  });
  it("preserves stable operation wire across serialization and distinguishes each input",()=>{
    const args=[project.id,project.updatedAt,job.id,"run-1"] as const;
    const wire=serverFailedControlRetryWire(...args);
    expect(wire).toBe(JSON.stringify(["server-failed-control-retry-v1",...args]));
    expect(serverFailedControlRetryWire(...args)).toBe(wire);
    expect(serverFailedControlRetryWire(project.id,project.updatedAt,job.id,"run-2")).not.toBe(wire);
  });
  it("resumes only the original source of a proven unsent reserved retry",()=>{
    const owner={schemaVersion:"server-workflow-control-owner-v1" as const,controlJobId:"new",operationKey:"workflow-control:"+project.id+":new",sourceUpdatedAt:"original-version",inputFingerprint:"a".repeat(64),requestedAt:"2026-10-12T01:00:00Z",phase:"reserved" as const,retryOfControlJobId:job.id,retryOfRunId:"run-1"};
    const reserved={...project,updatedAt:owner.requestedAt,campaign:{...project.campaign,serverControlOwner:owner}};
    const newJob={...job,id:"new",outputRef:undefined,createdAt:owner.requestedAt};
    expect(serverFailedControlRetryTarget(reserved,[job])).toEqual({...target,sourceUpdatedAt:"original-version"});
    expect(serverFailedControlRetryTarget(reserved,[job,newJob])).toEqual({...target,sourceUpdatedAt:"original-version"});
    expect(serverFailedControlRetryTarget({...reserved,campaign:{...reserved.campaign,serverControlOwner:{...owner,phase:"dispatching"}}},[job,newJob])).toBeUndefined();
    expect(serverFailedControlRetryTarget(reserved,[{...job,outputRef:"foreign"},newJob])).toBeUndefined();
  });

});
