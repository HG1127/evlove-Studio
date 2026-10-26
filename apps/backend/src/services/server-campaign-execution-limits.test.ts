// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type EvolveProject} from "@evolution/contracts";
import type {ServerHarnessPlan} from "@evolution/harness";
import {demoProject} from "../../../../src/features/evolve/data/mock-project";
import {executeServerControlStep} from "../../../../workflows/evolution-mission/steps";

const mocks=vi.hoisted(()=>({get:vi.fn(),save:vi.fn(),job:vi.fn(),put:vi.fn(),append:vi.fn(),baseline:vi.fn(),reuse:vi.fn(),frozen:vi.fn(),prepare:vi.fn(),experiment:vi.fn(),holdout:vi.fn(),accept:vi.fn(),ai:vi.fn()}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({missions:{get:mocks.get,save:mocks.save},jobs:{get:mocks.job,put:mocks.put},events:{append:mocks.append}})}));
vi.mock("./server-ai-connection",()=>({serverAiConnectionConfigured:async()=>true}));
vi.mock("./ai-gateway",async original=>({...await original<typeof import("./ai-gateway")>(),serverAiScoringRouteFingerprint:async()=>"route",runServerAi:mocks.ai}));
vi.mock("./server-baseline",()=>({canReuseServerMissionBaseline:mocks.reuse,runServerMissionBaseline:mocks.baseline}));
vi.mock("./server-experiment",()=>({runServerMissionExperiment:mocks.experiment}));
vi.mock("./server-holdout",()=>({runServerMissionHoldout:mocks.holdout}));
vi.mock("./server-artifact-acceptance",()=>({runServerMissionArtifactAcceptance:mocks.accept,recoverServerAcceptedOfflineChampion:vi.fn()}));
vi.mock("@evolution/core",async original=>({...await original<typeof import("@evolution/core")>(),campaignScoringInputBlocker:()=>undefined}));
vi.mock("@evolution/harness",async original=>{
  const actual=await original<typeof import("@evolution/harness")>();
  return {...actual,serverCampaignScoringRouteBlocker:()=>undefined,hasServerFrozenValidationCheckpoint:mocks.frozen,
    advanceServerCampaignPreparation:(...args:Parameters<typeof actual.advanceServerCampaignPreparation>)=>mocks.prepare(...args)??actual.advanceServerCampaignPreparation(...args)};
});

const input={missionId:"mission",controlJobId:"control",requestedAt:new Date().toISOString()};
const plan:ServerHarnessPlan={decision:{action:"run-campaign",stage:"experiment",reason:"continue"},checkpoint:{id:"limit-check",stage:"experiment",round:2},policy:{mode:"auto"},sourceRevision:"revision"};
function project(){
  const p=structuredClone(demoProject);p.id=input.missionId;p.stage="experiment";
  p.campaign={...p.campaign,status:"running",currentRound:0,noImprovementRounds:0,estimatedCost:0,startedAt:new Date().toISOString(),checkpoint:undefined,
    stopCriteria:{...p.campaign.stopCriteria,maxRounds:3,patienceRounds:3,maxEstimatedCost:100,maxWallMinutes:30,stopWhenAcceptanceMet:false,stopWhenMetricTargetsMet:false,stopOnSafetyFailure:false}};
  p.validationRun={...p.validationRun,status:"idle",evaluation:undefined};p.experimentRun={...p.experimentRun,status:"idle",candidateResults:[]};
  p.artifactAcceptance={...p.artifactAcceptance,status:"idle"};return p;
}
beforeEach(()=>{
  vi.resetAllMocks();mocks.job.mockResolvedValue(EvolutionJobSchema.parse({schemaVersion:"job-v1",id:input.controlJobId,missionId:input.missionId,type:"campaign",status:"running",label:"control",idempotencyKey:"workflow-control:control",generation:1,attempts:1,priority:70,createdAt:input.requestedAt,updatedAt:input.requestedAt}));
  mocks.reuse.mockReturnValue(false);
  mocks.frozen.mockReturnValue(false);
  mocks.baseline.mockRejectedValue(new Error("Unexpected costly Baseline"));
  for(const fn of [mocks.experiment,mocks.holdout,mocks.accept,mocks.ai])fn.mockRejectedValue(new Error("Unexpected execution after limit"));
});
describe("campaign limits before paid execution",()=>{
  it.each(["rounds","patience","wall-time","cost","projected-cost"])("settles the %s limit without running another Baseline",async kind=>{
    const p=project();
    if(kind==="rounds"){p.campaign.currentRound=1;p.campaign.stopCriteria.maxRounds=1;}
    if(kind==="patience")p.campaign.noImprovementRounds=3;
    if(kind==="wall-time")p.campaign.startedAt=new Date(Date.now()-31*60000).toISOString();
    if(kind==="cost")p.campaign.estimatedCost=100;
    if(kind==="projected-cost")p.campaign.stopCriteria.maxEstimatedCost=0.00001;
    mocks.get.mockResolvedValue(p);
    const out=await executeServerControlStep(input,plan,0);
    expect(out.control).toBe("stop");expect(mocks.baseline).not.toHaveBeenCalled();expect(mocks.ai).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({campaign:expect.objectContaining({status:"paused",currentRound:p.campaign.currentRound})}));
    expect(mocks.put).toHaveBeenLastCalledWith(expect.objectContaining({status:"waiting"}));
  });
  it.each(["plan","experiment","validation"] as const)("does not use a %s checkpoint to bypass an expired wall-time limit",async completedPhase=>{
    const p=project();p.campaign.startedAt=new Date(Date.now()-31*60000).toISOString();p.campaign.checkpoint={round:1,completedPhase,at:input.requestedAt};
    p.experimentRun={...p.experimentRun,status:"completed",winnerId:"candidate"};p.validationRun={...p.validationRun,status:"completed"};
    mocks.get.mockResolvedValue(p);mocks.frozen.mockReturnValue(true);
    expect((await executeServerControlStep(input,plan,0)).control).toBe("stop");
    for(const fn of [mocks.baseline,mocks.experiment,mocks.holdout,mocks.accept,mocks.ai])expect(fn).not.toHaveBeenCalled();
  });
  it("still executes the necessary Baseline while resources remain available",async()=>{
    const p=project();mocks.get.mockResolvedValue(p);mocks.baseline.mockResolvedValue({project:p,ready:false,reason:"waiting for actual evidence",baseline:{runs:[]}});
    expect((await executeServerControlStep(input,plan,0)).control).toBe("stop");expect(mocks.baseline).toHaveBeenCalledOnce();
    expect(mocks.put).toHaveBeenLastCalledWith(expect.objectContaining({progress:expect.objectContaining({detail:"waiting for actual evidence"})}));
  });
  it("keeps evidence gaps on the governed frozen Holdout route while resources remain available",async()=>{
    const p=project();p.campaign.checkpoint={round:1,completedPhase:"experiment",at:input.requestedAt};
    p.experimentRun={...p.experimentRun,status:"completed",winnerId:"candidate"};p.artifactAcceptance={...p.artifactAcceptance,status:"unverified"};
    mocks.get.mockResolvedValue(p);mocks.frozen.mockReturnValue(true);
    mocks.holdout.mockResolvedValue({project:p,control:"stop",reason:"needs actual evidence",evidenceIncomplete:true,validation:p.validationRun});
    expect((await executeServerControlStep(input,plan,0)).control).toBe("stop");
    expect(mocks.holdout).toHaveBeenCalledOnce();expect(mocks.baseline).not.toHaveBeenCalled();expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("reports the completed Plan and next Experiment without claiming the Experiment passed",async()=>{
    const p=project();mocks.get.mockResolvedValue(p);mocks.reuse.mockReturnValue(true);
    const prepared:EvolveProject={...p,stage:"plan",campaign:{...p.campaign,checkpoint:{round:1,completedPhase:"plan",at:input.requestedAt}}};
    const reason="Server Plan 已完成；进入 Candidate Build / Experiment。";
    mocks.prepare.mockResolvedValue({control:"continue",phase:"experiment",project:prepared,reason});
    expect((await executeServerControlStep(input,plan,0)).control).toBe("continue");
    expect(mocks.put).toHaveBeenLastCalledWith(expect.objectContaining({progress:expect.objectContaining({detail:reason})}));
    expect(mocks.append).toHaveBeenLastCalledWith(expect.objectContaining({payload:expect.objectContaining({completedPhase:"plan",nextPhase:"experiment"})}));
    expect(mocks.experiment).not.toHaveBeenCalled();
  });
});
