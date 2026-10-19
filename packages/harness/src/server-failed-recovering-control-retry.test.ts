import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {recoveredControlAiFixture} from "@evolution/testkit";
import {recoverServerMainFlowWait,serverMainFlowContextFingerprint,serverMainFlowRecoveryActive} from "./server-main-flow-wait";
import {serverFailedControlRetryEligibility} from "./server-failed-control-retry";
function recovered(){
  const x=recoveredControlAiFixture(),p=x.project;
  p.campaign.serverRecoveryWait={schemaVersion:"server-campaign-recovery-v1",controlJobId:"initial-control",missionId:p.id,round:1,stage:p.stage,marker:"control-ai",reason:p.campaign.stopReason!,inputFingerprint:"a".repeat(64),contextFingerprint:serverMainFlowContextFingerprint(p),status:"waiting",controlAiAttentionRequestId:p.attentionRequests![0]!.id};
  const project=recoverServerMainFlowWait(p,x.at,x.job.id);
  expect(serverMainFlowRecoveryActive(project)).toBe(true);
  return {...x,project,target:{missionId:p.id,jobId:x.job.id,runId:"recovered-run"}};
}
beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-19T00:00:00Z"));});
afterEach(()=>vi.useRealTimers());
describe("explicit failed retry of an admitted recovering idle control",()=>{
  it.each(["failed","cancelled"])("admits exact terminal %s while retaining the prior completed paper and Job",actual=>{
    const x=recovered(),status={job:x.job,workflow:{exists:true,status:actual},events:[]},before=structuredClone({project:x.project,status});
    expect(serverFailedControlRetryEligibility(x.project,status,x.target)).toBe(true);
    expect({project:x.project,status}).toEqual(before);expect(x.project.baselineRun.result!.rubricScore).toBe(81);
  });
  const mutations:Array<[string,(p:EvolveProject)=>void]>=[
    ["source",p=>{p.sourceArtifacts[0]!.textContent+=" drift";}],
    ["recovery owner",p=>{p.campaign.serverRecoveryWait!.resumedByControlJobId="other-control";}],
    ["missing recovery",p=>{p.campaign.serverRecoveryWait=undefined;}],
    ["waiting receipt",p=>{p.campaign.serverRecoveryWait!.status="waiting";}],
    ["unresolved attention",p=>{p.attentionRequests![0]!.status="pending";}],
    ["foreign control",p=>{p.campaign.serverControlOwner!.controlJobId="other-control";}],
    ["foreign Run",p=>{p.campaign.serverControlOwner!.runId="other-run";}],
    ["foreign operation",p=>{p.campaign.serverControlOwner!.operationKey="other-operation";}],
    ["missing binding",p=>{p.campaign.serverControlOwner=undefined;}],
    ["unknown binding",p=>{p.campaign.serverControlOwner!.phase="dispatching";}],
    ["stop boundary",p=>{p.campaign.stopReason="Operator stop";}],
    ["completed boundary",p=>{p.campaign.completedAt="2026-10-19T00:00:00Z";}],
    ["round boundary",p=>{p.campaign.currentRound=1;}],
  ];
  it.each(mutations)("rejects %s",(_name,mutate)=>{const x=recovered();mutate(x.project);expect(serverFailedControlRetryEligibility(x.project,{job:x.job,workflow:{exists:true,status:"failed"},events:[]},x.target)).toBe(false);});
  it.each(["pending","running","completed","unknown",undefined])("rejects SDK state %s",actual=>{const x=recovered();expect(serverFailedControlRetryEligibility(x.project,{job:x.job,workflow:{exists:true,status:actual},events:[]},x.target)).toBe(false);});
});