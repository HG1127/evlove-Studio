import {describe,expect,it} from "vitest";
import {EvolutionJobSchema,type EvolveProject,type EvolutionWorkflowStatusResponse} from "@evolution/contracts";
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

function unstartedIdle():EvolveProject{
  const p:EvolveProject=structuredClone(project);p.campaign={...p.campaign,status:"idle",currentRound:0,startedAt:undefined,stopReason:undefined,
    serverControlOwner:{schemaVersion:"server-workflow-control-owner-v1",controlJobId:job.id,runId:target.runId,operationKey:job.idempotencyKey,phase:"bound",sourceUpdatedAt:p.updatedAt,inputFingerprint:"a".repeat(64),requestedAt:job.createdAt}};
  p.baselineRun={...p.baselineRun,status:"idle",runs:[],result:undefined};p.candidates=[];p.searchChampion=undefined;p.evolutionArchive=[];p.attentionRequests=[];
  p.experimentRun={...p.experimentRun,status:"idle",winnerId:undefined,candidateResults:[]};p.validationRun={...p.validationRun,status:"idle",candidateId:undefined,evaluation:undefined,baselineEvaluation:undefined,runs:[],baselineRuns:[],checks:[]};p.artifactAcceptance={...p.artifactAcceptance,status:"idle",attempts:0,hardGatePass:false,candidateId:undefined,frozenArtifacts:undefined,acceptedAt:undefined};return p;
}
describe("normal retry of a bound first Run that failed before Campaign start",()=>{
  it("allows the exact failed idle first Run without changing the Mission or old Job",()=>{
    const p=unstartedIdle(),before=structuredClone({p,status});expect(serverFailedControlRetryEligibility(p,status,target)).toBe(true);expect({p,status}).toEqual(before);
  });
  const mutations:Array<[string,(p:EvolveProject)=>void]>=[
    ["missing owner",p=>{p.campaign.serverControlOwner=undefined;}],
    ["unbound owner",p=>{p.campaign.serverControlOwner!.phase="dispatching";}],
    ["foreign Job",p=>{p.campaign.serverControlOwner!.controlJobId="other";}],
    ["foreign Run",p=>{p.campaign.serverControlOwner!.runId="other";}],
    ["foreign operation",p=>{p.campaign.serverControlOwner!.operationKey="other";}],
    ["later round",p=>{p.campaign.currentRound=1;}],
    ["previous start",p=>{p.campaign.startedAt=job.createdAt;}],
    ["explicit stop",p=>{p.campaign.stopReason="operator requested stop";}],
    ["completed Baseline",p=>{p.baselineRun.status="completed";}],
    ["old Baseline row",p=>{p.baselineRun.runs=[{testCaseId:"retained",output:"retained",latencyMs:1,cost:0,verificationStatus:"verified",trace:[]}];}],
    ["old Baseline result",p=>{p.baselineRun.result=structuredClone(project.baselineRun.result!);}],
    ["old Baseline timestamp",p=>{p.baselineRun.startedAt=job.createdAt;}],
    ["old Baseline fingerprint",p=>{p.baselineRun.measurementFingerprint="old";}],
    ["old Hidden evaluation",p=>{p.validationRun.evaluation=structuredClone(project.validationRun.evaluation!);}],
    ["old frozen receipt",p=>{p.artifactAcceptance.frozenArtifacts=structuredClone(project.artifactAcceptance.frozenArtifacts);}],
    ["old accepted timestamp",p=>{p.artifactAcceptance.acceptedAt=job.createdAt;}],
    ["Candidate",p=>{p.candidates=[structuredClone(project.candidates[0]!)];}],
    ["completed Experiment",p=>{p.experimentRun.status="completed";}],
    ["completed Hidden",p=>{p.validationRun.status="completed";}],
    ["Gate F attempt",p=>{p.artifactAcceptance.attempts=1;}],
    ["passed Gate F",p=>{p.artifactAcceptance.status="passed";}],
  ];
  it.each(mutations)("rejects idle retry with %s",(_name,mutate)=>{const p=unstartedIdle();mutate(p);expect(serverFailedControlRetryEligibility(p,status,target)).toBe(false);});
  it.each(["pending","running","completed",undefined])("still rejects nonfailed actual SDK state %s",actual=>{
    expect(serverFailedControlRetryEligibility(unstartedIdle(),{...status,workflow:{exists:true,status:actual}},target)).toBe(false);
  });
});
