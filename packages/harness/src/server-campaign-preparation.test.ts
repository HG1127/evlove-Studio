import { describe, expect, it,vi } from "vitest";
import {CandidateSchema,TestCaseSchema,VisibleFailureObservationsSchema,type EvolveProject} from "@evolution/contracts";
import { campaignScoringInputFingerprint } from "@evolution/core";
import {integrateDistilledLesson} from "@evolution/core";
import {attachLessonGovernance} from "@evolution/core";
import {syntheticLearningProject,withMeasuredProductionGoal} from "@evolution/testkit";
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
  it.each(["valid","mismatch","missing-loader","none","missing-final"])("loads %s historical observations only after blind reservation and before planning",async kind=>{
    const p=fixture();p.id="new-campaign";
    p.diagnosis={problemId:"P",rootCause:"gap",summary:"gap",affectedComponent:"source",confidence:0.9,evidence:["流程缺口"],evidenceRefs:[],counterEvidence:[],falsifier:"no gap",suggestedScopes:["code"],trace:[]};
    p.campaign.checkpoint={round:1,completedPhase:"diagnose",at:p.updatedAt};
    const ref={schemaVersion:"visible-failure-source-v1" as const,missionId:"old-source",missionSha256:"a".repeat(64),experimentRunId:"old-experiment",candidateId:"old-candidate",round:1};p.failureObservationSources=[ref];
    if(kind==="none")p.failureObservationSources=undefined;
    const context=VisibleFailureObservationsSchema.parse({schemaVersion:"visible-failure-observations-v1",missionId:p.id,observations:[{source:ref,grade:"measured-visible-failure",sourceGoal:"PRIOR_FAILURE_CONTEXT",sourceCommand:"old command",observedAt:1,executionEvidenceFingerprint:"b".repeat(64),
      artifacts:[{sourceArtifactId:"old-artifact",snapshotId:"old-snapshot",sha256:"c".repeat(64),originalSha256:"d".repeat(64)}],comparisons:[{criterionId:"OLD",title:"Old goal",minScore:85,weight:100,caseIds:["OLD-V"],baselineScore:95,candidateScore:90,delta:-5,baselineMinimumPassed:true,candidateMinimumPassed:true}],failureCriterionIds:["OLD"],unpairedCriterionIds:[],originalText:[],candidateText:[]}],limitations:["Synthetic phase isolation only"]});
    const never=async()=>{throw Error("completed phase");};let reserved=0,planned=0,loaded=0;
    const ports={problemAnalysis:never,diagnose:never,reserveFinalHoldout:kind==="missing-final"?undefined:async(payload:unknown)=>{reserved++;expect(loaded).toBe(0);expect(JSON.stringify(payload)).not.toMatch(/PRIOR_FAILURE_CONTEXT|old-source/);return [TestCaseSchema.parse({id:"F1",title:"final",input:"BLIND_TRANSFER_PAPER",expected:["different unseen edge"],hidden:true,criterionIds:["CONTENT"]})];},
      loadFailureObservations:kind==="missing-loader"?undefined:async()=>{loaded++;return kind==="mismatch"?{...context,missionId:"foreign"}:context;},
      plan:async(payload:unknown)=>{planned++;if(kind==="none")expect(payload).not.toHaveProperty("failureObservations");else expect(payload).toMatchObject({failureObservations:context});expect(JSON.stringify(payload)).not.toContain("BLIND_TRANSFER_PAPER");return {candidates:[CandidateSchema.parse({id:"new-candidate",name:"new",change:"new change",planningFailureObservationUse:{schemaVersion:"failure-observation-use-v1",grade:"provided-to-plan",missionId:"forged-model-receipt",round:99,at:p.updatedAt,sources:[],contextFingerprint:"forged"},designRationale:{sourceEvidence:["current source"],mechanism:"test change"}})],recommendedCandidateIds:["new-candidate"],summary:"plan",experimentDesign:[]};}};
    const first=await advanceServerCampaignPreparation(p,ports);expect(reserved).toBe(kind==="missing-final"?0:1);expect(loaded).toBe(0);expect(planned).toBe(0);
    const second=await advanceServerCampaignPreparation(first.project,ports);expect(reserved).toBe(kind==="missing-final"?0:1);
    expect(planned).toBe(kind==="valid"||kind==="none"?1:0);expect(second.project.finalHoldout).toEqual(first.project.finalHoldout);
    if(kind==="mismatch"||kind==="missing-loader"||kind==="missing-final")expect(second.reason).toContain("failure-context-pending");
    else if(kind==="valid"){
      expect(second.failureObservationUse).toMatchObject({grade:"provided-to-plan",sources:[ref],missionId:p.id});
      expect(second.project.candidates[0]?.planningFailureObservationUse).toEqual(second.failureObservationUse);
    }
    else {expect(loaded).toBe(0);expect(second.failureObservationUse).toBeUndefined();expect(second.project.candidates[0]).not.toHaveProperty("planningFailureObservationUse");}
  });
  it.each(["valid","foreign-mission","wrong-hash","stale"])("qualifies %s production knowledge at the actual planning port",async kind=>{
    const template=fixture(),source=syntheticLearningProject(),at=source.release.observedAt!;
    const p=withMeasuredProductionGoal({...template,releaseTarget:source.releaseTarget,release:source.release,
      candidates:source.candidates,searchChampion:source.searchChampion,validationRun:source.validationRun,
      experimentRun:{...template.experimentRun,winnerId:"C1"},metrics:source.metrics});
    const method=attachLessonGovernance(p,{id:"learned",title:"Synthetic",summary:"identity only",reusable:true,effect:"synthetic",limit:"not transfer",
      trigger:[],method:[],validatedOn:[],status:"verified-skill"},{at});
    expect(method.status).toBe("verified-skill");
    if(kind==="foreign-mission")method.provenance!.missionId="foreign";
    if(kind==="wrong-hash")method.provenance!.artifactHashes[0]="wrong";
    p.lessons=[method];
    p.diagnosis={problemId:"P",rootCause:"gap",summary:"gap",affectedComponent:"source",confidence:0.9,evidence:["流程缺口"],evidenceRefs:[],counterEvidence:[],falsifier:"no gain",suggestedScopes:["code"],trace:[]};
    p.campaign.checkpoint={round:1,completedPhase:"diagnose",at};
    const original=JSON.stringify(p.lessons),never=async()=>{throw Error("completed phase");};
    const plan=vi.fn(async(payload:unknown)=>{
      expect((payload as {existingLessons:unknown[]}).existingLessons).toHaveLength(kind==="valid"?1:0);
      return {candidates:[],recommendedCandidateIds:[],summary:"source checked",experimentDesign:[]};
    });
    await advanceServerCampaignPreparation(p,{problemAnalysis:never,diagnose:never,plan},{now:()=>kind==="stale"?"2026-09-20T16:00:00.000Z":at});
    expect(plan).toHaveBeenCalledOnce();expect(JSON.stringify(p.lessons)).toBe(original);
  });
  it.each([false,true])("only sends an explicitly enabled complete user-goal scope to Plan (%s)",async enabled=>{
    const p=fixture();if(enabled)p.experimentPolicy.winnerGoalScope="all-user-goals-v1";
    p.acceptanceRubric.push({...p.acceptanceRubric[0]!,id:"UNDERSTAND",title:"理解难度",requirement:"降低理解难度"});
    p.diagnosis={problemId:"P",rootCause:"gap",summary:"gap",affectedComponent:"source",confidence:0.9,evidence:["流程缺口"],evidenceRefs:[],counterEvidence:[],falsifier:"no gain",suggestedScopes:["code"],trace:[]};
    p.campaign.checkpoint={round:1,completedPhase:"diagnose",at:p.updatedAt};
    const plan=vi.fn(async(payload:unknown)=>{
      if(enabled)expect(payload).toMatchObject({winnerGoalScope:{policy:"all-user-goals-v1",requiredCriteria:[{criterionId:"CONTENT"},{criterionId:"UNDERSTAND"}]}});
      else expect(payload).not.toHaveProperty("winnerGoalScope");
      return {candidates:[],recommendedCandidateIds:[],summary:"scope checked",experimentDesign:[]};
    });
    const never=async()=>{throw Error("completed phase");};
    await advanceServerCampaignPreparation(p,{problemAnalysis:never,diagnose:never,plan});expect(plan).toHaveBeenCalledOnce();
  });
  it("rejects an enabled scope without user goals before any planning provider call",async()=>{
    const p=fixture();p.experimentPolicy.winnerGoalScope="all-user-goals-v1";p.acceptanceRubric=[];
    const request=vi.fn();const result=await advanceServerCampaignPreparation(p,{problemAnalysis:request,diagnose:request,plan:request});
    expect(result.control).toBe("stop");expect(result.reason).toContain("禁止调用模型");expect(request).not.toHaveBeenCalled();
  });
  it("gives Plan the current whole-goal criteria and measured gaps without promoting old advice into a narrower contract",async()=>{
    const p=fixture();p.evolutionCommand="细化各章节配置\n[旧自动建议] 只修入门并约束 JSON 格式";
    p.acceptanceRubric[0]={...p.acceptanceRubric[0]!,minScore:85,requirement:"各章节配置细节得到有效细化"};
    p.baselineRun.result!.criterionScores![0]={...p.baselineRun.result!.criterionScores![0]!,score:88,pass:true,gaps:["后续章节缺默认值、依赖关系和逐项检查"]};
    p.acceptanceRubric.push({...p.acceptanceRubric[0]!,id:"SYS-PAIRWISE",source:"system-integrity",judgeType:"pairwise"});
    p.evalSuite.push({...p.evalSuite[0]!,id:"V-PAIR",criterionIds:["SYS-PAIRWISE"]});
    p.baselineRun.runs.push({testCaseId:"V-PAIR",output:"Original-only comparison deferred",latencyMs:0,cost:0,trace:[],verificationStatus:"unverified"});
    p.baselineRun.result!.failures.push("SYS-PAIRWISE: comparison deferred");
    p.baselineRun.result!.criterionScores!.push({criterionId:"SYS-PAIRWISE",score:0,pass:false,verificationStatus:"unverified",evidence:[],gaps:["not paired"],testCaseIds:["V-PAIR"]});
    p.diagnosis={problemId:"P",rootCause:"旧诊断只看入门章节",summary:"局部假设",affectedComponent:"source",confidence:0.9,evidence:["流程缺口"],evidenceRefs:[],counterEvidence:[],falsifier:"不改善",suggestedScopes:["prompt"],trace:[]};
    p.campaign.checkpoint={round:1,completedPhase:"diagnose",at:p.updatedAt};
    const before=structuredClone(p),never=async()=>{throw Error("completed phase");};
    await advanceServerCampaignPreparation(p,{problemAnalysis:never,diagnose:never,plan:async payload=>{
      expect(payload).toMatchObject({acceptanceRubric:[{id:"CONTENT",minScore:85,requirement:"各章节配置细节得到有效细化"},{id:"SYS-PAIRWISE"}],
        baseline:{id:"baseline"},planningBaseline:{schemaVersion:"planning-baseline-evidence-v1",criteria:[{criterionId:"CONTENT",score:88,status:"verified",gaps:["后续章节缺默认值、依赖关系和逐项检查"]}]}});
      const context=payload as {baselineFailures:string[];planningInstruction:string;project:{evolutionCommand:string}};
      expect(context.baselineFailures).not.toContain("SYS-PAIRWISE: comparison deferred");expect(context.project.evolutionCommand).toBe(p.evolutionCommand);
      expect(context.planningInstruction).toContain("does not narrow");
      return {candidates:[],recommendedCandidateIds:[],summary:"checked",experimentDesign:[]};
    }});
    expect(p).toEqual(before);
  });
  it("reserves the final paper before planning and never includes it in the mutation payload",async()=>{
    const project=fixture();project.diagnosis={problemId:"P",rootCause:"gap",summary:"gap",affectedComponent:"source",confidence:0.9,evidence:["流程缺口"],evidenceRefs:[],counterEvidence:[],falsifier:"no gap",suggestedScopes:["code"],trace:[]};
    project.campaign.checkpoint={round:1,completedPhase:"diagnose",at:project.updatedAt};
    const never=async()=>{throw Error("completed phase");};
    let reserved=0,planned=0;
    const ports={problemAnalysis:never,diagnose:never,reserveFinalHoldout:async(payload:unknown)=>{
      reserved++;expect(JSON.stringify(payload)).not.toContain("candidate-BLIND");
      return [TestCaseSchema.parse({id:"F1",title:"final",input:"BLIND_SCENARIO",expected:["different edge"],hidden:true,criterionIds:["CONTENT"]})];
    },plan:async(payload:unknown)=>{
      planned++;expect(JSON.stringify(payload)).not.toContain("BLIND_SCENARIO");
      return {candidates:[CandidateSchema.parse({id:"candidate-BLIND",name:"repair",change:"real change",designRationale:{sourceEvidence:["流程缺口"],mechanism:"close gap"}})],recommendedCandidateIds:["candidate-BLIND"],summary:"planned",experimentDesign:[]};
    }};
    const reservedOutcome=await advanceServerCampaignPreparation(project,ports);
    expect(reserved).toBe(1);expect(planned).toBe(0);expect(reservedOutcome.project.candidates).toHaveLength(0);
    const plannedOutcome=await advanceServerCampaignPreparation(reservedOutcome.project,ports);
    expect(reserved).toBe(1);expect(planned).toBe(1);
    expect(plannedOutcome.project.candidates[0]?.finalHoldoutPaperHash).toBe(reservedOutcome.project.finalHoldout?.paperHash);
  });
  it("feeds newly integrated learning and the selected next-round problem into real planning",async()=>{
    const project=fixture();
    const makeLesson=(id:string)=>({id,title:id,summary:"observed",reusable:true,effect:"improved",limit:"same context",status:"lesson" as const,trigger:[],method:[],validatedOn:[]});
    project.lessons=Array.from({length:6},(_,i)=>makeLesson("old-"+i));
    project.lessons=integrateDistilledLesson(project,makeLesson("newest")).lessons;
    project.problemStatement="Selected Next Queue issue";
    project.diagnosis={problemId:"P",rootCause:"gap",summary:"gap",affectedComponent:"source",confidence:0.9,evidence:["流程缺口"],evidenceRefs:[],counterEvidence:[],falsifier:"no gap",suggestedScopes:["code"],trace:[]};
    project.campaign.checkpoint={round:1,completedPhase:"diagnose",at:project.updatedAt};
    let called=false;
    const never=async()=>{throw Error("completed phase");};
    await advanceServerCampaignPreparation(project,{problemAnalysis:never,diagnose:never,plan:async payload=>{
      called=true;
      expect(payload).toMatchObject({project:{problemStatement:"Selected Next Queue issue"}});
      const lessons=(payload as {existingLessons:Array<{id:string}>}).existingLessons;
      expect(lessons).toHaveLength(6);expect(lessons[0]!.id).toBe("newest");
      return {candidates:[],recommendedCandidateIds:[],summary:"context checked",experimentDesign:[]};
    }});
    expect(called).toBe(true);
  });
  it("shows the selected diagnosis source late in a large file to the Plan model",async()=>{
    const project=fixture();
    const quote="退款审批 REFUND_APPROVAL_CASE 必须由主管批准并保留流水编号。";
    const source="/* irrelevant presentation styles */\n".repeat(3000)+quote+"\n"+"unrelated appendix\n".repeat(3000);
    project.sourceArtifacts[0]!.textContent=source;
    project.problems=[{id:"P",title:"退款审批缺口",impact:90,severity:"high",status:"recommended",summary:"缺少审批流水",rootCause:"没有审批编号",evidence:[quote],evidenceRefs:[],confidence:0.9,affectedComponent:"source"}];
    project.selectedProblemId="P";
    project.diagnosis={problemId:"P",rootCause:"退款审批编号缺失",summary:"补齐审批流水",affectedComponent:"source",confidence:0.9,evidence:[quote],evidenceRefs:[],counterEvidence:[],falsifier:"编号仍缺失",suggestedScopes:["code"],trace:[]};
    project.campaign.checkpoint={round:1,completedPhase:"diagnose",at:project.updatedAt};
    let called=false;
    const outcome=await advanceServerCampaignPreparation(project,{
      problemAnalysis:async()=>{throw new Error("completed phase");},
      diagnose:async()=>{throw new Error("completed phase");},
      plan:async(payload)=>{
        called=true;
        const request=payload as {project:{sourceArtifacts:Array<{content:string;originalChars:number;truncated:boolean}>}};
        expect(request.project.sourceArtifacts[0]!.content).toContain(quote);
        expect(request.project.sourceArtifacts[0]!.content.length).toBeLessThanOrEqual(10000);
        expect(request.project.sourceArtifacts[0]).toMatchObject({originalChars:source.length,truncated:true});
        return {candidates:[],recommendedCandidateIds:[],summary:"source context checked",experimentDesign:[]};
      },
    });
    expect(called).toBe(true);
    expect(outcome.phase).toBe("plan");
    expect(project.sourceArtifacts[0]!.textContent).toBe(source);
  });

  it("keeps complete small files unchanged in planning context",async()=>{
    const project=fixture();
    project.diagnosis={problemId:"P",rootCause:"缺少闭环",summary:"补齐闭环",affectedComponent:"source",confidence:0.9,evidence:["流程缺口"],evidenceRefs:[],counterEvidence:[],falsifier:"仍有缺口",suggestedScopes:["code"],trace:[]};
    const original=project.sourceArtifacts[0]!.textContent!;
    project.campaign.checkpoint={round:1,completedPhase:"diagnose",at:project.updatedAt};
    const never=async()=>{throw new Error("completed phase");};
    let called=false;
    await advanceServerCampaignPreparation(project,{
      problemAnalysis:never,diagnose:never,
      plan:async(payload)=>{
        called=true;
        const request=payload as {project:{sourceArtifacts:Array<{content:string;truncated:boolean;originalChars:number}>}};
        expect(request.project.sourceArtifacts[0]).toMatchObject({content:original,truncated:false,originalChars:original.length});
        return {candidates:[],recommendedCandidateIds:[],summary:"checked",experimentDesign:[]};
      },
    });
    expect(called).toBe(true);
    expect(project.sourceArtifacts[0]!.textContent).toBe(original);
  });

  it("retains Target priority, file-count and aggregate context limits",async()=>{
    const project=fixture();
    project.diagnosis={problemId:"P",rootCause:"缺少闭环",summary:"补齐闭环",affectedComponent:"source",confidence:0.9,evidence:["流程缺口"],evidenceRefs:[],counterEvidence:[],falsifier:"仍有缺口",suggestedScopes:["code"],trace:[]};
    const artifact=project.sourceArtifacts[0]!;
    project.sourceArtifacts=Array.from({length:14},(_,index)=>({
      ...artifact,id:"source-"+index,role:index<2?"reference" as const:"target" as const,
      textContent:("unrelated content "+index+"\n").repeat(5000),
    }));
    const originals=project.sourceArtifacts.map((source)=>source.textContent);
    project.campaign.checkpoint={round:1,completedPhase:"diagnose",at:project.updatedAt};
    const never=async()=>{throw new Error("completed phase");};
    let called=false;
    await advanceServerCampaignPreparation(project,{
      problemAnalysis:never,diagnose:never,
      plan:async(payload)=>{
        called=true;
        const request=payload as {project:{sourceArtifacts:Array<{id:string;role:string;content:string;truncated:boolean}>}};
        const artifacts=request.project.sourceArtifacts;
        expect(artifacts).toHaveLength(12);
        expect(artifacts.every((source)=>source.role==="target")).toBe(true);
        expect(artifacts.every((source)=>source.content.length<=10_000&&source.truncated)).toBe(true);
        expect(artifacts.reduce((total,source)=>total+source.content.length,0)).toBeLessThanOrEqual(48_000);
        expect(artifacts.every((source)=>source.content.trim().length>0)).toBe(true);
        return {candidates:[],recommendedCandidateIds:[],summary:"checked",experimentDesign:[]};
      },
    });
    expect(called).toBe(true);
    expect(project.sourceArtifacts.map((source)=>source.textContent)).toEqual(originals);
  });
  it("stops before model planning when the source-count limit would omit a Target",async()=>{
    const p=fixture();p.diagnosis={problemId:"P",rootCause:"gap",summary:"gap",affectedComponent:"source",confidence:0.9,evidence:["流程缺口"],evidenceRefs:[],counterEvidence:[],falsifier:"gap",suggestedScopes:["code"],trace:[]};
    p.campaign.checkpoint={round:1,completedPhase:"diagnose",at:p.updatedAt};
    p.sourceArtifacts=Array.from({length:13},(_,i)=>({...p.sourceArtifacts[0]!,id:`source-${i}`}));
    const plan=vi.fn(),never=async()=>{throw Error("completed phase");};
    const out=await advanceServerCampaignPreparation(p,{problemAnalysis:never,diagnose:never,plan});
    expect(out.control).toBe("stop");expect(out.reason).toContain("cannot omit a Target");expect(plan).not.toHaveBeenCalled();
  });

  it("retrieves late selected-problem evidence for diagnosis too",async()=>{
    const project=fixture();
    const quote="库存核销 INVENTORY_AUDIT_CASE 必须记录批次和审批流水。";
    const source="unrelated header\n".repeat(5000)+quote+"\n"+"unrelated appendix\n".repeat(3000);
    project.sourceArtifacts[0]!.textContent=source;
    project.problems=[{id:"P",title:"库存核销",impact:90,severity:"high",status:"recommended",summary:"批次丢失",rootCause:"缺少批次",evidence:[quote],evidenceRefs:[],confidence:0.9,affectedComponent:"source"}];
    project.selectedProblemId="P";
    project.campaign.checkpoint={round:1,completedPhase:"problem",at:project.updatedAt};
    const never=async()=>{throw new Error("wrong phase");};
    let called=false;
    const outcome=await advanceServerCampaignPreparation(project,{
      problemAnalysis:never,plan:never,
      diagnose:async(payload)=>{
        called=true;
        const request=payload as {project:{artifacts:Array<{content:string;truncated:boolean}>}};
        expect(request.project.artifacts[0]!.content.includes(quote)).toBe(true);
        expect(request.project.artifacts[0]!.truncated).toBe(true);
        return {problemId:"P",rootCause:"缺少批次",summary:"补齐记录",affectedComponent:"source",confidence:0.9,evidence:[quote],evidenceRefs:[],counterEvidence:[],falsifier:"仍未记录",suggestedScopes:["code"],trace:[]};
      },
    });
    expect(called).toBe(true);
    expect(outcome.phase).toBe("diagnose");
    expect(project.sourceArtifacts[0]!.textContent).toBe(source);
  });

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

  it("plans Round 2 from the exact S1 Champion rather than stale original source or repeated Candidate ID",async()=>{
    const project=fixture();
    const original=project.sourceArtifacts[0]!.textContent!;
    const s1="# S1 冻结方案\\n升级后的研究规范补齐引用机制，但仍缺操作清单。";
    const championCandidate={
      id:"candidate-002",name:"S1",artifactBuildStatus:"ready",
      artifactSnapshots:[{
        id:"s1-snapshot",sourceArtifactId:"source",content:s1,name:"s1.md",
        mimeType:"text/markdown",contentHash:"frozen-s1",
        frozenArtifact:{sourceArtifactId:"source",blobId:"frozen-s1",sha256:"a".repeat(64),size:s1.length,snapshotHash:"frozen-s1"},
      }],
    };
    project.searchChampion={id:"champion-r1-candidate-002",versionLabel:"S1",
      round:1,score:72,candidate:championCandidate,patches:[],
      reason:"第一轮已经过独立评估",validation:{status:"completed",recommendation:"release"},
      artifactAcceptance:{status:"passed",candidateId:"candidate-002"},
    } as unknown as NonNullable<EvolveProject["searchChampion"]>;
    project.campaign={...project.campaign,status:"running",currentRound:1,
      stopCriteria:{...project.campaign.stopCriteria,stopWhenAcceptanceMet:false,maxRounds:3,patienceRounds:3},
      scoringInputFingerprint:campaignScoringInputFingerprint(project),
      checkpoint:{round:2,completedPhase:"diagnose",at:project.updatedAt}};
    project.roundHistory=[{round:1,winnerCandidateId:"candidate-002"} as EvolveProject["roundHistory"][number]];
    project.candidates=[championCandidate as EvolveProject["candidates"][number]];
    project.problems=[{id:"P",title:"S1 操作清单缺失",summary:"缺少逐条执行说明",impact:80,
      severity:"high",status:"recommended",confidence:0.9,
      rootCause:"缺少核验操作步骤",evidence:["仍缺操作清单"]} as EvolveProject["problems"][number]];
    project.selectedProblemId="P";
    project.diagnosis={problemId:"P",rootCause:"缺少执行级检查",summary:"补全清单",
      affectedComponent:"source",confidence:0.9,evidence:["仍缺操作清单"],
      evidenceRefs:[],counterEvidence:[],falsifier:"仍没有操作清单",
      suggestedScopes:["prompt"],trace:[]} as EvolveProject["diagnosis"];
    const never=async()=>{throw new Error("Existing phase must not rerun");};
    const outcome=await advanceServerCampaignPreparation(project,{
      problemAnalysis:never,diagnose:never,
      plan:async(payload)=>{
        const data=payload as {project:{sourceArtifacts:Array<{id:string;content:string;contentSource:string}>};
          search:{baseVersionId:string;champion:{versionLabel:string;id:string}}};
        expect(data.project.sourceArtifacts[0]).toMatchObject({
          id:"source",content:s1,contentSource:"search-champion:S1",
        });
        expect(data.project.sourceArtifacts[0]?.content).not.toBe(original);
        expect(data.search.baseVersionId).toBe("S1");
        expect(data.search.champion).toMatchObject({id:"champion-r1-candidate-002",versionLabel:"S1"});
        return {candidates:[{
          id:"candidate-002",name:"第二轮补齐清单",change:"补齐执行清单",
          hypothesis:"增加操作清单可提升质量",
          patches:[{id:"p2",component:"prompt" as const,operation:"update" as const,target:"source",
            artifactId:"source",content:"逐条核验",rationale:"提高可操作性"}],
          riskLevel:"low" as const,expectedImpact:"增强可操作性",risks:[],
          accuracy:0,evidence:0,riskCoverage:0,costDelta:0,speedDelta:0,
          safety:"REVIEW" as const,recommended:true,status:"draft" as const,
          notes:[],addressesAdvice:[],artifactSnapshots:[],
          artifactBuildStatus:"idle" as const,
          designRationale:{sourceEvidence:["仍缺操作清单"],
            commandAlignment:"让内容更完整",mechanism:"补齐操作清单 -> 按步核查 -> 可验证改善",
            coveredCriteria:["内容闭环"],protectedCompliance:"保留原事实",falsifier:"清单不可执行"},
        }],recommendedCandidateIds:["candidate-002"],summary:"续写 S1",
        experimentDesign:["同卷基线比较"]};
      },
    });
    expect(outcome).toMatchObject({control:"continue",phase:"experiment",candidateCount:1});
    expect(outcome.project.campaign.checkpoint).toMatchObject({round:2,completedPhase:"plan"});
    expect(outcome.project.candidates.map(c=>c.id)).toEqual(["r2-candidate-002"]);
    expect(outcome.project.searchChampion?.candidate?.id).toBe("candidate-002");
    expect(outcome.project.roundHistory[0]?.winnerCandidateId).toBe("candidate-002");
    expect(outcome.project.sourceArtifacts[0]?.textContent).toBe(original);
  });

  it.each(["SYS-PAIRWISE","ORIGINAL-REFERENCE"])("never presents Original-only %s as an actionable Baseline defect to Problem Analysis",async(criterionId)=>{
    const project=fixture();
    if(criterionId!=="SYS-PAIRWISE")project.baselineRun.referenceOnlyCriterionIds=[criterionId];
    const baselinePairwise={
      testCaseId:"VC-PAIRWISE",
      output:criterionId==="SYS-PAIRWISE"?"UNVERIFIED: only Candidate can establish improvement over original"
        :"Original document was read; Candidate preservation comparison remains unmeasured",
      verificationStatus:criterionId==="SYS-PAIRWISE"?"unverified" as const:"verified" as const,
      latencyMs:0,cost:0,trace:[],
    };
    project.acceptanceRubric.push({...project.acceptanceRubric[0]!,id:criterionId,
      source:"system-integrity",judgeType:"pairwise",hardGate:true});
    project.evalSuite.push({...project.evalSuite[0]!,id:"VC-PAIRWISE",
      criterionIds:[criterionId]});
    project.baselineRun.runs.push(baselinePairwise);
    project.baselineRun.result!.criterionScores!.push({
      criterionId,score:0,pass:false,verificationStatus:"unverified",
      evidence:[],gaps:["original cannot be paired without new Candidate"],testCaseIds:["VC-PAIRWISE"],
    });
    project.baselineRun.result!.unverifiedCriterionIds=[criterionId];
    // Simulate an accepted original with no actionable VERIFIED deficits.
    // Otherwise baselineRubricProblem intentionally bypasses AI entirely.
    project.baselineRun.result!.criterionScores![0]={
      ...project.baselineRun.result!.criterionScores![0]!,
      score:95,pass:true,gaps:[],
    };
    const originalRows=structuredClone(project.baselineRun);
    const outcome=await advanceServerCampaignPreparation(project,{
      problemAnalysis:async(payload)=>{
        const b=(payload as {baseline:{
          result:{criterionScores:Array<{criterionId:string}>;unverifiedCriterionIds:string[]};
          runs:Array<{testCaseId:string}>;
          comparisonOnlyDeferred:string;
        }}).baseline;
        expect(b.runs.map(x=>x.testCaseId)).not.toContain("VC-PAIRWISE");
        expect(b.result.criterionScores.map(x=>x.criterionId)).not.toContain(criterionId);
        expect(b.result.unverifiedCriterionIds).not.toContain(criterionId);
        expect(b.comparisonOnlyDeferred).toContain("Candidate");
        return {problems:[{
          id:"P-ACTUAL",title:"可核验的原始说明缺少验证步骤",
          impact:75,severity:"high" as const,status:"recommended" as const,
          summary:"真实文本缺少验证和回滚说明",rootCause:"步骤不完整",
          evidence:["当前文本存在流程缺口"],evidenceRefs:[],
          confidence:0.9,affectedComponent:"source",
        }],recommendedProblemId:"P-ACTUAL",summary:"基于真实文档"};
      },
      diagnose:async()=>{throw new Error("Not reached");},
      plan:async()=>{throw new Error("Not reached");},
    });
    expect(outcome.phase).toBe("problem");
    expect(outcome.project.problems[0]?.id).toBe("P-ACTUAL");
    expect(project.baselineRun).toEqual(originalRows);
    expect(outcome.project.baselineRun.result?.unverifiedCriterionIds).toContain(criterionId);
    if(criterionId!=="SYS-PAIRWISE"){
      project.baselineRun.runs.at(-1)!.verificationStatus="unverified";
      const unavailable=async()=>{throw Error("Missing Original execution must block before AI analysis");};
      const blocked=await advanceServerCampaignPreparation(project,{problemAnalysis:unavailable,diagnose:unavailable,plan:unavailable});
      expect(blocked.phase).toBe("baseline");
    }
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

  it("pauses before goal settlement or AI planning when the scored Target contract changed",async()=>{
    const project=fixture();
    const original=campaignScoringInputFingerprint(project);
    project.campaign.currentRound=1;
    project.campaign.scoringInputFingerprint=original;
    project.goal="Changed goal";
    const never=async()=>{throw new Error("AI should not run");};
    const outcome=await advanceServerCampaignPreparation(project,{problemAnalysis:never,diagnose:never,plan:never});
    expect(outcome).toMatchObject({control:"stop",phase:"settled",completed:false});
    expect(outcome.project.campaign.status).toBe("paused");
    expect(outcome.reason).toContain("重置搜索");
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
