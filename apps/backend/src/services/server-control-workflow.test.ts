// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcceptanceCriterionSchema, SourceArtifactSchema, EvolutionJobSchema, type EvolveProject } from "@evolution/contracts";
import { buildServerHarnessPlan, serverControlCapabilityWaitPlan, type ServerHarnessPlan } from "@evolution/harness";
import {demoProject} from "../../../../src/features/evolve/data/mock-project";
import { executeServerControlStep, planMissionStep } from "../../../../workflows/evolution-mission/steps";

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), jobGet: vi.fn(), put: vi.fn(), append: vi.fn(), probe: vi.fn(), passive: vi.fn(), ai: vi.fn() }));
vi.mock("./production-runtime", () => ({ getServerProductionRuntime: () => ({
  missions: { get: mocks.get, save: mocks.save }, jobs: { get: mocks.jobGet, put: mocks.put }, events: { append: mocks.append },
}) }));
vi.mock("./server-ai-health", () => ({ probeServerAiRuntime: mocks.probe, getPassiveServerAiHealth: mocks.passive }));
vi.mock("./ai-gateway", async (original) => ({ ...await original<typeof import("./ai-gateway")>(), runServerAi: mocks.ai }));
vi.mock("../server-env", async (original) => ({ ...await original<typeof import("../server-env")>(), serverAiConfigured: () => true }));

const at = "2026-10-08T00:00:00.000Z";
const input = { missionId: "mission", controlJobId: "control", requestedAt: at };
const plan: ServerHarnessPlan = { decision: { action: "understand", stage: "target", reason: "understand" }, checkpoint: { id: "checkpoint", stage: "target", round: 1 }, policy: { mode: "auto" }, sourceRevision: "revision" };
const job = EvolutionJobSchema.parse({ schemaVersion: "job-v1", id: "control", missionId: "mission", type: "campaign", status: "running", label: "control", idempotencyKey: "workflow-control:control", generation: 1, attempts: 1, priority: 70, createdAt: at, updatedAt: at });
const mission = {
  id: "mission", stage: "diagnosis", evolutionCommand: "improve", goal: "goal", sourceArtifacts: [], inputClarifications: [], attentionRequests: [],
  campaign: { status: "running", checkpoint: { round: 1, completedPhase: "diagnose", at }, currentRound: 0 },
  candidates: [{ id: "candidate", artifactSnapshots: [{ contentHash: "unchanged" }] }],
  baselineRun: { status: "completed", id: "original-baseline" }, validationRun: { status: "idle" }, updatedAt: at,
} as unknown as EvolveProject;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(structuredClone(mission));
  mocks.jobGet.mockResolvedValue(job);
  mocks.probe.mockResolvedValue({ ready: false, status: "unavailable", reasonCode: "customer-verification-required" });
  mocks.passive.mockResolvedValue({ configured: true, ready: false, status: "not-checked" });
  mocks.ai.mockRejectedValue(Object.assign(new Error("provider health temporarily unavailable"), { status: 503 }));
});
describe("Durable Workflow AI capability wait", () => {
  it("persists a resumable wait with the actual current stage and unchanged evidence", async () => {
    const outcome = await executeServerControlStep(input, plan, 2);
    expect(outcome).toMatchObject({ control: "stop", result: { status: "waiting-human", iterations: 3, checkpointId: "checkpoint" } });
    const saved = mocks.save.mock.calls[0][0];
    expect(saved.stage).toBe("diagnosis");
    expect(saved.candidates).toEqual(mission.candidates);
    expect(saved.baselineRun).toEqual(mission.baselineRun);
    expect(saved.validationRun).toEqual(mission.validationRun);
    expect(saved.campaign).toMatchObject({ status: "paused", checkpoint: mission.campaign.checkpoint });
    expect(saved.attentionRequests[0]).toMatchObject({ type: "capability", status: "pending" });
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ status: "waiting", generation: 1, checkpointId: "checkpoint" }));
    expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({ type: "AttentionRequired", checkpointId: "checkpoint" }));
    // A real task, not an unrelated expensive health probe, establishes availability.
    expect(mocks.ai).toHaveBeenCalledOnce();
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "completed", "failed", "partial"])("does not reopen a %s control Job", async (status) => {
    mocks.jobGet.mockResolvedValue({ ...job, status });
    expect(await executeServerControlStep(input, plan, 0)).toMatchObject({ control: "stop", result: { status: "blocked" } });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it.each([undefined, { ...job, generation: 2 }, { ...job, missionId: "another" }])("does not overwrite a missing or replaced control Job", async (current) => {
    mocks.jobGet.mockResolvedValue(current);
    expect(await executeServerControlStep(input, plan, 0)).toMatchObject({ result: { status: "blocked" } });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("does not misclassify a database 403 as an AI outage", async () => {
    const error = Object.assign(new Error("database denied"), { status: 403 });
    mocks.get.mockRejectedValue(error);
    await expect(executeServerControlStep(input, plan, 0)).rejects.toBe(error);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("persists capability waiting when availability changes after the healthy probe", async () => {
    mocks.probe.mockResolvedValue({ ready: true, status: "ready" });
    mocks.ai.mockRejectedValue(Object.assign(new Error("private provider response"), { status: 429 }));
    expect(await executeServerControlStep(input, plan, 0)).toMatchObject({ result: { status: "waiting-human" } });
    expect(mocks.save.mock.calls[0][0].campaign.status).toBe("paused");
    expect(JSON.stringify(mocks.save.mock.calls)).not.toContain("private provider response");
  });
  it("propagates ordinary AI failures without writing an artificial wait or result", async () => {
    mocks.probe.mockResolvedValue({ ready: true, status: "ready" });
    const error = new Error("invalid structured result");
    mocks.ai.mockRejectedValue(error);
    await expect(executeServerControlStep(input, plan, 0)).rejects.toBe(error);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("continues the action after AI recovery", async () => {
    mocks.probe.mockResolvedValue({ ready: true, status: "ready" });
    mocks.ai.mockResolvedValue({ summary: "real response", confidence: 0.8 });
    expect(await executeServerControlStep(input, plan, 0)).toEqual({ control: "continue" });
    expect(mocks.save.mock.calls[0][0].inputUnderstanding).toMatchObject({ status: "ready", summary: "real response" });
    expect(mocks.append.mock.calls[0][0].type).toBe("ActionCompleted");
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it("keeps non-AI wait actions independent of provider availability", async () => {
    await executeServerControlStep(input, { ...plan, decision: { action: "wait-human", stage: "diagnosis", reason: "approval" } }, 0);
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.ai).not.toHaveBeenCalled();
  });
});

function fullPausedMission(){
  const wait=serverControlCapabilityWaitPlan({...plan,checkpoint:{...plan.checkpoint,id:"server-checkpoint-recovery"}}, {stage:"diagnosis",reason:"provider unavailable",at});
  const base=structuredClone(demoProject);
  return {...base,id:input.missionId,stage:"diagnosis" as const,attentionRequests:[wait.decision.attention!],campaign:{...base.campaign,status:"paused" as const,stopReason:wait.decision.reason}};
}
describe("new durable run resumes the actual stored AI wait",()=>{
  it("retains a capability request rather than changing it to budget/limit while the model is down",async()=>{
    const stored=fullPausedMission();mocks.get.mockResolvedValue(stored);
    const next=await planMissionStep(input,0);
    expect(next.decision).toMatchObject({action:"wait-human",attention:{id:stored.attentionRequests[0].id,type:"capability"}});
    expect(mocks.probe).toHaveBeenCalledOnce();
    expect(mocks.probe).toHaveBeenCalledWith(undefined,{force:true});
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("resolves only the model wait after a real healthy probe, then replans the actual Mission",async()=>{
    const stored=fullPausedMission();mocks.get.mockResolvedValue(stored);
    mocks.probe.mockResolvedValue({ready:true,status:"ready"});
    const next=await planMissionStep(input,0);
    const recovered=mocks.save.mock.calls[0][0] as EvolveProject;
    expect(recovered.stage).toBe(stored.stage);
    expect(recovered.candidates).toEqual(stored.candidates);
    expect(recovered.baselineRun).toEqual(stored.baselineRun);
    expect(recovered.validationRun).toEqual(stored.validationRun);
    expect(recovered.campaign).toEqual({...stored.campaign,status:"idle",stopReason:undefined});
    expect(recovered.attentionRequests?.[0].status).toBe("resolved");
    expect(next).toEqual(buildServerHarnessPlan(recovered));
    expect(next.decision.attention?.id).not.toBe(stored.attentionRequests[0].id);
    expect(mocks.ai).not.toHaveBeenCalled();
  });
  it("does not clear an unrelated pause or spend a probe on it",async()=>{
    const stored=fullPausedMission();stored.campaign.stopReason="actual budget limit";
    mocks.get.mockResolvedValue(stored);
    await planMissionStep(input,0);
    expect(mocks.probe).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([undefined,{...job,status:"cancelled"},{...job,generation:2},{...job,missionId:"another"}])("does not recover an inactive or replaced control generation",async(current)=>{
    mocks.get.mockResolvedValue(fullPausedMission());mocks.jobGet.mockResolvedValue(current);
    await expect(planMissionStep(input,0)).rejects.toThrow("控制 Job 不再活动");
    expect(mocks.probe).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();expect(mocks.append).not.toHaveBeenCalled();
  });
  it("keeps unknown runtime errors on the retry path without clearing the pause",async()=>{
    mocks.get.mockResolvedValue(fullPausedMission());mocks.probe.mockResolvedValue({ready:false,status:"error",reasonCode:"runtime-error"});
    await expect(planMissionStep(input,0)).rejects.toThrow("健康探测未通过");
    expect(mocks.save).not.toHaveBeenCalled();expect(mocks.append).not.toHaveBeenCalled();
  });
});


describe("durable input context for a long HTML document",()=>{
  it.each(["understand","compile-contract","build-eval"] as const)("shows real body content to %s instead of only the long style header",async(action)=>{
    const stored=structuredClone(demoProject);stored.id=input.missionId;
    const quote="退款审批 REFUND_APPROVAL_CASE 必须由主管批准并保留流水编号。";
    const html="<html><head><title>操作手册</title><style>"+".presentation-style { color: red; }\n".repeat(2000)+"</style></head><body><article>"+quote+"</article>"+"<p>原始章节正文</p>".repeat(3000)+"</body></html>";
    stored.sourceArtifacts=[SourceArtifactSchema.parse({id:"source",name:"large-sop.html",role:"target",artifactKind:"document",mimeType:"text/html",extension:"html",inputMode:"upload",parseStatus:"ready",textContent:html,textExcerpt:html.slice(0,1000),size:Buffer.byteLength(html),createdAt:at})];
    stored.goal="细化退款流程";stored.evolutionCommand="让主管审批步骤更明确";
    stored.acceptanceRubric=["CONTENT","STRUCTURE","PROTECT"].map((id,index)=>AcceptanceCriterionSchema.parse({id,title:id,requirement:quote,weight:index===0?40:30,hardGate:true,evidenceExpected:[quote],artifactIds:["source"],category:index===1?"integrity":index===2?"protected":"outcome"}));
    stored.evalSuite=[];stored.hiddenEvalSuite=[];stored.baselineRun={...stored.baselineRun,status:"idle",runs:[],result:undefined};
    mocks.get.mockResolvedValue(stored);mocks.probe.mockResolvedValue({ready:true,status:"ready"});
    mocks.ai.mockImplementation(async(operation:string,payload:unknown)=>{
      const data=payload as {sourceContextInstruction?:string;artifacts?:Array<{content:string;originalChars:number;truncated:boolean}>;targetArtifacts?:Array<{content:string;originalChars:number;truncated:boolean}>;project?:{artifacts:Array<{content:string;originalChars:number;truncated:boolean}>}};
      const artifacts=data.artifacts??data.targetArtifacts??data.project?.artifacts;
      expect(data.sourceContextInstruction).toContain("not proof of complete Storage bytes or runtime behavior");
      expect(artifacts?.[0]?.content.includes(quote)).toBe(true);
      expect(artifacts?.[0]?.content.length).toBeLessThanOrEqual(20_000);
      expect(artifacts?.[0]).toMatchObject({originalChars:html.length,truncated:true});
      if(operation==="rubric")return {criteria:stored.acceptanceRubric,summary:"source-grounded rubric"};
      if(operation==="eval-suite")return {validationCases:[],hiddenCases:[],summary:"source-grounded tests"};
      return {summary:"source-grounded understanding",confidence:0.9};
    });
    const result=await executeServerControlStep(input,{...plan,decision:{...plan.decision,action}},0);
    expect(result.control).toBe("continue");expect(mocks.ai).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][0].sourceArtifacts[0].textContent).toBe(html);
  });
});
