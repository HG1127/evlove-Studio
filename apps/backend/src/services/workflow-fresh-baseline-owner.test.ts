// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionRequestSchema, EvaluationResultSchema, EvolutionJobSchema, missionEnvelope, type EvolveProject, type EvolutionEvent } from "@evolution/contracts";
import { buildServerHarnessPlan, recoverServerMainFlowWait, serverMainFlowRecoveryActive, serverBaselineFingerprint } from "@evolution/harness";
import { baselinePolicyTransitionFixture } from "@evolution/testkit";
import { prepareServerHtmlProtectionNormalBaselineView, readServerHtmlProtectionCollectionOwner, type ServerHtmlProtectionOwnerPorts } from "./server-html-protection-authority-owner";
import { checkpointServerMainFlowWait, hasServerMainFlowRecoveryBinding } from "./server-main-flow-recovery";
import { executeServerControlStep } from "../../../../workflows/evolution-mission/steps";

// Synthetic composition regression: real owner/allocation guards; no provider, SDK or file execution.
const m=vi.hoisted(()=>({get:vi.fn(),save:vi.fn(),envelope:vi.fn(),job:vi.fn(),put:vi.fn(),append:vi.fn(),event:vi.fn(),route:vi.fn(),baseline:vi.fn(),unavailable:class extends Error{}}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({missions:{get:m.get,save:m.save},jobs:{get:m.job,put:m.put},events:{append:m.append}}),getServerMissionEnvelope:m.envelope,getServerEventById:m.event}));
vi.mock("./server-ai-connection",()=>({serverAiConnectionConfigured:async()=>true,withServerAiConnection:async(work:()=>Promise<unknown>)=>work()}));
vi.mock("./ai-gateway",()=>({serverAiScoringRouteFingerprint:m.route}));
vi.mock("./server-control-ai",()=>({runServerControlAi:vi.fn(),ServerControlAiUnavailableError:m.unavailable}));
vi.mock("./server-baseline",()=>({runServerMissionBaseline:m.baseline}));
const at="2026-10-19T00:00:00.000Z",route="synthetic-fresh-owner-route",input={missionId:"mission",controlJobId:"fresh-control",requestedAt:at,controlOwnerKey:"workflow-control:mission:fresh"};
const job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:input.controlJobId,missionId:input.missionId,type:"campaign",status:"running",label:"Synthetic first control",generation:1,idempotencyKey:input.controlOwnerKey,outputRef:"fresh-run",createdAt:at,updatedAt:at});
let stored:EvolveProject,events:Map<string,EvolutionEvent>,order:string[],ports:ServerHtmlProtectionOwnerPorts;
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(at));
  const p=structuredClone(baselinePolicyTransitionFixture());
  stored={...p,id:input.missionId,updatedAt:at,stage:"baseline",candidates:[],searchChampion:undefined,evolutionArchive:[],attentionRequests:[],
    baselineRun:{...p.baselineRun,id:"unexecuted-baseline",status:"idle",runs:[],result:undefined,startedAt:undefined,completedAt:undefined,measurementFingerprint:undefined},
    experimentRun:{...p.experimentRun,status:"idle",winnerId:undefined},validationRun:{...p.validationRun,status:"idle",candidateId:undefined,evaluation:undefined},
    artifactAcceptance:{...p.artifactAcceptance,status:"idle",hardGatePass:false,candidateId:undefined},
    campaign:{...p.campaign,status:"idle",currentRound:0,startedAt:undefined,completedAt:undefined,stopReason:undefined,checkpoint:undefined,
      scoringInputFingerprint:undefined,scoringRouteFingerprint:undefined,serverRecoveryWait:undefined,
      serverControlOwner:{schemaVersion:"server-workflow-control-owner-v1",controlJobId:input.controlJobId,operationKey:input.controlOwnerKey,
        sourceUpdatedAt:at,inputFingerprint:"a".repeat(64),requestedAt:at,phase:"bound",runId:"fresh-run"}}};
  events=new Map();order=[];m.get.mockImplementation(async()=>structuredClone(stored));m.envelope.mockImplementation(async()=>missionEnvelope(stored,6));m.job.mockResolvedValue(job);m.route.mockResolvedValue(route);
  m.save.mockImplementation(async(p:EvolveProject)=>{order.push("save:"+p.campaign.status);stored=structuredClone(p);});
  m.append.mockImplementation(async(e:EvolutionEvent)=>events.set(e.id,structuredClone(e)));m.event.mockImplementation(async(id:string)=>events.get(id));
  ports={readMission:async()=>structuredClone(stored),readJob:async()=>job,readRun:async()=>({exists:true,status:"running"}),readRoute:async()=>route};
  m.baseline.mockImplementation(async(p:EvolveProject)=>{
    order.push("baseline");
    const allocated={...p,stage:"baseline" as const,updatedAt:at,baselineRun:{...p.baselineRun,id:"baseline-server-"+Date.parse(at),status:"running" as const,startedAt:at,completedAt:undefined,totalCases:p.evalSuite.length,runs:[],result:undefined,measurementFingerprint:serverBaselineFingerprint(p,route)}};
    await prepareServerHtmlProtectionNormalBaselineView({inputProject:p,allocatedProject:allocated},ports);
    expect(p.campaign.status).toBe("running");expect(stored.campaign.status).toBe("running");
    return {project:{...p,campaign:{...p.campaign,status:"paused" as const}},baseline:p.baselineRun,ready:false,reason:"[server-campaign-baseline-judge-pending] Synthetic stop after owner check",capabilityGaps:["synthetic-only"]};
  });
});
afterEach(()=>vi.useRealTimers());
function plan(){const p=buildServerHarnessPlan(stored);expect(p.decision.action).toBe("run-campaign");return p;}
describe("first normal Campaign Baseline owner startup",()=>{
  it("persists the authorized running Campaign before real owner/allocation checks",async()=>{
    const before=structuredClone(stored);await executeServerControlStep(input,plan(),0);
    expect(order.slice(0,2)).toEqual(["save:running","baseline"]);expect(m.baseline).toHaveBeenCalledOnce();
    const measured=m.baseline.mock.calls[0]![0] as EvolveProject;
    expect(measured.campaign.startedAt).toBe(at);expect(measured.campaign.serverControlOwner).toEqual(before.campaign.serverControlOwner);
    expect(measured.baselineRun).toEqual(before.baselineRun);expect(measured.sourceArtifacts).toEqual(before.sourceArtifacts);
    expect(measured.acceptanceRubric).toEqual(before.acceptanceRubric);expect(measured.candidates).toEqual([]);
    expect(stored.artifactAcceptance.status).toBe("idle");
  });
  it("does not execute Baseline when the running transition cannot persist",async()=>{
    m.save.mockRejectedValue(new Error("synthetic CAS conflict"));
    await expect(executeServerControlStep(input,plan(),0)).rejects.toThrow("synthetic CAS conflict");expect(m.baseline).not.toHaveBeenCalled();expect(stored.campaign.status).toBe("idle");
  });
  it("rechecks actual owner after the selected route await",async()=>{
    m.route.mockImplementation(async()=>{stored.campaign.serverControlOwner!.controlJobId="replacement-control";return route;});
    await expect(executeServerControlStep(input,plan(),0)).rejects.toThrow();expect(m.save).not.toHaveBeenCalled();expect(m.baseline).not.toHaveBeenCalled();
  });
  it("retains the strict rejection of an idle collection owner",async()=>{
    await expect(readServerHtmlProtectionCollectionOwner(stored,ports)).rejects.toThrow("html-protection-active-owner-unavailable");
  });
  it.each(["paused","stopped","completed"] as const)("does not activate a %s Campaign from a stale plan",async status=>{
    const earlier=plan();stored.campaign.status=status;
    await expect(executeServerControlStep(input,earlier,0)).rejects.toThrow("html-protection-active-owner-unavailable");
    expect(m.save).not.toHaveBeenCalled();expect(stored.campaign.status).toBe(status);
  });
  it("does not reset old idle Baseline observations to mint a fresh start",async()=>{
    stored.baselineRun.runs=[{testCaseId:"historical",output:"retained",latencyMs:1,cost:0,verificationStatus:"verified",trace:[]}];
    await expect(executeServerControlStep(input,plan(),0)).rejects.toThrow("html-protection-active-owner-unavailable");
    expect(m.save).not.toHaveBeenCalled();expect(stored.baselineRun.runs[0]!.output).toBe("retained");
  });
  it("does not add a startup write for an already running Campaign",async()=>{
    stored.campaign.status="running";stored.campaign.startedAt=at;await executeServerControlStep(input,plan(),0);
    expect(order[0]).toBe("baseline");expect(m.save).toHaveBeenCalledOnce();
  });
});

function admittedRecovery(){
  const measuredAt=new Date(Date.parse(at)-60_000).toISOString();
  stored={...stored,stage:"diagnosis",baselineRun:{...stored.baselineRun,id:"retained-real-baseline",status:"completed",
    startedAt:measuredAt,completedAt:measuredAt,measurementFingerprint:"retained-route-not-cacheable",runs:[{testCaseId:"V1",output:"Synthetic retained deficit",latencyMs:1,cost:0,verificationStatus:"verified",trace:[]}],
    result:EvaluationResultSchema.parse({accuracy:81,evidence:86,riskCoverage:78,safety:"PASS",completeness:82,averageCost:0,averageLatencyMs:1,rubricScore:81,verifiedRubricCoverage:90})},
    campaign:{...stored.campaign,status:"paused",startedAt:measuredAt,stopReason:"Synthetic provider timeout",checkpoint:{round:1,completedPhase:"diagnose",at:measuredAt}},
    attentionRequests:[AttentionRequestSchema.parse({id:"server-ai-capability-server-checkpoint-recovery",type:"capability",status:"pending",title:"Synthetic provider",reason:"Synthetic provider timeout",stage:"diagnosis",blocking:true,createdAt:at})]};
  stored=checkpointServerMainFlowWait(stored,"prior-control");
  expect(stored.campaign.serverRecoveryWait?.status).toBe("waiting");
  stored=recoverServerMainFlowWait(stored,at,input.controlJobId);
  expect(serverMainFlowRecoveryActive(stored)).toBe(true);
  expect(hasServerMainFlowRecoveryBinding(stored)).toBe(true);
}
describe("admitted recovering Campaign owner startup",()=>{
  it("persists running before refreshing a bound recovery Baseline and preserves prior evidence and start time",async()=>{
    admittedRecovery();const before=structuredClone(stored);
    await executeServerControlStep(input,plan(),0);
    expect(order.slice(0,2)).toEqual(["save:running","baseline"]);
    const measured=m.baseline.mock.calls[0]![0] as EvolveProject;
    expect(measured.campaign.startedAt).toBe(before.campaign.startedAt);
    expect(measured.campaign.serverRecoveryWait).toEqual(before.campaign.serverRecoveryWait);
    expect(measured.campaign.serverControlOwner).toEqual(before.campaign.serverControlOwner);
    expect(measured.campaign.checkpoint).toEqual(before.campaign.checkpoint);
    expect(measured.baselineRun).toEqual(before.baselineRun);
    expect(measured.diagnosis).toEqual(before.diagnosis);
    expect(measured.sourceArtifacts).toEqual(before.sourceArtifacts);
  });
  it("does not collect when the recovery start write fails",async()=>{
    admittedRecovery();m.save.mockRejectedValue(new Error("synthetic recovery CAS conflict"));
    await expect(executeServerControlStep(input,plan(),0)).rejects.toThrow("synthetic recovery CAS conflict");
    expect(m.baseline).not.toHaveBeenCalled();expect(stored.campaign.status).toBe("idle");
  });
  it.each(["digest","owner"] as const)("rejects changed %s after the route await before activating the recovery",async kind=>{
    admittedRecovery();m.route.mockImplementation(async()=>{
      if(kind==="digest")stored.campaign.serverRecoveryWait!.inputFingerprint="changed";
      else stored.campaign.serverControlOwner!.controlJobId="replacement-control";
      return route;
    });
    await expect(executeServerControlStep(input,plan(),0)).rejects.toThrow();
    expect(m.save).not.toHaveBeenCalled();expect(m.baseline).not.toHaveBeenCalled();
  });
  it.each(["digest","generation","attention"] as const)("rejects an unadmitted %s recovery without activating idle history",async kind=>{
    admittedRecovery();
    if(kind==="digest")stored.campaign.serverRecoveryWait!.inputFingerprint="changed";
    if(kind==="generation")stored.campaign.serverRecoveryWait!.resumedByControlJobId="other-control";
    if(kind==="attention")stored.attentionRequests![0]!.status="pending";
    await expect(executeServerControlStep(input,plan(),0)).rejects.toThrow();
    expect(m.save).not.toHaveBeenCalled();expect(m.baseline).not.toHaveBeenCalled();
  });
});