import { describe, expect, it, vi } from "vitest";
import type { Candidate, EvaluateAiResult, EvolveProject, TargetRunResult } from "@evolution/contracts";
import { runServerExperiment } from "./server-experiment";
import { executeServerExperimentCandidate } from "./server-experiment-runner";

function fixture(executionMode:"artifact-runtime"|"external-runner"|"visual-review"="artifact-runtime"):EvolveProject{
  const now="2026-09-20T13:00:00.000Z";
  const candidate={
    id:"C1",name:"闭环修复",change:"补齐验证与回滚",hypothesis:"补齐闭环可提升",
    patches:[{id:"patch",component:"prompt",operation:"update",target:"缺少验证与回滚",artifactId:"source",content:"增加验证与回滚",rationale:"修复闭环"}],
    riskLevel:"low",expectedImpact:"提升",risks:[],accuracy:0,evidence:0,riskCoverage:0,costDelta:0,speedDelta:0,safety:"REVIEW",
    recommended:true,status:"draft",notes:[],addressesAdvice:[],artifactSnapshots:[],artifactBuildStatus:"idle",
    designRationale:{sourceEvidence:["缺少验证与回滚"],commandAlignment:"让内容更完整",mechanism:"补齐闭环 → CONTENT 提升",coveredCriteria:["CONTENT"],protectedCompliance:"保持事实",falsifier:"同卷不提升"},
  } as Candidate;
  return {
    id:"mission",name:"Experiment",objectType:"document",department:"test",goal:"提升核心内容",problemStatement:"",desiredOutcome:"",
    evolutionCommand:"让内容更完整",protectedItems:["事实"],editableItems:["表达"],metrics:[],
    sourceArtifacts:[{id:"source",name:"source.md",role:"target",artifactKind:"document",mimeType:"text/markdown",size:20,extension:"md",inputMode:"paste",parseStatus:"ready",textContent:"安装完成。缺少验证与回滚。",textExcerpt:"安装完成",structure:[],warnings:[],createdAt:now}],
    inputClarifications:[],commandHistory:[],supplementalValidationEvidence:[],adviceLedger:[],
    acceptanceRubric:[{id:"CONTENT",title:"内容闭环",requirement:"安装、验证与回滚完整",source:"user-command",weight:100,hardGate:true,judgeType:"llm",validationMethod:executionMode==="external-runner"?"executable-test":executionMode==="visual-review"?"visual-review":"semantic-judge",minScore:80,evidenceExpected:["验证","回滚"],protectedConstraint:false,artifactIds:["source"],category:"outcome"}],
    acceptanceRubricState:{status:"ready",summary:"ready",version:1,weightTotal:100,uncoveredCriterionIds:[],warnings:[],confirmedAt:now},
    evalSuite:[{id:"V1",title:"闭环",input:"检查闭环",expected:["验证","回滚"],tags:[],hidden:false,criterionIds:["CONTENT"],executionMode,evidenceScope:"product-behavior"}],
    hiddenEvalSuite:[{id:"H1",title:"隐藏闭环",input:"检查闭环",expected:["验证","回滚"],tags:[],hidden:true,criterionIds:["CONTENT"],executionMode,evidenceScope:"product-behavior"}],
    baselineRun:{id:"baseline",status:"completed",suiteName:"Core",totalCases:1,runs:[{testCaseId:"V1",output:"原版缺少验证与回滚",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}],result:{accuracy:70,evidence:70,riskCoverage:80,completeness:70,safety:"PASS",averageCost:0,averageLatencyMs:1,notes:[],failures:["缺闭环"],rubricScore:70,verifiedRubricCoverage:100,unverifiedCriterionIds:[],criterionScores:[{criterionId:"CONTENT",score:70,pass:false,verificationStatus:"verified",evidence:["缺闭环"],gaps:["验证","回滚"],testCaseIds:["V1"]}],caseScores:[{testCaseId:"V1",accuracy:70,evidence:70,completeness:70,reason:"缺闭环"}]}},
    problems:[{id:"P",title:"流程缺口",impact:90,severity:"high",status:"selected",summary:"缺闭环",evidence:["原版缺少验证与回滚"],evidenceRefs:[]}],selectedProblemId:"P",
    diagnosis:{problemId:"P",rootCause:"缺少验证与回滚",summary:"根因",affectedComponent:"source",confidence:0.9,evidence:["原版缺少验证与回滚"],evidenceRefs:[],counterEvidence:[],falsifier:"补齐仍失败",suggestedScopes:["prompt"],trace:[]},
    candidates:[candidate],selectedCandidateIds:["C1"],lessons:[],nextQueue:[],versions:[],outputArtifacts:[],appliedPatches:[],searchAppliedPatches:[],evolutionArchive:[],roundHistory:[],
    experimentRun:{id:"experiment-r1-server",status:"idle",candidateResults:[]},validationRun:{id:"validation",status:"idle",checks:[],runs:[],baselineRuns:[]},
    artifactAcceptance:{id:"acceptance",status:"idle",overallScore:0,coverageScore:0,integrityScore:0,pairwiseScore:0,hardGatePass:false,results:[],attempts:0,maxRepairAttempts:3,summary:""},
    release:{status:"idle",trafficPercent:0,healthy:true,kpis:[],history:[],evidenceMode:"simulation"},
    targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"},
    experimentPolicy:{},aiProfile:{},
    gates:[{id:"target-ready",label:"Target Ready",status:"approved",approvedAt:now},{id:"experiment-ready",label:"Experiment Ready",status:"approved",approvedAt:now},{id:"artifact-ready",label:"Artifact Ready",status:"pending"},{id:"release-ready",label:"Release Ready",status:"pending"}],
    stage:"plan",version:"V1",currentVersionId:"V1",updatedAt:now,
    campaign:{status:"running",executionMode:"auto-rounds",currentRound:0,noImprovementRounds:0,candidateCount:2,searchMode:"focused",parentStrategy:"champion-only",eliteCount:2,exploreRatio:0.3,estimatedCost:0,autoApproveOfflineExperiment:true,stopCriteria:{maxRounds:3,patienceRounds:2,minImprovement:1,stopWhenAcceptanceMet:true,stopOnSafetyFailure:true,stopWhenMetricTargetsMet:false},schedule:{enabled:false,mode:"manual",intervalMinutes:60,hour:8,minute:0,daysOfWeek:[]},checkpoint:{round:1,completedPhase:"plan",at:now}},
  } as unknown as EvolveProject;
}

function frozenCandidate(candidate:Candidate,content="安装完成。验证步骤完整。回滚步骤完整。"):Candidate{
  return {
    ...candidate,
    artifactBuildStatus:"ready",
    artifactBuildSummary:"server built",
    artifactSnapshots:[{
      id:`snap-${candidate.id}`,sourceArtifactId:"source",name:"source.md",mimeType:"text/markdown",content,contentHash:"hash-new",buildMode:"ai-full",notes:[],createdAt:"2026-09-20T13:05:00.000Z",
      frozenArtifact:{sourceArtifactId:"source",snapshotHash:"snapshot-new",blobId:"blob-new",name:"source.md",mimeType:"text/markdown",sha256:"sha-new",size:content.length,verifiedAt:"2026-09-20T13:05:00.000Z",checks:["persisted"],limitations:[]},
    }],
  };
}

function judge(score:number):EvaluateAiResult{
  return {
    accuracy:score,evidence:score,riskCoverage:90,completeness:score,safety:"PASS",notes:[],failures:score>=80?[]:["闭环仍不足"],
    cases:[{testCaseId:"V1",accuracy:score,evidence:score,completeness:score,reason:score>=80?"闭环完整":"闭环不足"}],
    criteria:[{criterionId:"CONTENT",score,pass:score>=80,evidence:score>=80?["V1: 验证与回滚完整"]:[],gaps:score>=80?[]:["仍缺闭环"],testCaseIds:["V1"]}],
  };
}

describe("server experiment",()=>{
  it("discards repeated semantic Candidate results and uses only the exact local snapshot",async()=>{
    const project=fixture();
    const runs=await executeServerExperimentCandidate(project,frozenCandidate(project.candidates[0]!),{
      executeSemanticBatch:async()=>({results:[
        {testCaseId:"V1",output:"passed",trace:[]},
        {testCaseId:"V1",output:"failed",trace:[]},
      ]}),
      judge:async()=>judge(90),
    });
    expect(runs[0]).toMatchObject({testCaseId:"V1",verificationStatus:"verified"});
    expect(runs[0]?.output).toContain("CURRENT CANDIDATE SNAPSHOT EVIDENCE");
    expect(runs[0]?.output).not.toContain("passed");
    expect(runs[0]?.output).not.toContain("failed");
    expect(runs[0]?.trace[0]?.detail).toContain("重复结果");
  });

  it("builds exact artifacts, judges them and persists an Experiment Winner checkpoint",async()=>{
    const outcome=await runServerExperiment(fixture(),{
      buildCandidate:async({candidate})=>frozenCandidate(candidate),
      executeSemanticBatch:async({testCases})=>({results:testCases.map((testCase)=>({testCaseId:testCase.id,output:"当前 Candidate 已包含完整验证与回滚步骤。",trace:[]}))}),
      judge:async()=>judge(92),
    },{now:()=> "2026-09-20T13:10:00.000Z"});
    expect(outcome.readyForHoldout).toBe(true);
    expect(outcome.winnerId).toBe("C1");
    expect(outcome.experiment.status).toBe("completed");
    expect(outcome.project.experimentRun.winnerId).toBe("C1");
    expect(outcome.project.candidates[0]?.artifactSnapshots[0]?.frozenArtifact?.blobId).toBe("blob-new");
    expect(outcome.project.campaign.checkpoint).toMatchObject({round:1,completedPhase:"experiment"});
  });

  it("fails closed when no Candidate can be materialized and frozen",async()=>{
    const outcome=await runServerExperiment(fixture(),{
      buildCandidate:async()=>{throw new Error("DOCX renderer unavailable");},
      executeSemanticBatch:async()=>({results:[]}),
      judge:async()=>judge(90),
    });
    expect(outcome.control).toBe("stop");
    expect(outcome.experiment.status).toBe("failed");
    expect(outcome.reason).toContain("experiment-build-pending");
    expect(outcome.project.campaign.status).toBe("paused");
  });

  it("fails closed after Candidate execution when the independent Judge is unavailable",async()=>{
    const outcome=await runServerExperiment(fixture(),{
      buildCandidate:async({candidate})=>frozenCandidate(candidate),
      executeSemanticBatch:async({testCases})=>({results:testCases.map((testCase)=>({testCaseId:testCase.id,output:"Candidate 当前闭环内容可读取。",trace:[]}))}),
      judge:async()=>{throw new Error("judge unavailable");},
    });
    expect(outcome.control).toBe("stop");
    expect(outcome.reason).toContain("experiment-judge-pending");
    expect(outcome.project.candidates[0]?.artifactSnapshots[0]?.frozenArtifact).toBeTruthy();
  });

  it("keeps the same exact Candidate when only real Runner evidence is missing",async()=>{
    const project=fixture("external-runner");
    const outcome=await runServerExperiment(project,{
      buildCandidate:async({candidate})=>frozenCandidate(candidate),
      executeSemanticBatch:async()=>({results:[]}),
      executeExternalBatch:async({testCases})=>testCases.map((testCase):TargetRunResult=>({testCaseId:testCase.id,output:"UNVERIFIED：Sandbox unavailable",latencyMs:0,cost:0,verificationStatus:"unverified",trace:[]})),
      judge:async()=>{throw new Error("judge must not run without evaluable evidence");},
    });
    expect(outcome.readyForHoldout).toBe(true);
    expect(outcome.winnerId).toBeUndefined();
    expect(outcome.pendingEvidenceCandidateId).toBe("C1");
    expect(outcome.project.candidates[0]?.artifactSnapshots[0]?.id).toBe("snap-C1");
  });

  it("routes visual-review to the external/browser port after the exact Candidate is frozen",async()=>{
    const project=fixture("visual-review");
    let externalCalls=0;
    const outcome=await runServerExperiment(project,{
      buildCandidate:async({candidate})=>frozenCandidate(candidate),
      executeSemanticBatch:async()=>({results:[]}),
      executeExternalBatch:async({testCases})=>{
        externalCalls+=1;
        return testCases.map((testCase):TargetRunResult=>({
          testCaseId:testCase.id,output:"Sandbox visual evidence",latencyMs:10,cost:0,verificationStatus:"partial",trace:[],
        }));
      },
      judge:async()=>judge(90),
    });
    expect(externalCalls).toBe(1);
    expect(outcome.experiment.candidateResults[0]?.runs[0]?.verificationStatus).toBe("partial");
  });

  it("archives a verified non-Winner and advances to the next round without human intervention",async()=>{
    const outcome=await runServerExperiment(fixture(),{
      buildCandidate:async({candidate})=>frozenCandidate(candidate,"安装完成，但验证与回滚仍不完整。"),
      executeSemanticBatch:async({testCases})=>({results:testCases.map((testCase)=>({testCaseId:testCase.id,output:"Candidate 仍缺验证与回滚。",trace:[]}))}),
      judge:async()=>judge(60),
    });
    expect(outcome.control).toBe("continue");
    expect(outcome.readyForHoldout).toBe(false);
    expect(outcome.project.campaign.currentRound).toBe(1);
    expect(outcome.project.campaign.checkpoint).toBeUndefined();
    expect(outcome.project.evolutionArchive).toHaveLength(1);
    expect(outcome.project.roundHistory.at(-1)).toMatchObject({round:1,championChanged:false});
    expect(outcome.project.campaign.lastGapAdvice?.actions.length).toBeGreaterThan(0);
  });

  it("marks an individually failed build as failed while allowing another Candidate to win",async()=>{
    const project=fixture();
    const second={...project.candidates[0]!,id:"C2",name:"备用方案"} as Candidate;
    project.candidates=[project.candidates[0]!,second];
    project.selectedCandidateIds=["C1","C2"];
    const outcome=await runServerExperiment(project,{
      buildCandidate:async({candidate})=>{
        if(candidate.id==="C2")throw new Error("unsupported renderer");
        return frozenCandidate(candidate);
      },
      executeSemanticBatch:async({testCases})=>({results:testCases.map((testCase)=>({testCaseId:testCase.id,output:"当前 Candidate 已包含完整验证与回滚步骤。",trace:[]}))}),
      judge:async()=>judge(92),
    });
    expect(outcome.winnerId).toBe("C1");
    expect(outcome.experiment.buildFailures).toEqual([{candidateId:"C2",message:"unsupported renderer"}]);
    expect(outcome.project.candidates.find((candidate)=>candidate.id==="C2")).toMatchObject({
      status:"failed",artifactBuildStatus:"failed",artifactBuildSummary:"unsupported renderer",
    });
  });
});
describe("server frozen roundtrip recheck", () => {
  function scenario() {
    const project = fixture();
    project.sourceArtifacts[0]!.name = "repo.zip";
    project.sourceArtifacts[0]!.extension = "zip";
    project.sourceArtifacts[0]!.mimeType = "application/zip";
    project.sourceArtifacts[0]!.artifactKind = "codebase";
    project.acceptanceRubric[0]!.validationMethod = "format-roundtrip";
    const testCase = { ...project.evalSuite[0]!, executionMode: "roundtrip" as const, evidenceScope: "format" as const };
    const candidate = frozenCandidate(project.candidates[0]!, JSON.stringify({ kind: "codebase", overlay: true, files: [{ path: "src/app.ts", content: "export const app = true" }] }));
    return { project, testCase, candidate };
  }
  function ports(verifyFrozenArtifact?: (snapshot: Candidate["artifactSnapshots"][number]) => Promise<boolean>) {
    return { executeSemanticBatch: async () => ({ results: [] }), verifyFrozenArtifact, judge: async () => judge(90) };
  }

  it("verifies binary roundtrip only after the injected store rechecks the frozen bytes", async () => {
    const { project, testCase, candidate } = scenario();
    const verify = vi.fn(async () => true);
    const [run] = await executeServerExperimentCandidate(project, candidate, ports(verify), [testCase]);
    expect(verify).toHaveBeenCalledOnce();
    expect(run?.verificationStatus).toBe("verified");
    expect(run?.artifactHash).toBe(candidate.artifactSnapshots[0]!.frozenArtifact!.sha256);
    expect(run?.trace.some((step) => step.id.startsWith("candidate-frozen-recheck-") && step.status === "pass")).toBe(true);
  });

  it("rejects a missing verifier, failed byte check, and ambiguous Target coverage", async () => {
    const { project, testCase, candidate } = scenario();
    const absent = await executeServerExperimentCandidate(project, candidate, ports(), [testCase]);
    expect(absent[0]?.verificationStatus).toBe("unverified");
    const bad = await executeServerExperimentCandidate(project, candidate, ports(async () => false), [testCase]);
    expect(bad[0]?.verificationStatus).toBe("unverified");
    const duplicate = { ...candidate, artifactSnapshots: [...candidate.artifactSnapshots, { ...candidate.artifactSnapshots[0]!, id: "duplicate" }] } as Candidate;
    const verify = vi.fn(async () => true);
    const ambiguous = await executeServerExperimentCandidate(project, duplicate, ports(verify), [testCase]);
    expect(ambiguous[0]?.verificationStatus).toBe("unverified");
    expect(verify).not.toHaveBeenCalled();
  });
});
