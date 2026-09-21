import { describe, expect, it } from "vitest";
import type { EvolveProject } from "@evolution/contracts";
import { advanceServerCampaignPreparation } from "./server-campaign-preparation";

function fixture(): EvolveProject {
  const now="2026-09-20T12:00:00.000Z";
  return {
    id:"mission",name:"Campaign",objectType:"document",department:"test",goal:"提升核心内容",problemStatement:"",desiredOutcome:"",
    evolutionCommand:"让内容更完整",protectedItems:["事实"],editableItems:["表达"],metrics:[],
    sourceArtifacts:[{id:"source",name:"source.md",role:"target",artifactKind:"document",mimeType:"text/markdown",size:20,extension:"md",inputMode:"paste",parseStatus:"ready",textContent:"当前文本存在流程缺口，需要补充证据闭环。",textExcerpt:"当前文本存在流程缺口",structure:[],warnings:[],createdAt:now}],
    inputClarifications:[],commandHistory:[],acceptanceRubric:[{id:"CONTENT",title:"内容闭环",requirement:"流程闭环完整",source:"user-command",weight:100,hardGate:true,judgeType:"llm",validationMethod:"semantic-judge",minScore:85,evidenceExpected:["闭环"],protectedConstraint:false,artifactIds:["source"],category:"outcome"}],
    acceptanceRubricState:{status:"ready",summary:"ready",version:1,weightTotal:100,uncoveredCriterionIds:[],warnings:[],confirmedAt:now},
    evalSuite:[{id:"V1",title:"内容闭环",input:"检查闭环",expected:["闭环"],tags:[],hidden:false,criterionIds:["CONTENT"],executionMode:"artifact-runtime",evidenceScope:"product-behavior"}],
    hiddenEvalSuite:[{id:"H1",title:"隐藏闭环",input:"检查闭环",expected:["闭环"],tags:[],hidden:true,criterionIds:["CONTENT"],executionMode:"artifact-runtime",evidenceScope:"product-behavior"}],
    baselineRun:{id:"baseline",status:"completed",suiteName:"Core",totalCases:1,runs:[{testCaseId:"V1",output:"当前文本存在流程缺口",latencyMs:1,cost:0.01,trace:[{id:"trace-1",stage:"content",summary:"流程缺口",status:"warning"}],verificationStatus:"verified"}],result:{accuracy:70,evidence:80,riskCoverage:80,completeness:70,safety:"PASS",averageCost:0.01,averageLatencyMs:1,notes:[],failures:["流程缺口"],rubricScore:70,verifiedRubricCoverage:100,unverifiedCriterionIds:[],criterionScores:[{criterionId:"CONTENT",score:70,pass:false,verificationStatus:"verified",evidence:["当前文本存在流程缺口"],gaps:["缺少闭环"],testCaseIds:["V1"]}],caseScores:[]}},
    problems:[],candidates:[],selectedCandidateIds:[],lessons:[],nextQueue:[],versions:[],outputArtifacts:[],appliedPatches:[],searchAppliedPatches:[],evolutionArchive:[],roundHistory:[],
    experimentRun:{id:"experiment",status:"idle",candidateResults:[]},validationRun:{id:"validation",status:"idle",checks:[],runs:[],baselineRuns:[]},
    artifactAcceptance:{id:"acceptance",status:"idle",overallScore:0,coverageScore:0,integrityScore:0,pairwiseScore:0,hardGatePass:false,results:[],attempts:0,maxRepairAttempts:3,summary:""},
    release:{status:"idle",trafficPercent:0,healthy:true,kpis:[],history:[],evidenceMode:"simulation"},
    targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"},
    experimentPolicy:{},
    aiProfile:{},
    gates:[
      {id:"target-ready",label:"Target Ready",status:"approved",approvedAt:now},
      {id:"experiment-ready",label:"Experiment Ready",status:"pending"},
      {id:"artifact-ready",label:"Artifact Ready",status:"pending"},
      {id:"release-ready",label:"Release Ready",status:"pending"},
    ],
    stage:"baseline",version:"V1",currentVersionId:"V1",updatedAt:now,
    campaign:{status:"idle",executionMode:"auto-rounds",currentRound:0,noImprovementRounds:0,candidateCount:2,searchMode:"focused",parentStrategy:"champion-only",eliteCount:2,exploreRatio:0.3,estimatedCost:0,autoApproveOfflineExperiment:true,stopCriteria:{maxRounds:3,patienceRounds:2,minImprovement:1,stopWhenAcceptanceMet:true,stopOnSafetyFailure:true,stopWhenMetricTargetsMet:false},schedule:{enabled:false,mode:"manual",intervalMinutes:60,hour:8,minute:0,daysOfWeek:[]}},
  } as unknown as EvolveProject;
}

describe("server campaign preparation",()=>{
  it("advances problem -> diagnosis -> plan and hands off to Server Experiment",async()=>{
    const ai={
      problemAnalysis:async()=>({problems:[{id:"P",title:"流程缺口",impact:90,severity:"high" as const,status:"recommended" as const,summary:"流程未闭环",rootCause:"缺少证据闭环",evidence:["当前文本存在流程缺口"],evidenceRefs:[],confidence:0.9,affectedComponent:"source"}],recommendedProblemId:"P",summary:"问题"}),
      diagnose:async()=>({problemId:"P",rootCause:"缺少证据闭环",summary:"根因",affectedComponent:"source",confidence:0.9,evidence:["当前文本存在流程缺口"],evidenceRefs:[],counterEvidence:[],falsifier:"补齐后仍失败",suggestedScopes:["prompt" as const],trace:[]}),
      plan:async()=>({candidates:[
        {id:"C1",name:"闭环修复",change:"补齐闭环",hypothesis:"补齐闭环可提升",patches:[{id:"patch",component:"prompt" as const,operation:"update" as const,target:"source",artifactId:"source",content:"补齐闭环",rationale:"修复"}],riskLevel:"low" as const,expectedImpact:"提升",risks:[],accuracy:0,evidence:0,riskCoverage:0,costDelta:0,speedDelta:0,safety:"REVIEW" as const,recommended:true,status:"draft" as const,notes:[],addressesAdvice:[],artifactSnapshots:[],artifactBuildStatus:"idle" as const,designRationale:{sourceEvidence:["当前文本存在流程缺口"],commandAlignment:"让内容更完整",mechanism:"补齐闭环 → 可观察流程完整 → CONTENT 提升",coveredCriteria:["内容闭环"],protectedCompliance:"不改事实",falsifier:"隐藏题仍失败"}},
      ],recommendedCandidateIds:["C1"],summary:"方案",experimentDesign:["同卷比较","隐藏验证"]}),
    };
    const at=()=> "2026-09-20T12:30:00.000Z";
    const first=await advanceServerCampaignPreparation(fixture(),ai,{now:at});
    expect(first).toMatchObject({control:"continue",phase:"problem"});
    expect(first.project.campaign.checkpoint?.completedPhase).toBe("problem");
    expect(first.project.problems[0]?.evidenceRefs.some((ref)=>ref.verified)).toBe(true);

    const second=await advanceServerCampaignPreparation(first.project,ai,{now:at});
    expect(second).toMatchObject({control:"continue",phase:"diagnose"});
    expect(second.project.diagnosis?.evidenceRefs.some((ref)=>ref.verified)).toBe(true);

    const third=await advanceServerCampaignPreparation(second.project,ai,{now:at});
    expect(third).toMatchObject({control:"continue",phase:"experiment",candidateCount:1});
    expect(third.project.campaign.stopReason).toBeUndefined();
    expect(third.project.campaign.checkpoint).toMatchObject({round:1,completedPhase:"plan"});
    expect(third.project.gates.find((gate)=>gate.id==="experiment-ready")?.status).toBe("approved");
    expect(third.project.candidates[0]?.status).toBe("draft");
  });

  it("preserves manual execution mode instead of silently upgrading it to auto-rounds",async()=>{
    const project=fixture();
    project.campaign={...project.campaign,executionMode:"manual"};
    const ai={
      problemAnalysis:async()=>({problems:[{id:"P",title:"流程缺口",impact:90,severity:"high" as const,status:"recommended" as const,summary:"流程未闭环",rootCause:"缺少证据闭环",evidence:["当前文本存在流程缺口"],evidenceRefs:[],confidence:0.9,affectedComponent:"source"}],recommendedProblemId:"P",summary:"问题"}),
      diagnose:async()=>{throw new Error("not reached");},
      plan:async()=>{throw new Error("not reached");},
    };
    const outcome=await advanceServerCampaignPreparation(project,ai,{now:()=>"2026-09-20T12:30:00.000Z"});
    expect(outcome.project.campaign.executionMode).toBe("manual");
  });

  it("fails closed before planning when baseline evidence is not ready",async()=>{
    const project=fixture();
    project.baselineRun={...project.baselineRun,status:"idle",result:undefined,runs:[]};
    const never=async()=>{throw new Error("AI should not run");};
    const outcome=await advanceServerCampaignPreparation(project,{problemAnalysis:never,diagnose:never,plan:never});
    expect(outcome.phase).toBe("baseline");
    expect(outcome.project.campaign.status).toBe("paused");
    expect(outcome.reason).toContain("server-campaign-baseline-pending");
  });

  it("pauses when diagnosis claims cannot be grounded to source/test evidence",async()=>{
    const project=fixture();
    project.acceptanceRubric=[{...project.acceptanceRubric[0]!,minScore:60}];
    project.baselineRun.result={...project.baselineRun.result!,criterionScores:[{criterionId:"CONTENT",score:70,pass:true,verificationStatus:"verified",evidence:["ok"],gaps:[],testCaseIds:["V1"]}]};
    const ai={
      problemAnalysis:async()=>({problems:[{id:"P",title:"猜测",impact:80,severity:"high" as const,status:"recommended" as const,summary:"猜测",rootCause:"未知",evidence:["完全不存在的量子数据库故障"],evidenceRefs:[],confidence:0.9,affectedComponent:"unknown"}],recommendedProblemId:"P",summary:"问题"}),
      diagnose:async()=>({problemId:"P",rootCause:"未知",summary:"根因",affectedComponent:"unknown",confidence:0.9,evidence:["完全不存在的量子数据库故障"],evidenceRefs:[],counterEvidence:[],falsifier:"x",suggestedScopes:["code" as const],trace:[]}),
      plan:async()=>{throw new Error("plan should not run");},
    };
    const first=await advanceServerCampaignPreparation(project,ai);
    const second=await advanceServerCampaignPreparation(first.project,ai);
    expect(second.control).toBe("stop");
    expect(second.reason).toContain("server-campaign-diagnosis-pending");
    expect(second.project.candidates).toHaveLength(0);
  });
});
