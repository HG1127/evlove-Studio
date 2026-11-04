// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {experimentRecoveryWaitFixture} from "@evolution/testkit";
import {prepareCampaignResume} from "./campaign-control";

const at=new Date("2026-11-04T09:00:00.000Z");
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(at);});
afterEach(()=>vi.useRealTimers());
function expired(){
  const p=experimentRecoveryWaitFixture();
  p.campaign.startedAt=new Date(at.getTime()-11*60_000).toISOString();
  p.campaign.noImprovementRounds=0;
  p.campaign.stopCriteria={...p.campaign.stopCriteria,maxRounds:5,patienceRounds:2,maxWallMinutes:10,maxEstimatedCost:undefined,stopOnSafetyFailure:true};
  return p;
}
it("keeps expired time and patience blocked for automatic continuation",()=>{
  for(const patience of [false,true]){
    const p=expired();if(patience)p.campaign.noImprovementRounds=2;
    const result=prepareCampaignResume(p,"continue",at);
    expect(result.reason).toBeTruthy();expect(result.project).toBe(p);
    expect(result.project.campaign.startedAt).toBe(p.campaign.startedAt);
    expect(result.project.campaign.noImprovementRounds).toBe(p.campaign.noImprovementRounds);
  }
});
it("allows explicit resource retry while preserving the original candidate, checkpoint and evidence",()=>{
  const p=expired();p.campaign.noImprovementRounds=2;const before=structuredClone(p);
  const result=prepareCampaignResume(p,"retry-resource-boundary",at);
  expect(result.reason).toBeUndefined();expect(result.project.campaign.startedAt).toBeUndefined();expect(result.project.campaign.noImprovementRounds).toBe(0);
  expect(result.project.campaign.currentRound).toBe(p.campaign.currentRound);expect(result.project.campaign.checkpoint).toBe(p.campaign.checkpoint);
  for(const key of ["candidates","sourceArtifacts","experimentRun","selectedCandidateIds","acceptanceRubric","evalSuite","hiddenEvalSuite","finalHoldout"] as const)expect(result.project[key]).toBe(p[key]);
  expect(p).toEqual(before);
});
it.each(["rounds","cost","safety"])("never renews past the %s boundary",kind=>{
  const p=expired();
  if(kind==="rounds")p.campaign.currentRound=5;
  if(kind==="cost")p.campaign.stopCriteria.maxEstimatedCost=0;
  if(kind==="safety")p.validationRun.evaluation={...p.baselineRun.result!,safety:"FAIL"};
  const result=prepareCampaignResume(p,"retry-resource-boundary",at);expect(result.reason).toBeTruthy();expect(result.project).toBe(p);
});
it("ordinary continuation unpauses without changing a still-live resource window",()=>{
  const p=expired();p.campaign.startedAt=at.toISOString();const result=prepareCampaignResume(p,"continue",at);
  expect(result.reason).toBeUndefined();expect(result.project.campaign.status).toBe("idle");expect(result.project.campaign.startedAt).toBe(p.campaign.startedAt);
});
it("leaves evidence gaps to the planner without clearing them or restarting the resource window",()=>{
  const p=expired();p.campaign.startedAt=at.toISOString();
  p.artifactAcceptance.status="unverified";
  p.validationRun.evaluation={...p.baselineRun.result!,unverifiedCriterionIds:["missing-evidence"]};
  const result=prepareCampaignResume(p,"continue",at);
  expect(result.reason).toBeUndefined();expect(result.project.campaign.status).toBe("idle");
  expect(result.project.artifactAcceptance).toBe(p.artifactAcceptance);expect(result.project.validationRun).toBe(p.validationRun);
  expect(result.project.campaign.startedAt).toBe(p.campaign.startedAt);
  p.validationRun.evaluation.safety="FAIL";
  expect(prepareCampaignResume(p,"retry-resource-boundary",at).reason).toContain("Safety");
});
it("automatic continuation cannot renew a window by supplying a later timestamp",()=>{
  const p=expired();p.campaign.startedAt=at.toISOString();const result=prepareCampaignResume(p,"continue",new Date(at.getTime()+60*60_000));
  expect(result.project.campaign.startedAt).toBe(p.campaign.startedAt);expect(result.project.campaign.noImprovementRounds).toBe(p.campaign.noImprovementRounds);
});
