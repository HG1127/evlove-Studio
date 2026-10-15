// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { EvolveProjectSchema, type Candidate, type EvaluateAiResult, type EvolveProject, type TargetRunResult } from "@evolution/contracts";
import { LIVE_TARGET_OBSERVATION_MAX_AGE_MS } from "@evolution/core";
import { experimentRecoveryAt as at, experimentRecoveryFixture } from "@evolution/testkit";
import { runServerExperiment, type ServerExperimentContinuation } from "./server-experiment";

function setup(count = 1) {
  const x = experimentRecoveryFixture(2), project = x.project, frozen = structuredClone(x.current);
  project.candidates = Array.from({length:count}, (_, i) => ({...structuredClone(project.candidates[0]!), id:"C"+(i+1)}));
  project.selectedCandidateIds = project.candidates.map(c => c.id);
  const test = project.evalSuite[0]!;
  const ports = {
    fingerprint: async (wire: string) => createHash("sha256").update(wire).digest("hex"),
    scoringRouteFingerprint: "route-v1", executionRuntimeFingerprint: "runtime-v1",
    readExecutionArtifactFingerprint: vi.fn(async (): Promise<string | undefined> => "a".repeat(64)),
    verifyFrozenArtifact: vi.fn(async () => true),
    buildCandidate: vi.fn(async ({candidate}: {candidate:Candidate}) => ({...candidate, artifactBuildStatus:"ready" as const,
      artifactSnapshots:frozen.artifactSnapshots.map(s => ({...structuredClone(s),id:"snap-"+candidate.id}))})),
    executeSemanticBatch: vi.fn(async () => ({results:[]})),
    executeExternalBatch: vi.fn(async ():Promise<TargetRunResult[]> => [{testCaseId:test.id,output:"observed improved exact file",artifactHash:frozen.artifactSnapshots[0]!.frozenArtifact!.sha256,
      latencyMs:1,cost:0,verificationStatus:"verified" as "verified"|"unverified",trace:[]}]),
    judge: vi.fn(async (): Promise<EvaluateAiResult> => ({accuracy:92,evidence:92,riskCoverage:92,completeness:92,safety:"PASS",notes:[],failures:[],
      cases:[{testCaseId:test.id,accuracy:92,evidence:92,completeness:92,reason:"improved"}],
      criteria:[{criterionId:"CONTENT",score:92,pass:true,evidence:["observed improved exact file"],gaps:[],testCaseIds:[test.id]}]})),
  };
  let time=Date.parse(at);
  const now=()=>new Date(time).toISOString();
  const next=(p:EvolveProject,continuation?:ServerExperimentContinuation)=>runServerExperiment(p,ports,{yieldAfterOperation:true,continuation,now});
  return {project,ports,next,now,advance:(ms:number)=>{time+=ms;}};
}

describe("private durable Experiment operation boundaries", () => {
  it("persists all five builds, executions and independent judgments in fifteen bounded operations", async () => {
    const x=setup(5), snapshots=new Map<string,string>();
    let project=x.project, continuation:ServerExperimentContinuation|undefined;
    for(let i=0;i<15;i++) {
      const before=[x.ports.buildCandidate.mock.calls.length,x.ports.executeExternalBatch.mock.calls.length,x.ports.judge.mock.calls.length];
      const outcome=await x.next(project,continuation);
      const after=[x.ports.buildCandidate.mock.calls.length,x.ports.executeExternalBatch.mock.calls.length,x.ports.judge.mock.calls.length];
      expect(after.map((n,j)=>n-before[j]!).reduce((a,b)=>a+b,0)).toBe(1);
      expect(outcome.project.selectedCandidateIds).toEqual(x.project.selectedCandidateIds);
      project=EvolveProjectSchema.parse(JSON.parse(JSON.stringify(outcome.project)));
      for(const c of project.candidates.filter(c=>c.artifactSnapshots.length)) {
        const wire=JSON.stringify(c.artifactSnapshots);
        if(snapshots.has(c.id))expect(wire).toBe(snapshots.get(c.id));else snapshots.set(c.id,wire);
      }
      continuation=outcome.continuation;
      if(i<14) {
        expect(outcome.experiment.status).toBe("running");expect(outcome.readyForHoldout).toBe(false);
        expect(project.campaign.checkpoint?.completedPhase).toBe("plan");expect(outcome.experiment.winnerId).toBeUndefined();
        expect(continuation).toBeDefined();
      } else {
        expect(outcome.experiment.status).toBe("completed");expect(outcome.readyForHoldout).toBe(true);
        expect(outcome.experiment.candidateResults.map(r=>r.candidateId)).toEqual(project.selectedCandidateIds);
        expect(project.campaign.checkpoint?.completedPhase).toBe("experiment");expect(continuation).toBeUndefined();
      }
    }
    expect(x.ports.buildCandidate).toHaveBeenCalledTimes(5);expect(x.ports.judge).toHaveBeenCalledTimes(5);
  });
  it("has the same final assessment and selection as the synchronous compatibility path",async()=>{
    const x=setup(2), y=setup(2);
    const full=await runServerExperiment(x.project,x.ports,{now:x.now});
    let output=await y.next(y.project);
    for(let i=0;output.continuation&&i<8;i++)output=await y.next(EvolveProjectSchema.parse(output.project),output.continuation);
    expect(output.experiment).toEqual(full.experiment);expect(output.project.candidates).toEqual(full.project.candidates);
  });
  it("refuses a stored running record without private SDK authority and does not regenerate files",async()=>{
    const x=setup(), first=await x.next(x.project);x.ports.buildCandidate.mockClear();
    await expect(x.next(first.project)).rejects.toThrow("private SDK continuation");
    expect(x.ports.buildCandidate).not.toHaveBeenCalled();
  });
  it.each(["goal","source","selection","snapshot","paper","baseline","hidden","owner","route","runtime"])("rejects changed %s before another external operation",async(change)=>{
    const x=setup(2), first=await x.next(x.project), p=structuredClone(first.project);
    if(change==="goal")p.goal+="changed";
    if(change==="source")p.sourceArtifacts[0]!.textContent+="changed";
    if(change==="selection")p.selectedCandidateIds.reverse();
    if(change==="snapshot")p.candidates[0]!.artifactSnapshots[0]!.content+="changed";
    if(change==="paper")p.evalSuite[0]!.input+="changed";
    if(change==="baseline")p.baselineRun.runs[0]!.output+="changed";
    if(change==="hidden")p.hiddenEvalSuite=[];
    if(change==="owner")p.campaign.serverControlOwner={schemaVersion:"server-workflow-control-owner-v1",phase:"reserved",controlJobId:"other",operationKey:"other",sourceUpdatedAt:at,inputFingerprint:"a".repeat(64),requestedAt:at};
    if(change==="route")x.ports.scoringRouteFingerprint="other";
    if(change==="runtime")x.ports.executionRuntimeFingerprint="other";
    x.ports.buildCandidate.mockClear();
    await expect(x.next(p,first.continuation)).rejects.toThrow();
    expect(x.ports.buildCandidate).not.toHaveBeenCalled();expect(x.ports.executeExternalBatch).not.toHaveBeenCalled();expect(x.ports.judge).not.toHaveBeenCalled();
  });
  it("checks physical frozen bytes again before every following operation",async()=>{
    const x=setup(2), first=await x.next(x.project);x.ports.buildCandidate.mockClear();x.ports.verifyFrozenArtifact.mockResolvedValue(false);
    await expect(x.next(first.project,first.continuation)).rejects.toThrow("frozen bytes");expect(x.ports.buildCandidate).not.toHaveBeenCalled();
  });
  it("remeasures expired same-Run observations without changing the frozen construction",async()=>{
    const x=setup(), built=await x.next(x.project), observed=await x.next(built.project,built.continuation);
    x.advance(LIVE_TARGET_OBSERVATION_MAX_AGE_MS);
    const refreshed=await x.next(observed.project,observed.continuation);
    expect(refreshed.experiment.status).toBe("running");expect(x.ports.executeExternalBatch).toHaveBeenCalledTimes(2);expect(x.ports.judge).not.toHaveBeenCalled();
    expect(refreshed.project.candidates[0]!.artifactSnapshots).toEqual(built.project.candidates[0]!.artifactSnapshots);
    const final=await x.next(refreshed.project,refreshed.continuation);expect(final.experiment.status).toBe("completed");expect(x.ports.buildCandidate).toHaveBeenCalledTimes(1);
  });
  it("preserves an honest UNVERIFIED answer sheet across the private boundary without granting a verified Winner",async()=>{
    const x=setup();x.ports.executeExternalBatch.mockImplementation(async()=>[{testCaseId:x.project.evalSuite[0]!.id,output:"UNVERIFIED: runtime unavailable",latencyMs:1,cost:0,verificationStatus:"unverified",trace:[]}]);
    const built=await x.next(x.project), executed=await x.next(built.project,built.continuation), final=await x.next(executed.project,executed.continuation);
    expect(x.ports.executeExternalBatch).toHaveBeenCalledTimes(1);expect(x.ports.judge).not.toHaveBeenCalled();
    expect(final.winnerId).toBeUndefined();expect(final.experiment.candidateResults[0]!.runs[0]!.verificationStatus).toBe("unverified");
  });
  it("keeps failed build attempts while completing other selected Candidates",async()=>{
    const x=setup(2);x.ports.buildCandidate.mockRejectedValueOnce(new Error("renderer unavailable"));
    let out=await x.next(x.project);for(let i=0;out.continuation&&i<8;i++)out=await x.next(out.project,out.continuation);
    expect(out.experiment.buildFailures).toEqual([{candidateId:"C1",message:"renderer unavailable"}]);
    expect(out.project.candidates[0]!.status).toBe("failed");expect(out.experiment.candidateResults.map(r=>r.candidateId)).toEqual(["C2"]);
  });
  it("restores every later frozen Candidate during a failed-Judge retry without rebuilding them",async()=>{
    const x=setup(2);x.ports.judge.mockRejectedValueOnce(new Error("independent Judge unavailable"));
    const failed=await runServerExperiment(x.project,x.ports,{now:x.now});
    expect(failed.control).toBe("stop");expect(x.ports.buildCandidate).toHaveBeenCalledTimes(2);
    const snapshots=failed.project.candidates.map(c=>c.artifactSnapshots);
    let out=await x.next(failed.project);for(let i=0;out.continuation&&i<8;i++)out=await x.next(EvolveProjectSchema.parse(out.project),out.continuation);
    expect(out.experiment.status).toBe("completed");expect(x.ports.buildCandidate).toHaveBeenCalledTimes(2);
    expect(out.project.candidates.map(c=>c.artifactSnapshots)).toEqual(snapshots);expect(x.ports.executeExternalBatch).toHaveBeenCalledTimes(2);
  });
  it("detects a generation change during awaited frozen verification before building another Candidate",async()=>{
    const x=setup(2), first=await x.next(x.project);x.ports.buildCandidate.mockClear();
    x.ports.verifyFrozenArtifact.mockImplementationOnce(async()=>{first.project.goal+="changed while awaiting";return true;});
    await expect(x.next(first.project,first.continuation)).rejects.toThrow("generation changed during");expect(x.ports.buildCandidate).not.toHaveBeenCalled();
  });
  it("retains a failed frozen identity while continuing later selected Candidates",async()=>{
    const x=setup(2);x.ports.judge.mockRejectedValueOnce(new Error("independent Judge unavailable"));
    const failed=await runServerExperiment(x.project,x.ports,{now:x.now});const firstSnapshot=structuredClone(failed.project.candidates[0]!.artifactSnapshots);
    x.ports.verifyFrozenArtifact.mockResolvedValueOnce(false);
    let out=await x.next(failed.project);for(let i=0;out.continuation&&i<8;i++)out=await x.next(out.project,out.continuation);
    expect(out.experiment.buildFailures?.[0]?.candidateId).toBe("C1");
    expect(out.project.candidates[0]!.artifactSnapshots).toEqual(firstSnapshot);expect(out.project.candidates[0]!.artifactBuildStatus).toBe("ready");
    expect(x.ports.buildCandidate).toHaveBeenCalledTimes(2);expect(out.experiment.candidateResults.map(r=>r.candidateId)).toEqual(["C2"]);
  });
  it("validates cryptographic prerequisites before creating any file",async()=>{
    const x=setup();x.ports.fingerprint=async()=>"invalid";
    await expect(x.next(x.project)).rejects.toThrow("cryptographic");expect(x.ports.buildCandidate).not.toHaveBeenCalled();
  });
});
