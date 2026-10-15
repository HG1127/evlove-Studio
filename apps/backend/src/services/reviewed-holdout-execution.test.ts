// @vitest-environment node
import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
import {reviewedHoldoutFixture} from "@evolution/testkit";
import {EvolutionJobSchema,ReviewedHoldoutRunInputSchema,type EvolveProject,type EvolutionJob} from "@evolution/contracts";
import {executeReviewedHoldout,acceptReviewedHoldout} from "./reviewed-holdout-execution";
import {reviewedBinding,reviewedSha} from "./reviewed-holdout-identity";
import {serverMainFlowRecoveryDigest} from "./server-main-flow-recovery";
const m=vi.hoisted(()=>({runtime:vi.fn(),read:vi.fn(),owner:vi.fn(),physical:vi.fn(),route:vi.fn(),holdout:vi.fn(),accept:vi.fn(),event:vi.fn()}));
vi.mock("./workflow-control-runtime",()=>({getServerWorkflowControlRuntime:m.runtime,requireServerWorkflowControlOwner:m.owner}));
vi.mock("./production-runtime",()=>({getServerMissionEnvelope:m.read}));
vi.mock("./server-holdout-artifact-binding",()=>({readServerHoldoutArtifactFingerprint:m.physical}));
vi.mock("./ai-gateway",()=>({serverAiScoringRouteFingerprint:m.route}));
vi.mock("./server-holdout",()=>({runServerMissionHoldout:m.holdout}));
vi.mock("./server-artifact-acceptance",()=>({runServerMissionArtifactAcceptance:m.accept}));
vi.mock("./workflow-control-events",()=>({appendWorkflowControlEvent:m.event}));
let current:EvolveProject,input:ReturnType<typeof ReviewedHoldoutRunInputSchema.parse>,job:EvolutionJob,save:ReturnType<typeof vi.fn>;
const physical="a".repeat(64);
beforeEach(()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime("2026-10-15T08:00:00.000Z");vi.resetAllMocks();
  current=reviewedHoldoutFixture().project;
  const binding=reviewedBinding(current,physical,"b".repeat(64),"route");
  input=ReviewedHoldoutRunInputSchema.parse({missionId:current.id,controlJobId:"job",controlOwnerKey:"key",requestedAt:current.updatedAt,
    approval:{schemaVersion:"reviewed-holdout-approval-v1",request:{binding,idempotencyKey:"key",humanReviewNote:"Human checked this exact REVIEW",preserveReview:true,preserveAcceptanceGates:true},actorId:"operator",actorSource:"browser-session",confirmedAt:current.updatedAt}});
  current.campaign.serverControlOwner={schemaVersion:"server-workflow-control-owner-v1",controlJobId:"job",operationKey:"key",requestedAt:current.updatedAt,sourceUpdatedAt:current.updatedAt,inputFingerprint:binding.inputSha256,phase:"bound",runId:"run"};
  expect(serverMainFlowRecoveryDigest(current)).toBe(binding.inputSha256);
  job=EvolutionJobSchema.parse({schemaVersion:"job-v1",id:"job",type:"campaign",status:"running",label:"reviewed",idempotencyKey:"key",generation:1,createdAt:current.updatedAt,updatedAt:current.updatedAt,metadata:{workflowIntent:"reviewed-holdout",reviewedApproval:input.approval}});
  save=vi.fn(async(p:EvolveProject)=>{current=structuredClone(p);});
  m.runtime.mockReturnValue({missions:{get:async()=>structuredClone(current),save},jobs:{get:async()=>job},events:{append:vi.fn()}});
  m.read.mockImplementation(async()=>({payload:structuredClone(current)}));m.physical.mockResolvedValue(physical);m.route.mockResolvedValue("route");
  m.holdout.mockImplementation(async(p:EvolveProject)=>{
    const evaluation={...p.experimentRun.candidateResults[0]!.evaluation,safety:"PASS" as const};
    const validation={...p.validationRun,id:"validation-server-r1",status:"completed" as const,baselineObservedAt:Date.now(),
      candidateId:p.experimentRun.winnerId,evaluation,baselineEvaluation:evaluation,recommendation:"release" as const};
    return {control:"continue",readyForArtifactAcceptance:true,evidenceIncomplete:false,reason:"fresh pair",validation,
      project:{...p,validationRun:validation,stage:"validation",campaign:{...p.campaign,checkpoint:{...p.campaign.checkpoint!,completedPhase:"validation"}}}};
  });
  m.accept.mockImplementation(async(p:EvolveProject)=>({accepted:true,project:{...p,artifactAcceptance:{...p.artifactAcceptance,status:"passed",candidateId:p.experimentRun.winnerId}},reason:"Gate F exact accepted"}));
});
afterEach(()=>vi.useRealTimers());
describe("private reviewed Holdout execution",()=>{
  it("runs a fresh same-paper pair without reusing old raw evidence; retains Original REVIEW and archives actual output",async()=>{
    const original=structuredClone(current.baselineRun),prior=structuredClone(current.validationRun);
    const out=await executeReviewedHoldout(input);
    expect(out.continuation).toBeDefined();expect(current.baselineRun).toEqual(original);
    expect(m.holdout).toHaveBeenCalledOnce();
    const working=m.holdout.mock.calls[0]![0] as EvolveProject;
    expect(working.hiddenEvalSuite).toEqual(current.hiddenEvalSuite);
    expect(working.validationRun.runs).toEqual([]);expect(working.validationRun.baselineRuns).toEqual([]);
    expect(prior.runs.length).toBeGreaterThan(0);
    expect(m.event.mock.calls[0]![1].payload.validation).toEqual(current.validationRun);
    expect(m.accept).not.toHaveBeenCalled();
  });
  it("calls unchanged Gate F with repairs disabled only from this Run's fresh output",async()=>{
    const out=await executeReviewedHoldout(input);
    const accepted=await acceptReviewedHoldout(input,out.continuation!);
    expect(m.accept).toHaveBeenCalledExactlyOnceWith(expect.any(Object),{repair:false});
    expect(current.baselineRun.result!.safety).toBe("REVIEW");expect(current.artifactAcceptance.status).toBe("passed");
    expect(current.campaign.status).toBe("paused");expect(accepted.status).toBe("waiting-action");
    expect(accepted.reason).toContain("等待下载");expect(accepted.reason).not.toContain("完整验收已完成");
  });
  it.each(["REVIEW","FAIL"])("retains a new valid %s and stops without Gate F or retry",async safety=>{
    const original=m.holdout.getMockImplementation()!;
    m.holdout.mockImplementation(async(p:EvolveProject)=>{const out=await original(p);out.validation.evaluation.safety=safety;return out;});
    const out=await executeReviewedHoldout(input);
    expect(out.continuation).toBeUndefined();expect(current.validationRun.evaluation!.safety).toBe(safety);
    expect(current.baselineRun.result!.safety).toBe("REVIEW");expect(current.campaign.status).toBe("paused");
    expect(m.holdout).toHaveBeenCalledOnce();expect(m.accept).not.toHaveBeenCalled();
  });
  it("blocks Gate F when the Current arm returns REVIEW",async()=>{
    const original=m.holdout.getMockImplementation()!;
    m.holdout.mockImplementation(async(p:EvolveProject)=>{const out=await original(p);out.validation.baselineEvaluation={...out.validation.baselineEvaluation,safety:"REVIEW"};return out;});
    expect((await executeReviewedHoldout(input)).continuation).toBeUndefined();expect(m.accept).not.toHaveBeenCalled();
  });
  it("does not grant Gate F on incomplete/failed Hidden quality even with Safety PASS",async()=>{
    const original=m.holdout.getMockImplementation()!;
    m.holdout.mockImplementation(async(p:EvolveProject)=>({...await original(p),control:"stop",readyForArtifactAcceptance:false,reason:"92-point hard gate missing"}));
    const out=await executeReviewedHoldout(input);expect(out.continuation).toBeUndefined();expect(current.campaign.stopReason).toContain("92-point");
  });
  it.each(["approval","baseline","snapshot","paper","input","physical","route","owner"])("rejects %s drift before execution",async kind=>{
    if(kind==="approval")job.metadata={};
    if(kind==="baseline")current.baselineRun.result!.notes.push("changed");
    if(kind==="snapshot")current.candidates[0]!.artifactSnapshots[0]!.name="changed";
    if(kind==="paper")current.hiddenEvalSuite[0]!.input="changed";
    if(kind==="input")current.goal="changed";
    if(kind==="physical")m.physical.mockResolvedValue("c".repeat(64));
    if(kind==="route")m.route.mockResolvedValue("different");
    if(kind==="owner")m.owner.mockRejectedValue(new Error("cancelled"));
    await expect(executeReviewedHoldout(input)).rejects.toThrow();expect(m.holdout).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
  });
  it("retains actual result audit but refuses stale writes after concurrent Mission mutation",async()=>{
    const original=m.holdout.getMockImplementation()!;
    m.holdout.mockImplementation(async(p:EvolveProject)=>{const out=await original(p);current.goal="changed while AI ran";return out;});
    await expect(executeReviewedHoldout(input)).rejects.toThrow("Mission");
    expect(m.event).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled();
  });
  it("rejects mutation of contract in a phase result",async()=>{
    const original=m.holdout.getMockImplementation()!;
    m.holdout.mockImplementation(async(p:EvolveProject)=>{const out=await original(p);out.project.acceptanceRubric=[{...out.project.acceptanceRubric[0]!,minScore:91}];return out;});
    await expect(executeReviewedHoldout(input)).rejects.toThrow("授权范围");expect(save).not.toHaveBeenCalled();
  });
  it.each(["generation","run","expiry","future","route","physical"])("does not restore Gate F authority after %s drift",async kind=>{
    const out=await executeReviewedHoldout(input),context=out.continuation!;
    if(kind==="generation")current.goal="changed";
    if(kind==="run")context.runId="other";
    if(kind==="expiry")context.observedAt-=3_600_000;
    if(kind==="future")context.observedAt+=1;
    if(kind==="route")m.route.mockResolvedValue("changed");
    if(kind==="physical")m.physical.mockResolvedValue(undefined);
    await expect(acceptReviewedHoldout(input,context)).rejects.toThrow();expect(m.accept).not.toHaveBeenCalled();
  });
  it("rechecks evidence TTL after storage awaits before Gate F",async()=>{
    const out=await executeReviewedHoldout(input);
    m.physical.mockImplementation(async()=>{vi.setSystemTime(Date.now()+3_600_000);return physical;});
    await expect(acceptReviewedHoldout(input,out.continuation!)).rejects.toThrow("已过期");expect(m.accept).not.toHaveBeenCalled();
  });
  it("does not save acceptance if evidence expires during Gate F awaits",async()=>{
    const out=await executeReviewedHoldout(input),original=m.accept.getMockImplementation()!;
    m.accept.mockImplementation(async(p:EvolveProject)=>{const accepted=await original(p);vi.setSystemTime(Date.now()+3_600_000);return accepted;});
    await expect(acceptReviewedHoldout(input,out.continuation!)).rejects.toThrow("已过期");expect(current.artifactAcceptance.status).toBe("idle");
  });
  it("preserves failed Gate F and cannot generate another Candidate",async()=>{
    const out=await executeReviewedHoldout(input),before=reviewedSha(current.candidates);
    m.accept.mockImplementation(async(p:EvolveProject)=>({accepted:false,project:{...p,artifactAcceptance:{...p.artifactAcceptance,status:"failed"}},reason:"92-point requirement failed"}));
    const decision=await acceptReviewedHoldout(input,out.continuation!);
    expect(current.artifactAcceptance.status).toBe("failed");expect(reviewedSha(current.candidates)).toBe(before);expect(decision.status).toBe("waiting-human");
  });
});
