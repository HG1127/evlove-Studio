// @vitest-environment node
import {describe,expect,it,vi} from "vitest";
import {PairedEvaluationAiResultSchema,type PairedEvaluationAiResult} from "@evolution/contracts";
import {candidateWinnerDecision,candidateEvidencePendingDecision,userGoalProgress,validationDecision,finalHoldoutContractFingerprint,experimentEvaluationScore} from "@evolution/core";
import {serverPairedJudgeRequest,settleServerPairedJudgment,runServerExperiment,runServerHoldout} from "@evolution/harness";
import {pairedJudgeFixture,pairedJudgeRawEvaluation,acceptedPackageFixture} from "@evolution/testkit";
import {runServerPairedEvidenceJudge} from "./server-paired-evidence-judge";

type ModelInput={requestFingerprint:string;versions:Array<{slot:string;observations:{runs:Array<{outputChunks:string[]}>}}>};
function fixture(){const x=pairedJudgeFixture();return {...x,request:serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible")};}
function model(pairs:Array<[number,number]>= [[90,97],[93,95]],change?:(reply:PairedEvaluationAiResult,index:number)=>void){
  const calls:ModelInput[]=[];
  const invoke=vi.fn(async(raw:unknown)=>{
    const input=raw as ModelInput,index=calls.length;calls.push(input);
    if(index>=pairs.length)throw Error("No unregistered retry");
    const [before,after]=pairs[index]!,original=pairedJudgeRawEvaluation(before),candidate=pairedJudgeRawEvaluation(after);
    const reply:PairedEvaluationAiResult={schemaVersion:"paired-evaluation-v1",requestFingerprint:input.requestFingerprint,versions:[{slot:"A",result:index===0?original:candidate},{slot:"B",result:index===0?candidate:original},{slot:"C",result:structuredClone(original)}]};
    change?.(reply,index);return reply;
  });
  return {calls,invoke,routeFingerprint:async()=>"fixed-model-route"};
}
async function assess(pairs?:Array<[number,number]>,change?:(reply:PairedEvaluationAiResult,index:number)=>void){
  const x=fixture(),port=model(pairs,change),raw=await runServerPairedEvidenceJudge(x.request,port);
  const evaluation=settleServerPairedJudgment(x.project,x.project.evalSuite,x.candidateRuns,x.originalRuns,x.request,raw);
  return {...x,port,raw,evaluation};
}

describe("two-order paired comparison",()=>{
  it("swaps version slots, keeps one rubric and selects the less favorable observed pair",async()=>{
    const x=await assess();
    expect(x.port.calls).toHaveLength(2);
    expect(x.port.calls[0]!.versions[0]!.observations.runs[0]!.outputChunks.join()).toContain("Original measured body");
    expect(x.port.calls[1]!.versions[0]!.observations.runs[0]!.outputChunks.join()).toContain("Updated measured body");
    expect(x.evaluation.criterionScores![0]!.score).toBe(95);
    expect(x.evaluation.judgeComparison!.baseline.criterionScores![0]!.score).toBe(93);
    expect(x.evaluation.judgeComparison!.receipt.samples).toHaveLength(2);
    // The old independent framing scored Original 99. The new method must use its own matched 93, not cherry-pick that old score.
    const decision=candidateWinnerDecision(x.project,x.evaluation,x.project.baselineRun.result!,x.candidate);
    expect(decision.eligible).toBe(true);expect(decision.targetDelta).toBe(2);
  });
  it("does not expose final questions, hidden questions or raw source programs to the Visible judge",async()=>{
    const x=await assess(),wire=JSON.stringify(x.port.calls);
    for(const sentinel of ["FINAL_PRIVATE","PRIVATE_HIDDEN_SENTINEL","PRIVATE_PROGRAM_SENTINEL","PRIVATE_STYLE_SENTINEL"])expect(wire).not.toContain(sentinel);
    expect(wire).not.toContain('"pairedComparison"');expect(wire).not.toContain('"candidateId"');
  });
  it("qualifies conflicting threshold decisions as unknown, not a passing or failed product",async()=>{
    const x=await assess([[80,90],[80,84]]);
    expect(x.evaluation.criterionScores![0]).toMatchObject({verificationStatus:"unverified",pass:false});
    expect(userGoalProgress(x.project,x.evaluation,x.project.baselineRun.result!).ready).toBe(false);
    expect(candidateEvidencePendingDecision(x.project,x.evaluation,x.project.baselineRun.result!).eligible).toBe(false);
    const decision=validationDecision(x.project,x.evaluation,x.evaluation.judgeComparison!.baseline,x.project.evalSuite);
    expect(decision.evidenceIncomplete).toBe(true);expect(decision.hardCriterionFailures).toEqual([]);
  });
  it("does not reroll a direction conflict into a verified regression or a Winner",async()=>{
    const x=await assess([[90,95],[95,94]]);
    expect(x.port.calls).toHaveLength(2);expect(x.evaluation.criterionScores![0]!.verificationStatus).toBe("unverified");
    expect(candidateWinnerDecision(x.project,x.evaluation,x.project.baselineRun.result!,x.candidate).eligible).toBe(false);
    expect(userGoalProgress(x.project,x.evaluation,x.project.baselineRun.result!).regressedCriterionIds).toEqual([]);
  });
  it("invalidates a criterion when its identical Original-copy control receives another score",async()=>{
    const x=await assess(undefined,reply=>{reply.versions.find(v=>v.slot==="C")!.result.criteria[0]!.score++;});
    expect(x.evaluation.criterionScores![0]).toMatchObject({verificationStatus:"unverified",pass:false});
    expect(candidateWinnerDecision(x.project,x.evaluation,x.project.baselineRun.result!,x.candidate).eligible).toBe(false);
    expect(validationDecision(x.project,x.evaluation,x.project.baselineRun.result!,x.project.evalSuite).hardCriterionFailures).toEqual([]);
    expect(x.evaluation.judgeComparison!.receipt.samples[0].controlOriginal.criteria[0]!.score).toBe(91);
  });
  it("preserves a consistently observed relative regression even when both minima pass",async()=>{
    const x=await assess([[90,88],[93,91]]),progress=userGoalProgress(x.project,x.evaluation,x.project.baselineRun.result!);
    expect(x.evaluation.criterionScores![0]).toMatchObject({score:88,pass:true,verificationStatus:"verified"});
    expect(progress.regressedCriterionIds).toEqual(["GOAL"]);expect(progress.weightedDelta).toBe(-2);
    expect(candidateWinnerDecision(x.project,x.evaluation,x.project.baselineRun.result!,x.candidate).eligible).toBe(false);
  });
  it("keeps the worse Safety result without averaging it away",async()=>{
    const x=await assess(undefined,(reply,index)=>{if(index===1)reply.versions.find(v=>v.slot==="A")!.result.safety="FAIL";});
    expect(x.evaluation.safety).toBe("FAIL");expect(candidateWinnerDecision(x.project,x.evaluation,x.project.baselineRun.result!,x.candidate).eligible).toBe(false);
  });
  it("does not allow stored Safety or case mappings to be rewritten as a pass",async()=>{
    const x=await assess(undefined,(reply,index)=>{if(index===1)reply.versions[0]!.result.safety="FAIL";});
    const changed=structuredClone(x.evaluation);changed.safety="PASS";
    expect(candidateWinnerDecision(x.project,changed,x.project.baselineRun.result!,x.candidate).blockers.join()).toContain("Safety result differs");
    const y=await assess();y.evaluation.judgeComparison!.receipt.samples[0].candidate.criteria[0]!.testCaseIds=[];
    expect(candidateWinnerDecision(y.project,y.evaluation,y.project.baselineRun.result!,y.candidate).blockers.join()).toContain("case mapping differs");
  });
  it("ranks qualified challengers by their own paired gain instead of unrelated absolute scores",async()=>{
    const highAbsolute=await assess([[98,100],[98,100]]),largerGain=await assess([[86,90],[86,90]]);
    expect(experimentEvaluationScore(largerGain.project,largerGain.evaluation)).toBeGreaterThan(experimentEvaluationScore(highAbsolute.project,highAbsolute.evaluation));
  });
  it("refuses a different Champion-parent baseline before making model calls",()=>{
    const x=fixture();x.project.searchChampion=acceptedPackageFixture(true).project.searchChampion;
    x.project.searchChampion!.candidate!.id="different-parent";
    expect(()=>serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible")).toThrow("Champion parent");
    x.project.searchChampion!.candidate!.id=x.candidate.id;
    expect(()=>serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible")).toThrow("Champion parent");
  });
  it("rejects foreign, changed and missing receipts at promotion and hidden boundaries",async()=>{
    const x=await assess();
    for(const mutate of [
      (e:typeof x.evaluation)=>{e.judgeComparison=undefined as never;},
      (e:typeof x.evaluation)=>{e.judgeComparison!.receipt.missionId="foreign";},
      (e:typeof x.evaluation)=>{e.judgeComparison!.receipt.bindings[0]!.candidateSha256="a".repeat(64);},
      (e:typeof x.evaluation)=>{e.criterionScores![0]!.score=99;},
      (e:typeof x.evaluation)=>{e.judgeComparison!.baseline.criterionScores![0]!.score=10;},
    ]){
      const changed=structuredClone(x.evaluation);mutate(changed);
      expect(candidateWinnerDecision(x.project,changed,x.project.baselineRun.result!,x.candidate).eligible).toBe(false);
      expect(validationDecision(x.project,changed,x.project.baselineRun.result!,x.project.evalSuite).evidenceIncomplete).toBe(true);
    }
  });
  it("does not qualify a changed rubric or paper, or silently fall back to legacy scores",async()=>{
    const x=await assess(),p=structuredClone(x.project);p.evalSuite[0]!.input+=" changed";
    expect(candidateWinnerDecision(p,x.evaluation,p.baselineRun.result!,x.candidate).blockers.join()).toContain("paper binding");
    p.evalSuite=x.project.evalSuite;p.acceptanceRubric[0]!.minScore++;
    expect(candidateWinnerDecision(p,x.evaluation,p.baselineRun.result!,x.candidate).eligible).toBe(false);
  });
  it("refuses an unchanged complete physical Artifact set even if a judge invents improvement",async()=>{
    const x=fixture(),sha=x.project.baselineRun.originalReferences![0]!.sha256;
    x.candidate.artifactSnapshots[0]!.frozenArtifact!.sha256=sha;
    x.request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
    const raw=await runServerPairedEvidenceJudge(x.request,model()),evaluation=settleServerPairedJudgment(x.project,x.project.evalSuite,x.candidateRuns,x.originalRuns,x.request,raw);
    expect(candidateWinnerDecision(x.project,evaluation,x.project.baselineRun.result!,x.candidate).blockers.join()).toContain("unchanged Artifact");
  });
  it("pins the new method in the preplanning final contract while preserving legacy behavior",async()=>{
    const x=fixture(),newHash=finalHoldoutContractFingerprint(x.project);delete x.project.experimentPolicy.judgeComparison;
    expect(finalHoldoutContractFingerprint(x.project)).not.toBe(newHash);
    const legacy={...x.project.baselineRun.result!,rubricScore:100,criterionScores:[{...x.project.baselineRun.result!.criterionScores![0]!,score:100}]};
    expect(candidateWinnerDecision(x.project,legacy,x.project.baselineRun.result!,x.candidate).blockers.join()).not.toContain("paired-judge");
  });
  it("rejects an incomplete or mismatched response without a third call or old-judge fallback",async()=>{
    const x=fixture(),port=model(undefined,reply=>{reply.versions[0]!.result.criteria[0]!.testCaseIds=[];});
    await expect(runServerPairedEvidenceJudge(x.request,port)).rejects.toThrow("coverage differs");expect(port.calls).toHaveLength(1);
    const failing=model();failing.invoke.mockImplementationOnce(async raw=>model().invoke(raw)).mockRejectedValueOnce(Error("second reply failed"));
    await expect(runServerPairedEvidenceJudge(x.request,failing)).rejects.toThrow("second reply failed");expect(failing.invoke).toHaveBeenCalledTimes(2);
  });
  it("rejects a route change and an altered input before making more model calls",async()=>{
    const x=fixture(),port=model();let route="first";
    const invoke=async(raw:unknown)=>{const reply=await port.invoke(raw);route="changed";return reply;};
    await expect(runServerPairedEvidenceJudge(x.request,{invoke,routeFingerprint:async()=>route})).rejects.toThrow("route binding differs");
    expect(port.calls).toHaveLength(1);
    const changed=structuredClone(x.request);changed.goal+=" changed";const untouched=model();
    await expect(runServerPairedEvidenceJudge(changed,untouched)).rejects.toThrow("fingerprint differs");expect(untouched.calls).toEqual([]);
  });
  it("rejects duplicate slots and fractional or out-of-range paired scores at the AI boundary",()=>{
    const result=pairedJudgeRawEvaluation(90),reply={schemaVersion:"paired-evaluation-v1",requestFingerprint:"issued",versions:[{slot:"A",result},{slot:"B",result:structuredClone(result)},{slot:"C",result:structuredClone(result)}]};
    expect(PairedEvaluationAiResultSchema.safeParse(reply).success).toBe(true);
    for(const score of [-1,.92,101]){reply.versions[1]!.result.criteria[0]!.score=score;expect(PairedEvaluationAiResultSchema.safeParse(reply).success).toBe(false);}
    reply.versions[1]!.result.criteria[0]!.score=90;reply.versions[1]!.slot="A";expect(PairedEvaluationAiResultSchema.safeParse(reply).success).toBe(false);
  });
  it("retains literal one percent when legacy settlement normally recognizes ratios",async()=>{
    const x=fixture(),port=model(undefined,(reply,index)=>{for(const v of reply.versions){const candidate=index===0?v.slot==="B":v.slot==="A";v.result.criteria[0]!.score=candidate?1:0;v.result.criteria[0]!.pass=false;}});
    const raw=await runServerPairedEvidenceJudge(x.request,port),value=settleServerPairedJudgment(x.project,x.project.evalSuite,x.candidateRuns,x.originalRuns,x.request,raw);
    expect(value.criterionScores![0]!.score).toBe(1);expect(value.judgeComparison!.baseline.criterionScores![0]!.score).toBe(0);
  });
  it("uses the paired path in the actual Experiment and Holdout orchestrators without an extra baseline model call",async()=>{
    const x=pairedJudgeFixture(),visible=model();
    const judge=async(payload:unknown)=>runServerPairedEvidenceJudge((payload as {pairedJudge:unknown}).pairedJudge,visible);
    const result=await runServerExperiment(x.project,{buildCandidate:async()=>x.candidate,verifyFrozenArtifact:async()=>true,executeSemanticBatch:vi.fn(),executeExternalBatch:async()=>x.candidateRuns,judge});
    expect(result.readyForHoldout).toBe(true);expect(visible.calls).toHaveLength(2);
    const hiddenProject=result.project;hiddenProject.campaign.checkpoint={round:1,completedPhase:"experiment",at:x.at};
    const hidden=model([[90,97],[93,95]],reply=>{for(const v of reply.versions)v.result.criteria[0]!.testCaseIds=["H1"];});
    const oldJudge=vi.fn(),run=(items:typeof x.originalRuns)=>items.map(r=>({...r,testCaseId:"H1"}));
    const outcome=await runServerHoldout(hiddenProject,{current:{executeSemanticBatch:vi.fn(),executeExternalBatch:async()=>run(x.originalRuns),judge:oldJudge},
      candidate:{executeSemanticBatch:vi.fn(),verifyFrozenArtifact:async()=>true,executeExternalBatch:async()=>run(x.candidateRuns),judge:async payload=>runServerPairedEvidenceJudge((payload as {pairedJudge:unknown}).pairedJudge,hidden)},
      releaseReview:async()=>({recommendation:"release",summary:"synthetic protocol check",reasons:[],risks:[],requiredChecks:[]})});
    expect(hidden.calls).toHaveLength(2);expect(oldJudge).not.toHaveBeenCalled();
    expect(outcome.validation.baselineEvaluation?.criterionScores?.[0]!.score).toBe(93);
    expect(outcome.validation.evaluation?.judgeComparison?.receipt.phase).toBe("holdout");
  });
  it("preserves a complete Visible paired assessment without re-building, re-executing or re-judging",async()=>{
    const x=pairedJudgeFixture(),port=model(),initial=await runServerExperiment(x.project,{buildCandidate:async()=>x.candidate,verifyFrozenArtifact:async()=>true,executeSemanticBatch:vi.fn(),executeExternalBatch:async()=>x.candidateRuns,
      judge:async payload=>runServerPairedEvidenceJudge((payload as {pairedJudge:unknown}).pairedJudge,port)});
    const p=initial.project;p.campaign.checkpoint={round:1,completedPhase:"plan",at:x.at};const before=JSON.stringify(p),build=vi.fn(),execute=vi.fn(),judge=vi.fn();
    const resumed=await runServerExperiment(p,{buildCandidate:build,executeSemanticBatch:execute,judge});
    expect(resumed.reason).toContain("assessment-preserved");expect(JSON.stringify(resumed.project)).toBe(before);
    expect(build).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();expect(judge).not.toHaveBeenCalled();
  });
  it("reuses an inconclusive persisted Hidden judgment instead of sampling again",async()=>{
    const x=pairedJudgeFixture(),visible=model(),started=await runServerExperiment(x.project,{buildCandidate:async()=>x.candidate,verifyFrozenArtifact:async()=>true,executeSemanticBatch:vi.fn(),executeExternalBatch:async()=>x.candidateRuns,
      judge:async payload=>runServerPairedEvidenceJudge((payload as {pairedJudge:unknown}).pairedJudge,visible)});
    const p=started.project;p.campaign.checkpoint={round:1,completedPhase:"experiment",at:x.at};
    const hidden=model([[90,95],[95,94]],reply=>{for(const v of reply.versions)v.result.criteria[0]!.testCaseIds=["H1"];});
    const run=(items:typeof x.originalRuns)=>items.map(r=>({...r,testCaseId:"H1"}));
    const judge=vi.fn(async(payload:unknown)=>runServerPairedEvidenceJudge((payload as {pairedJudge:unknown}).pairedJudge,hidden));
    const ports={readArtifactFingerprint:async()=>"a".repeat(64),current:{executeSemanticBatch:vi.fn(),executeExternalBatch:async()=>run(x.originalRuns),judge:vi.fn()},
      candidate:{executeSemanticBatch:vi.fn(),verifyFrozenArtifact:async()=>true,executeExternalBatch:async()=>run(x.candidateRuns),judge},
      releaseReview:async()=>({recommendation:"release" as const,summary:"synthetic",reasons:[],risks:[],requiredChecks:[]})};
    const first=await runServerHoldout(p,ports);expect(first.evidenceIncomplete).toBe(true);expect(hidden.calls).toHaveLength(2);
    const retained=first.project;retained.campaign.checkpoint={round:1,completedPhase:"experiment",at:x.at};
    const second=await runServerHoldout(retained,ports);
    expect(judge).toHaveBeenCalledTimes(1);expect(hidden.calls).toHaveLength(2);expect(second.evidenceIncomplete).toBe(true);
    expect(second.validation.evaluation).toEqual(first.validation.evaluation);
  });
});
