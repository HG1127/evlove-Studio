// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type EvolveProject} from "@evolution/contracts";
import {evidenceFingerprint} from "@evolution/core";
import {type ServerHarnessPlan} from "@evolution/harness";
import {experimentRecoveryAt as at,experimentRecoveryFixture} from "@evolution/testkit";
import {executeServerControlStep} from "../../../../workflows/evolution-mission/steps";

const m=vi.hoisted(()=>({get:vi.fn(),save:vi.fn(),job:vi.fn(),put:vi.fn(),append:vi.fn(),baseline:vi.fn(),holdout:vi.fn(),acceptance:vi.fn(),experiment:vi.fn()}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({missions:{get:m.get,save:m.save},jobs:{get:m.job,put:m.put},events:{append:m.append}})}));
vi.mock("./ai-gateway",async original=>({...await original<typeof import("./ai-gateway")>(),serverAiScoringRouteFingerprint:async()=>"b".repeat(64)}));
vi.mock("../server-env",async original=>({...await original<typeof import("../server-env")>(),serverAiConfigured:async()=>true}));
vi.mock("./server-baseline",()=>({runServerMissionBaseline:m.baseline}));
vi.mock("./server-holdout",()=>({runServerMissionHoldout:m.holdout}));
vi.mock("./server-artifact-acceptance",()=>({runServerMissionArtifactAcceptance:m.acceptance,recoverServerAcceptedOfflineChampion:vi.fn()}));
vi.mock("./server-experiment",()=>({runServerMissionExperiment:m.experiment}));

const input={missionId:"mission",controlJobId:"control",requestedAt:at};
const plan:ServerHarnessPlan={decision:{action:"run-campaign",stage:"experiment",reason:"continue frozen evidence"},checkpoint:{id:"checkpoint",stage:"experiment",round:1},policy:{mode:"auto"},sourceRevision:"revision"};
beforeEach(()=>{
  vi.resetAllMocks();
  m.job.mockResolvedValue(EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"control",missionId:"mission",type:"campaign",status:"running",label:"control",idempotencyKey:"workflow-control:control",generation:1,attempts:1,priority:70,createdAt:at,updatedAt:at}));
  m.baseline.mockRejectedValue(Error("a frozen validation checkpoint must not rebuild the preparatory baseline"));
});

describe("frozen validation Workflow routing",()=>{
  it.each(["experiment","validation","repair"] as const)("resumes %s before an expired preparatory Visible baseline",async phase=>{
    const x=experimentRecoveryFixture(),p=x.project,candidate=x.current;
    p.candidates=[candidate];p.selectedCandidateIds=[candidate.id];
    p.stage="validation";
    p.campaign.checkpoint={round:1,completedPhase:phase==="repair"?"plan":phase,at};
    p.baselineRun.completedAt=at;
    p.baselineRun.measurementFingerprint="expired-preparatory-baseline";
    p.hiddenEvalSuite=[{...p.evalSuite[0]!,id:"H1",hidden:true}];
    p.experimentRun={id:"experiment-r1-server",status:"completed",winnerId:candidate.id,candidateResults:[]};
    const evaluation={...p.baselineRun.result!,criterionScores:[{criterionId:"CONTENT",score:50,pass:false,verificationStatus:"verified" as const,evidence:["known failed document"],gaps:["missing details"],testCaseIds:["H1"]}]};
    const runs=[{testCaseId:"H1",output:"known measured content",verificationStatus:"verified" as const,latencyMs:1,cost:0,trace:[]}];
    p.validationRun={id:"validation-server-r1",status:"completed",validationMode:"full",candidateId:candidate.id,recommendation:"hold",evaluation,runs,baselineRuns:runs,baselineEvaluation:evaluation,baselineSuiteIds:["H1"],baselineContextFingerprint:"same-paper",baselineObservedAt:Date.parse(at),checks:[]};
    p.validationRun.evidenceFingerprint=evidenceFingerprint(p,candidate);
    if(phase==="repair"){
      p.stage="experiment";
      p.artifactAcceptance={...p.artifactAcceptance,status:"repairing",candidateId:candidate.id,attempts:1};
      p.experimentRun={id:"experiment-r1-server",status:"idle",candidateResults:[],summary:"[server-campaign-artifact-repair-visible-pending] remeasure repair"};
      p.validationRun={id:"validation-repair-pending-"+candidate.id,status:"idle",candidateId:candidate.id,runs:[],baselineRuns:[],checks:[]};
    }
    m.get.mockResolvedValue(p);
    m.holdout.mockImplementation(async(project:EvolveProject)=>({control:"stop",project,validation:project.validationRun,readyForArtifactAcceptance:false,evidenceIncomplete:true,reason:"waiting for exact Holdout evidence"}));
    m.acceptance.mockImplementation(async(project:EvolveProject)=>({control:"stop",project,accepted:false,repaired:false,reason:"waiting for physical file read"}));
    m.experiment.mockImplementation(async(project:EvolveProject)=>({control:"stop",project,experiment:project.experimentRun,readyForHoldout:false,reason:"waiting for Visible assessment"}));
    const outcome=await executeServerControlStep(input,plan,0);
    expect(outcome).toMatchObject({control:"stop",result:{status:"waiting-action"}});
    expect(m.baseline).not.toHaveBeenCalled();
    expect(m.holdout).toHaveBeenCalledTimes(phase==="experiment"?1:0);
    expect(m.acceptance).toHaveBeenCalledTimes(phase==="validation"?1:0);
    expect(m.experiment).toHaveBeenCalledTimes(phase==="repair"?1:0);
    expect(m.save.mock.calls[0]![0].candidates[0].artifactSnapshots).toEqual(candidate.artifactSnapshots);
  });
});
