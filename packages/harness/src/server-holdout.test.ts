import { describe, expect, it, vi } from "vitest";
import {ValidationRunSchema,type EvaluateAiResult,type EvolveProject,type TargetRunResult} from "@evolution/contracts";
import { runServerHoldout, type ServerHoldoutPorts } from "./server-holdout";
import { executeServerCurrentArtifactSuite, judgeServerCurrentArtifactSuite } from "./server-current-artifact-runner";
import { hasServerFrozenValidationCheckpoint } from "./server-frozen-validation-checkpoint";

function judged(score:number,testCaseId="H1"):EvaluateAiResult{
  return {
    accuracy:score,evidence:score,riskCoverage:90,completeness:score,safety:"PASS",notes:[],failures:score>=80?[]:["闭环不足"],
    cases:[{testCaseId,accuracy:score,evidence:score,completeness:score,reason:score>=80?"闭环完整":"闭环不足"}],
    criteria:[{criterionId:"CONTENT",score,pass:score>=80,evidence:score>=80?["Hidden 同卷证据"]:[],gaps:score>=80?[]:["闭环不足"],testCaseIds:[testCaseId]}],
  };
}

function fixture(executionMode:"artifact-runtime"|"external-runner"="artifact-runtime"):EvolveProject{
  const now="2026-09-20T14:00:00.000Z";
  const content="安装完成。验证步骤完整。回滚步骤完整。";
  const frozen={sourceArtifactId:"source",snapshotHash:"snapshot-new",blobId:"blob-new",name:"source.md",mimeType:"text/markdown",sha256:"sha-new",size:content.length,verifiedAt:now,checks:["persisted"],limitations:[]};
  const candidate={
    id:"C1",name:"闭环修复",change:"补齐验证与回滚",patches:[],addressesAdvice:[],riskLevel:"low" as const,risks:[],
    accuracy:92,evidence:92,riskCoverage:90,costDelta:0,speedDelta:0,safety:"PASS" as const,recommended:true,status:"winner" as const,notes:[],
    artifactBuildStatus:"ready" as const,artifactBuildSummary:"server built",
    artifactSnapshots:[{id:"snap-C1",sourceArtifactId:"source",name:"source.md",mimeType:"text/markdown",content,contentHash:"hash-new",buildMode:"ai-full" as const,notes:[],createdAt:now,frozenArtifact:frozen}],
  };
  const visibleEvaluation={accuracy:92,evidence:92,riskCoverage:90,completeness:92,safety:"PASS" as const,averageCost:0,averageLatencyMs:1,notes:[],failures:[],rubricScore:92,verifiedRubricCoverage:100,unverifiedCriterionIds:[],criterionScores:[{criterionId:"CONTENT",score:92,pass:true,verificationStatus:"verified" as const,evidence:["visible"],gaps:[],testCaseIds:["V1"]}],caseScores:[]};
  return {
    id:"mission",name:"Holdout",objectType:"document",department:"test",goal:"提升核心内容",problemStatement:"",desiredOutcome:"",
    evolutionCommand:"让内容更完整",protectedItems:["事实"],editableItems:["表达"],metrics:[],
    sourceArtifacts:[{id:"source",name:"source.md",role:"target",artifactKind:"document",mimeType:"text/markdown",size:20,extension:"md",inputMode:"paste",parseStatus:"ready",textContent:"安装完成。缺少验证与回滚。",textExcerpt:"安装完成",structure:[],warnings:[],createdAt:now}],
    inputClarifications:[],commandHistory:[],supplementalValidationEvidence:[],adviceLedger:[],
    acceptanceRubric:[{id:"CONTENT",title:"内容闭环",requirement:"安装、验证与回滚完整",source:"user-command",weight:100,hardGate:true,judgeType:"llm",validationMethod:executionMode==="external-runner"?"executable-test":"semantic-judge",minScore:80,evidenceExpected:["验证","回滚"],protectedConstraint:false,artifactIds:["source"],category:"outcome"}],
    acceptanceRubricState:{status:"ready",summary:"ready",version:1,weightTotal:100,uncoveredCriterionIds:[],warnings:[],confirmedAt:now},
    evalSuite:[{id:"V1",title:"可见闭环",input:"检查闭环",expected:["验证","回滚"],tags:[],hidden:false,criterionIds:["CONTENT"],executionMode,evidenceScope:"product-behavior"}],
    hiddenEvalSuite:[{id:"H1",title:"隐藏闭环",input:"隐藏检查",expected:["验证","回滚"],tags:[],hidden:true,criterionIds:["CONTENT"],executionMode,evidenceScope:"product-behavior"}],
    baselineRun:{id:"baseline",status:"completed",suiteName:"Core",totalCases:1,runs:[{testCaseId:"V1",output:"原版缺少验证与回滚",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}],result:{accuracy:70,evidence:70,riskCoverage:80,completeness:70,safety:"PASS",averageCost:0,averageLatencyMs:1,notes:[],failures:["缺闭环"],rubricScore:70,verifiedRubricCoverage:100,unverifiedCriterionIds:[],criterionScores:[{criterionId:"CONTENT",score:70,pass:false,verificationStatus:"verified",evidence:["visible"],gaps:["缺闭环"],testCaseIds:["V1"]}],caseScores:[]}},
    problems:[],candidates:[candidate],selectedCandidateIds:["C1"],lessons:[],nextQueue:[],versions:[],outputArtifacts:[],appliedPatches:[],searchAppliedPatches:[],evolutionArchive:[],roundHistory:[],
    experimentRun:{id:"experiment-r1-server",status:"completed",winnerId:"C1",candidateResults:[{candidateId:"C1",evaluation:visibleEvaluation,runs:[{testCaseId:"V1",output:"visible pass",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}],artifactSnapshots:candidate.artifactSnapshots,experimentStage:"finalist"}],summary:"visible experiment complete"},
    validationRun:{id:"validation",status:"idle",checks:[],runs:[],baselineRuns:[]},
    artifactAcceptance:{id:"acceptance",status:"idle",overallScore:0,coverageScore:0,integrityScore:0,pairwiseScore:0,hardGatePass:false,results:[],attempts:0,maxRepairAttempts:3,summary:""},
    release:{status:"idle",trafficPercent:0,healthy:true,kpis:[],history:[],evidenceMode:"simulation"},
    targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"},experimentPolicy:{},aiProfile:{},
    gates:[{id:"target-ready",label:"Target Ready",status:"approved",approvedAt:now},{id:"experiment-ready",label:"Experiment Ready",status:"approved",approvedAt:now},{id:"artifact-ready",label:"Artifact Ready",status:"pending"},{id:"release-ready",label:"Release Ready",status:"pending"}],
    stage:"experiment",version:"V1",currentVersionId:"V1",updatedAt:now,
    campaign:{status:"running",executionMode:"auto-rounds",currentRound:0,noImprovementRounds:0,candidateCount:2,searchMode:"focused",parentStrategy:"champion-only",eliteCount:2,exploreRatio:0.3,estimatedCost:0,autoApproveOfflineExperiment:true,stopCriteria:{maxRounds:3,patienceRounds:2,minImprovement:1,stopWhenAcceptanceMet:true,stopOnSafetyFailure:true,stopWhenMetricTargetsMet:false},schedule:{enabled:false,mode:"manual",intervalMinutes:60,hour:8,minute:0,daysOfWeek:[]},checkpoint:{round:1,completedPhase:"experiment",at:now}},
  } as unknown as EvolveProject;
}

function semanticPorts(baselineScore=82,candidateScore=92){
  const currentCases:string[]=[]; const candidateCases:string[]=[];
  let reviewPayload:unknown;
  const ports:ServerHoldoutPorts={
    current:{
      executeSemanticBatch:async({testCases}:{testCases:EvolveProject["hiddenEvalSuite"]})=>{currentCases.push(...testCases.map((item)=>item.id));return {results:testCases.map((item)=>({testCaseId:item.id,output:"当前版本 Hidden 同卷证据",trace:[]}))};},
      judge:async()=>judged(baselineScore),
    },
    candidate:{
      executeSemanticBatch:async({testCases}:{testCases:EvolveProject["hiddenEvalSuite"]})=>{candidateCases.push(...testCases.map((item)=>item.id));return {results:testCases.map((item)=>({testCaseId:item.id,output:"Candidate Hidden 同卷证据",trace:[]}))};},
      judge:async()=>judged(candidateScore),
    },
    releaseReview:async(payload:unknown)=>{reviewPayload=payload;return {recommendation:"release" as const,summary:"release",reasons:[],risks:[],requiredChecks:[]};},
  };
  return {ports,currentCases,candidateCases,reviewPayload:()=>reviewPayload};
}

it.each([90,95])("blocks a cached evidence-only candidate with a known Visible goal failure before any external work (%s)",async score=>{
  const p=fixture(),io=semanticPorts();p.experimentPolicy.winnerGoalScope="all-user-goals-v1";
  p.acceptanceRubric.push({...p.acceptanceRubric[0]!,id:"FORMAT",source:"system-integrity",protectedConstraint:true});
  p.evalSuite.push({...p.evalSuite[0]!,id:"V2",criterionIds:["FORMAT"]});
  const baseline=p.baselineRun.result!;baseline.criterionScores![0]={...baseline.criterionScores![0]!,score:95,pass:true};
  const result=p.experimentRun.candidateResults[0]!;result.evaluation.criterionScores![0]!.score=score;
  result.evaluation.criterionScores!.push({...result.evaluation.criterionScores![0]!,criterionId:"FORMAT",verificationStatus:"partial",testCaseIds:["V2"]});
  p.experimentRun.winnerId=undefined;p.experimentRun.pendingEvidenceCandidateId="C1";
  p.experimentRun.comparisonSuite=structuredClone(p.evalSuite);p.experimentRun.comparisonBaseline=structuredClone(p.baselineRun);
  // A later mutable projection must not erase the stored comparison that caused rejection.
  p.evalSuite[0]!.id="later-case";p.baselineRun.result!.criterionScores![0]!.score=50;
  p.validationRun=ValidationRunSchema.parse({...p.validationRun,status:"completed",recommendation:"hold",summary:"Historical measured rejection remains intact",runs:[{testCaseId:"H1",output:"existing negative evidence",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}]});
  const historical=structuredClone(p.validationRun);
  const read=vi.fn(),review=vi.fn();io.ports.readArtifactFingerprint=read;io.ports.releaseReview=review;
  const out=await runServerHoldout(p,io.ports);
  expect(out.control).toBe("stop");expect(out.project.campaign.status).toBe("paused");expect(out.reason).toContain("visible-admission-blocked");
  expect(io.currentCases).toEqual([]);expect(io.candidateCases).toEqual([]);expect(read).not.toHaveBeenCalled();expect(review).not.toHaveBeenCalled();
  expect(out.project.validationRun).toEqual(historical);expect(p.validationRun).toEqual(historical);
});

function addLimitedProtection(project:EvolveProject,ports:ServerHoldoutPorts){
  project.acceptanceRubric.push({...project.acceptanceRubric[0]!,id:"PROTECT",title:"保留交互",protectedConstraint:true});
  project.hiddenEvalSuite.push({...project.hiddenEvalSuite[0]!,id:"H2",criterionIds:["PROTECT"],tags:["source-grounded-html-assertions"]});
  for(const arm of ["current","candidate"] as const){
    const judge=ports[arm].judge;
    ports[arm].judge=async(payload)=>{
      const result=await judge(payload);
      return {...result,criteria:[...result.criteria!,{criterionId:"PROTECT",score:95,pass:true,evidence:["search smoke"],gaps:[],testCaseIds:["H2"]}]};
    };
  }
}

describe("server hidden holdout",()=>{
  it("routes a proven content failure to repair while keeping preservation evidence unknown",async()=>{
    const project=fixture();
    const setup=semanticPorts(82,50);
    addLimitedProtection(project,setup.ports);
    const review=vi.fn(setup.ports.releaseReview);setup.ports.releaseReview=review;
    const outcome=await runServerHoldout(project,setup.ports);
    expect(outcome).toMatchObject({control:"continue",readyForArtifactAcceptance:true,evidenceIncomplete:true});
    expect(outcome.validation.recommendation).toBe("hold");
    expect(outcome.validation.evaluation?.criterionScores).toContainEqual(expect.objectContaining({criterionId:"CONTENT",pass:false,verificationStatus:"verified"}));
    expect(outcome.validation.evaluation?.criterionScores).toContainEqual(expect.objectContaining({criterionId:"PROTECT",pass:false,verificationStatus:"partial"}));
    expect(outcome.project.campaign.checkpoint?.completedPhase).toBe("validation");
    expect(review).not.toHaveBeenCalled();
    expect(hasServerFrozenValidationCheckpoint(project)).toBe(true);
    expect(hasServerFrozenValidationCheckpoint(outcome.project)).toBe(true);
    expect(hasServerFrozenValidationCheckpoint({...outcome.project,goal:"changed contract"})).toBe(false);
    expect(hasServerFrozenValidationCheckpoint({...project,targetConnection:{...project.targetConnection,adapter:"http"}})).toBe(false);
  });
  it("supplies the Hidden current Judge with its complete existing measured observation",async()=>{
    const p=fixture();
    const run:TargetRunResult={testCaseId:"H1",output:"COMPLETE CURRENT DOCUMENT TEXT OBSERVATION\n"+"measured text ".repeat(1000)+"HIDDEN-TAIL",
      cost:0,latencyMs:0,verificationStatus:"verified",artifactHash:"a".repeat(64),
      trace:[{id:"current-document-text-H1",stage:"current-document-text-evidence",status:"pass",summary:"document read"}]};
    const judge=vi.fn(async()=>judged(82));
    const result=await judgeServerCurrentArtifactSuite(p,p.hiddenEvalSuite,[run],{
      executeSemanticBatch:async()=>({results:[]}),judge,
    });
    expect(JSON.stringify(judge.mock.calls)).toContain("HIDDEN-TAIL");
    expect(result.measuredReviewVersion).toBe("server-measured-document-review-v4-declared-browser-assertions");
  });
  it("keeps repeated current-version semantic evidence unverified",async()=>{
    const project=fixture();
    const runs=await executeServerCurrentArtifactSuite(project,project.hiddenEvalSuite,{
      executeSemanticBatch:async()=>({results:[
        {testCaseId:"H1",output:"passed",trace:[]},
        {testCaseId:"H1",output:"failed",trace:[]},
      ]}),
      judge:async()=>judged(90),
    });
    expect(runs[0]).toMatchObject({testCaseId:"H1",verificationStatus:"unverified"});
    expect(runs[0]?.output).toContain("重复结果");
  });

  it("executes only the frozen hidden paper and persists exact Candidate evidence",async()=>{
    const setup=semanticPorts();
    const outcome=await runServerHoldout(fixture(),setup.ports,{now:()=> "2026-09-20T14:30:00.000Z"});
    expect(setup.currentCases).toEqual(["H1"]);
    expect(setup.candidateCases).toEqual(["H1"]);
    expect(outcome.validation.validationMode).toBe("full");
    expect(outcome.validation.recommendation).toBe("release");
    expect(outcome.validation.checks.find(check=>check.label==="关键能力回归")?.status).toBe("pass");
    expect(outcome.validation.evidenceFingerprint).toBeTruthy();
    expect(outcome.project.campaign.checkpoint).toMatchObject({round:1,completedPhase:"validation"});
    expect(outcome.validation.versionSnapshot?.artifacts[0]?.frozenArtifact?.blobId).toBe("blob-new");
    expect(outcome.project.candidates[0]?.artifactSnapshots[0]?.id).toBe("snap-C1");
    const reviewText=JSON.stringify(setup.reviewPayload());
    expect(reviewText).not.toContain("H1");
    expect(reviewText).not.toContain("隐藏闭环");
  });

  it("pauses a post-Winner hidden contract that overlaps visible test IDs before execution",async()=>{
    const project=fixture();
    project.hiddenEvalSuite=[{...project.hiddenEvalSuite[0]!,id:"V1"}];
    const setup=semanticPorts();
    const outcome=await runServerHoldout(project,setup.ports);
    expect(outcome.control).toBe("stop");
    expect(outcome.reason).toContain("holdout-contract-pending");
    expect(outcome.project.campaign.checkpoint).toMatchObject({round:1,completedPhase:"experiment"});
    expect(setup.currentCases).toEqual([]);
    expect(setup.candidateCases).toEqual([]);
  });

  it("preserves the same Candidate and pauses when real Runner evidence is missing",async()=>{
    const project=fixture("external-runner");
    const releaseReview=vi.fn();
    const unverified=(testCaseId:string):TargetRunResult=>({testCaseId,output:"UNVERIFIED：Sandbox unavailable",latencyMs:0,cost:0,verificationStatus:"unverified",trace:[]});
    const outcome=await runServerHoldout(project,{
      current:{executeSemanticBatch:async()=>({results:[]}),executeExternalBatch:async({testCases})=>testCases.map((item)=>unverified(item.id)),judge:async()=>{throw new Error("judge should not run");}},
      candidate:{executeSemanticBatch:async()=>({results:[]}),executeExternalBatch:async({testCases})=>testCases.map((item)=>unverified(item.id)),judge:async()=>{throw new Error("judge should not run");}},
      releaseReview,
    });
    expect(outcome.control).toBe("stop");
    expect(outcome.reason).toContain("holdout-evidence-pending");
    expect(outcome.validation.recommendation).toBe("hold");
    expect(outcome.validation.checks.find(check=>check.label==="关键能力回归")).toMatchObject({
      status:"warning",detail:expect.stringContaining("不能认定无回归"),
    });
    expect(releaseReview).not.toHaveBeenCalled();
    expect(outcome.project.candidates[0]?.artifactSnapshots[0]?.id).toBe("snap-C1");
    expect(outcome.project.campaign.checkpoint).toMatchObject({round:1,completedPhase:"experiment"});
    expect(outcome.project.versions).toHaveLength(0);
  });

  it("fails closed when independent Hidden Judge is unavailable after execution",async()=>{
    const project=fixture();
    const outcome=await runServerHoldout(project,{
      current:{executeSemanticBatch:async({testCases})=>({results:testCases.map((item)=>({testCaseId:item.id,output:"baseline evidence",trace:[]}))}),judge:async()=>{throw new Error("judge unavailable");}},
      candidate:{executeSemanticBatch:async({testCases})=>({results:testCases.map((item)=>({testCaseId:item.id,output:"candidate evidence",trace:[]}))}),judge:async()=>judged(92)},
      releaseReview:async()=>({recommendation:"release",summary:"release",reasons:[],risks:[],requiredChecks:[]}),
    });
    expect(outcome.control).toBe("stop");
    expect(outcome.reason).toContain("holdout-judge-pending");
    expect(outcome.validation.runs).toHaveLength(1);
    expect(outcome.project.candidates[0]?.artifactSnapshots[0]?.id).toBe("snap-C1");
  });

  it.each(["current","candidate"] as const)("retains the fulfilled independent assessment when %s Judge fails",async(failingArm)=>{
    const setup=semanticPorts();
    setup.ports[failingArm].judge=async()=>{throw new Error("temporary Judge outage");};
    const review=vi.fn(setup.ports.releaseReview);setup.ports.releaseReview=review;
    const outcome=await runServerHoldout(fixture(),setup.ports);
    expect(outcome.control).toBe("stop");expect(outcome.readyForArtifactAcceptance).toBe(false);
    expect(outcome.validation.status).toBe("failed");expect(outcome.evidenceIncomplete).toBe(true);
    expect(outcome.validation.runs).toHaveLength(1);expect(outcome.validation.baselineRuns).toHaveLength(1);
    const fulfilled=failingArm==="current"?outcome.validation.evaluation:outcome.validation.baselineEvaluation;
    const missing=failingArm==="current"?outcome.validation.baselineEvaluation:outcome.validation.evaluation;
    expect(fulfilled).toMatchObject({accuracy:failingArm==="current"?92:82});expect(missing).toBeUndefined();
    expect(ValidationRunSchema.parse(outcome.validation)).toMatchObject({status:"failed",candidateId:"C1"});
    expect(outcome.validation.baselineSuiteIds).toEqual(["H1"]);
    expect(outcome.validation.baselineContextFingerprint).toBeTruthy();
    expect(outcome.validation.baselineObservedAt).toEqual(expect.any(Number));
    expect(review).not.toHaveBeenCalled();expect(outcome.project.versions).toHaveLength(0);
  });

  it("awaits the other independent assessment before persisting the partial result",async()=>{
    const setup=semanticPorts();let finish!:()=>void;
    const candidateJudge=vi.fn(()=>new Promise<EvaluateAiResult>(resolve=>{finish=()=>resolve(judged(92));}));
    setup.ports.current.judge=async()=>{throw new Error("current Judge unavailable");};
    setup.ports.candidate.judge=candidateJudge;
    const finished=vi.fn();
    const pending=runServerHoldout(fixture(),setup.ports).then(result=>{finished();return result;});
    await vi.waitFor(()=>expect(candidateJudge).toHaveBeenCalledOnce());
    expect(finished).not.toHaveBeenCalled();finish();
    const result=await pending;
    expect(result.validation.evaluation?.accuracy).toBe(92);
    expect(result.validation.baselineEvaluation).toBeUndefined();
    expect(result.readyForArtifactAcceptance).toBe(false);
  });

  it("does not renew the current-version observation time after slow judging and review",async()=>{
    vi.useFakeTimers({toFake:["Date"]});
    const observed=Date.parse("2026-10-08T00:00:00.000Z");vi.setSystemTime(observed);
    try{
      const setup=semanticPorts();
      setup.ports.current.judge=async()=>{vi.setSystemTime(observed+60_000);return judged(82);};
      setup.ports.releaseReview=async()=>{vi.setSystemTime(observed+120_000);return {recommendation:"release",summary:"release",reasons:[],risks:[],requiredChecks:[]};};
      const outcome=await runServerHoldout(fixture(),setup.ports);
      expect(outcome.validation.baselineObservedAt).toBe(observed);
      expect(Date.now()).toBe(observed+120_000);
    }finally{vi.useRealTimers();}
  });

  it("keeps completed Holdout evidence when Release Review is unavailable",async()=>{
    const setup=semanticPorts();
    setup.ports.releaseReview=async()=>{throw new Error("review unavailable");};
    const outcome=await runServerHoldout(fixture(),setup.ports);
    expect(outcome.control).toBe("stop");
    expect(outcome.reason).toContain("holdout-review-pending");
    expect(outcome.validation.status).toBe("completed");
    expect(outcome.validation.runs).toHaveLength(1);
    expect(outcome.validation.baselineRuns).toHaveLength(1);
    expect(outcome.validation.recommendation).toBe("hold");
  });

it("holds Release when a non-Hard Criterion has no independent judgment",async()=>{
    const project=fixture();
    project.acceptanceRubric.push({...project.acceptanceRubric[0]!,id:"SOFT",title:"可用性",hardGate:false,weight:10});
    project.hiddenEvalSuite.push({...project.hiddenEvalSuite[0]!,id:"H2",title:"隐藏可用性",criterionIds:["SOFT"]});
    const setup=semanticPorts();
    const review=vi.fn(setup.ports.releaseReview);
    setup.ports.releaseReview=review;
    const outcome=await runServerHoldout(project,setup.ports);
    expect(outcome.validation.recommendation).toBe("hold");
    expect(outcome.validation.checks).toContainEqual(expect.objectContaining({label:"待真实验证 · 可用性",status:"warning"}));
    expect(outcome.validation.checks.find((check)=>check.label==="Project-specific Rubric")?.status).toBe("warning");
    expect(review).not.toHaveBeenCalled();
  });
  it("detects same-paper regression and skips optimistic Release Review",async()=>{
    const setup=semanticPorts(96,90);
    const review=vi.fn(setup.ports.releaseReview);
    setup.ports.releaseReview=review;
    const outcome=await runServerHoldout(fixture(),setup.ports);
    expect(outcome.validation.checks.find((check)=>check.label==="关键能力回归")?.status).toBe("fail");
    expect(outcome.validation.recommendation).toBe("hold");
    expect(review).not.toHaveBeenCalled();
    expect(outcome.readyForArtifactAcceptance).toBe(true);
  });
});


describe("server Hidden assessment recovery",()=>{
  const artifactBinding="a".repeat(64);
  it("retains an old exact-file rejection without rerolling either Judge",async()=>{
    vi.useFakeTimers({toFake:["Date"]});
    const observed=Date.parse("2026-10-08T00:00:00.000Z");vi.setSystemTime(observed);
    try{
      const project=fixture(),first=semanticPorts(82,50);
      addLimitedProtection(project,first.ports);
      const executeCurrent=first.ports.current.executeSemanticBatch!;
      first.ports.current.executeSemanticBatch=async args=>{
        const response=await executeCurrent(args);
        return {...response,results:response.results.map(row=>row.testCaseId==="H2"?{...row,output:"UNVERIFIED: same-paper baseline comparison unavailable"}:row)};
      };
      const measured=await runServerHoldout(project,{...first.ports,readArtifactFingerprint:async()=>artifactBinding});
      expect(measured.validation.baselineRuns.find(row=>row.testCaseId==="H2")?.verificationStatus).toBe("unverified");
      // Simulate the old controller's completed-but-paused Experiment checkpoint.
      const prior={...measured.project,campaign:{...measured.project.campaign,checkpoint:project.campaign.checkpoint}};
      vi.setSystemTime(observed+60*60_000);
      const setup=semanticPorts(),currentJudge=vi.fn(setup.ports.current.judge),candidateJudge=vi.fn(setup.ports.candidate.judge),review=vi.fn(setup.ports.releaseReview);
      const outcome=await runServerHoldout(prior,{...setup.ports,readArtifactFingerprint:async()=>artifactBinding,
        current:{...setup.ports.current,judge:currentJudge},candidate:{...setup.ports.candidate,judge:candidateJudge},releaseReview:review});
      expect(outcome).toMatchObject({control:"continue",readyForArtifactAcceptance:true,evidenceIncomplete:true});
      expect(outcome.validation.evaluation).toEqual(measured.validation.evaluation);
      expect(outcome.validation.baselineEvaluation).toEqual(measured.validation.baselineEvaluation);
      expect(outcome.validation.baselineObservedAt).toBe(observed);
      expect(setup.currentCases).toEqual([]);expect(setup.candidateCases).toEqual([]);
      expect(currentJudge).not.toHaveBeenCalled();expect(candidateJudge).not.toHaveBeenCalled();expect(review).not.toHaveBeenCalled();
      const damaged=structuredClone(prior);damaged.validationRun.runs[0]!.output+=" changed";
      const guarded=semanticPorts();
      const stopped=await runServerHoldout(damaged,{...guarded.ports,readArtifactFingerprint:async()=>artifactBinding});
      expect(stopped.control).toBe("stop");expect(stopped.reason).toContain("evidence-identity-pending");
      expect(guarded.currentCases).toEqual([]);expect(guarded.candidateCases).toEqual([]);
      expect(stopped.validation.evaluation).toEqual(measured.validation.evaluation);
      const changed=semanticPorts();
      await runServerHoldout(prior,{...changed.ports,readArtifactFingerprint:async()=>"b".repeat(64)});
      expect(changed.currentCases).toEqual(["H1","H2"]);expect(changed.candidateCases).toEqual(["H1","H2"]);
    }finally{vi.useRealTimers();}
  });
  async function paused(failingArm:"current"|"candidate"|"review"="current",partial=false){
    const setup=semanticPorts();
    const ports={...setup.ports,readArtifactFingerprint:vi.fn(async()=>artifactBinding)};
    if(failingArm==="review")ports.releaseReview=async()=>{throw Error("temporary review outage");};
    else ports[failingArm].judge=async()=>{throw Error("temporary Judge outage");};
    if(partial)ports.current.executeSemanticBatch=async({testCases})=>({results:testCases.map(item=>({testCaseId:item.id,output:"Observed excerpt; UNVERIFIED outside supplied evidence",trace:[]}))});
    const prior=await runServerHoldout(fixture(),ports);
    return prior.project;
  }
  it.each(["current","candidate","review"] as const)("resumes only the missing %s assessment from exact paired evidence",async(failingArm)=>{
    const p=await paused(failingArm);
    const setup=semanticPorts();
    const currentExecute=vi.fn(setup.ports.current.executeSemanticBatch);
    const candidateExecute=vi.fn(setup.ports.candidate.executeSemanticBatch);
    const currentJudge=vi.fn(setup.ports.current.judge);
    const candidateJudge=vi.fn(setup.ports.candidate.judge);
    const review=vi.fn(setup.ports.releaseReview);
    const result=await runServerHoldout(p,{
      ...setup.ports,readArtifactFingerprint:async()=>artifactBinding,
      current:{...setup.ports.current,executeSemanticBatch:currentExecute,judge:currentJudge},
      candidate:{...setup.ports.candidate,executeSemanticBatch:candidateExecute,judge:candidateJudge},releaseReview:review,
    });
    expect(result.readyForArtifactAcceptance).toBe(true);
    expect(currentExecute).not.toHaveBeenCalled();expect(candidateExecute).not.toHaveBeenCalled();
    expect(currentJudge).toHaveBeenCalledTimes(failingArm==="current"?1:0);
    expect(candidateJudge).toHaveBeenCalledTimes(failingArm==="candidate"?1:0);
    expect(review).toHaveBeenCalledOnce();
    expect(result.validation.runs).toEqual(p.validationRun.runs);
    expect(result.validation.baselineRuns).toEqual(p.validationRun.baselineRuns);
    expect(result.validation.baselineObservedAt).toBe(p.validationRun.baselineObservedAt);
  });
  it.each([
    ["legacy binding",(p:EvolveProject)=>{p.validationRun.executionArtifactFingerprint=undefined;}],
    ["missing record binding",(p:EvolveProject)=>{p.validationRun.executionEvidenceFingerprint=undefined;}],
    ["changed answer text",(p:EvolveProject)=>{p.validationRun.runs[0]!.output="altered evidence";}],
    ["expired observation",(p:EvolveProject)=>{p.validationRun.baselineObservedAt=Date.now()-10*60_000;}],
    ["future observation",(p:EvolveProject)=>{p.validationRun.baselineObservedAt=Date.now()+60_000;}],
    ["missing observation",(p:EvolveProject)=>{p.validationRun.baselineObservedAt=undefined;}],
    ["changed paper",(p:EvolveProject)=>{p.hiddenEvalSuite=[{...p.hiddenEvalSuite[0]!,input:"changed hidden input"}];}],
    ["changed Candidate",(p:EvolveProject)=>{p.candidates[0]!.artifactSnapshots[0]!.content+=" changed";}],
    ["wrong answer identity",(p:EvolveProject)=>{p.validationRun.runs=[{...p.validationRun.runs[0]!,testCaseId:"another"}];}],
    ["duplicate answers",(p:EvolveProject)=>{p.validationRun.baselineRuns.push(p.validationRun.baselineRuns[0]!);}],
    ["unavailable execution",(p:EvolveProject)=>{p.validationRun.runs[0]!.verificationStatus="unverified";}],
    ["failed execution",(p:EvolveProject)=>{p.validationRun.baselineRuns[0]!.error="execution failed";}],
    ["empty observation",(p:EvolveProject)=>{p.validationRun.runs[0]!.output="";}],
    ["wrong round",(p:EvolveProject)=>{p.validationRun.id="validation-server-r2";}],
    ["non-artifact target",(p:EvolveProject)=>{p.targetConnection={...p.targetConnection,adapter:"http"};}],
  ] as const)("remeasures both sheets for %s",async(_label,change)=>{
    const p=await paused();change(p);
    const setup=semanticPorts();
    await runServerHoldout(p,{...setup.ports,readArtifactFingerprint:async()=>artifactBinding});
    expect(setup.currentCases).toEqual(["H1"]);expect(setup.candidateCases).toEqual(["H1"]);
  });
  it.each(["changed","missing","invalid","read-error","scoring-route"] as const)("remeasures for a %s physical/configuration read",async(kind)=>{
    const p=await paused();const setup=semanticPorts();
    await runServerHoldout(p,{...setup.ports,scoringRouteFingerprint:kind==="scoring-route"?"different":undefined,
      readArtifactFingerprint:kind==="missing"?undefined:async()=>{
        if(kind==="read-error")throw Error("read unavailable");
        return kind==="invalid"?"not-a-sha":kind==="changed"?"b".repeat(64):artifactBinding;
      },
    });
    expect(setup.currentCases).toEqual(["H1"]);expect(setup.candidateCases).toEqual(["H1"]);
  });
  it("retains the observation time and fulfilled assessment across repeated Judge outages",async()=>{
    const p=await paused();const setup=semanticPorts();
    setup.ports.current.judge=async()=>{throw Error("still unavailable");};
    const candidateJudge=vi.fn(setup.ports.candidate.judge);setup.ports.candidate.judge=candidateJudge;
    const result=await runServerHoldout(p,{...setup.ports,readArtifactFingerprint:async()=>artifactBinding});
    expect(result.control).toBe("stop");expect(result.validation.baselineObservedAt).toBe(p.validationRun.baselineObservedAt);
    expect(result.validation.executionArtifactFingerprint).toBe(artifactBinding);
    expect(result.validation.evaluation).toEqual(p.validationRun.evaluation);expect(candidateJudge).not.toHaveBeenCalled();
    expect(setup.currentCases).toEqual([]);expect(setup.candidateCases).toEqual([]);
    expect(ValidationRunSchema.parse(result.validation).executionArtifactFingerprint).toBe(artifactBinding);
  });
  it("rejudges an incomplete or demo assessment without rerunning valid execution",async()=>{
    const p=await paused();p.validationRun.evaluation={...p.validationRun.evaluation!,demoJudged:true};
    const setup=semanticPorts();const candidateJudge=vi.fn(setup.ports.candidate.judge);setup.ports.candidate.judge=candidateJudge;
    const result=await runServerHoldout(p,{...setup.ports,readArtifactFingerprint:async()=>artifactBinding});
    expect(result.readyForArtifactAcceptance).toBe(true);expect(candidateJudge).toHaveBeenCalledOnce();
    expect(setup.currentCases).toEqual([]);expect(setup.candidateCases).toEqual([]);
  });
  it("rejudges a legacy truncated-context assessment without rebuilding or rerunning valid observations",async()=>{
    const p=await paused();delete p.validationRun.evaluation!.measuredReviewVersion;
    const setup=semanticPorts();const candidateJudge=vi.fn(setup.ports.candidate.judge);setup.ports.candidate.judge=candidateJudge;
    const result=await runServerHoldout(p,{...setup.ports,readArtifactFingerprint:async()=>artifactBinding});
    expect(result.readyForArtifactAcceptance).toBe(true);expect(candidateJudge).toHaveBeenCalledOnce();
    expect(setup.currentCases).toEqual([]);expect(setup.candidateCases).toEqual([]);
  });
  it("remeasures both sheets when the injected physical execution policy changes",async()=>{
    const p=await paused(),setup=semanticPorts();
    const result=await runServerHoldout(p,{...setup.ports,readArtifactFingerprint:async()=>artifactBinding,executionRuntimeFingerprint:"new-physical-observations"});
    expect(result.readyForArtifactAcceptance).toBe(true);
    expect(setup.currentCases).toEqual(["H1"]);expect(setup.candidateCases).toEqual(["H1"]);
    expect(result.validation.baselineContextFingerprint).not.toBe(p.validationRun.baselineContextFingerprint);
  });
  it("keeps bounded partial evidence partial when resuming a missing assessment",async()=>{
    const p=await paused("current",true);
    const setup=semanticPorts();
    const result=await runServerHoldout(p,{...setup.ports,readArtifactFingerprint:async()=>artifactBinding});
    expect(result.validation.baselineRuns[0]!.verificationStatus).toBe("partial");
    expect(result.readyForArtifactAcceptance).toBe(false);
    expect(setup.currentCases).toEqual([]);expect(setup.candidateCases).toEqual([]);
  });
  it.each(["execution","judging"] as const)("pauses if physical bytes change during %s",async(phase)=>{
    const setup=semanticPorts();let reads=0;
    const result=await runServerHoldout(fixture(),{...setup.ports,readArtifactFingerprint:async()=>{
      reads++;return reads>=(phase==="execution"?2:3)?"b".repeat(64):artifactBinding;
    }});
    expect(result.readyForArtifactAcceptance).toBe(false);expect(result.validation.status).toBe("failed");
    expect(result.validation.executionArtifactFingerprint).toBeUndefined();
    expect(result.reason).toContain("字节已变化");
    expect(result.validation.runs).toHaveLength(1);expect(result.validation.baselineRuns).toHaveLength(1);
  });

  it("resumes after JSON storage removes undefined optional evidence fields",async()=>{
    const first=semanticPorts();
    first.ports.current.executeSemanticBatch=async({testCases})=>({results:testCases.map(item=>({
      testCaseId:item.id,output:"actual current evidence",trace:[{id:"read",stage:"read",summary:"read source",status:"info" as const,detail:undefined}],
    }))});
    first.ports.candidate.judge=async()=>{throw Error("temporary Judge outage");};
    const pausedResult=await runServerHoldout(fixture(),{...first.ports,readArtifactFingerprint:async()=>artifactBinding});
    const p={...pausedResult.project,validationRun:ValidationRunSchema.parse(JSON.parse(JSON.stringify(pausedResult.validation)))};
    const setup=semanticPorts();
    const result=await runServerHoldout(p,{...setup.ports,readArtifactFingerprint:async()=>artifactBinding});
    expect(result.readyForArtifactAcceptance).toBe(true);
    expect(setup.currentCases).toEqual([]);expect(setup.candidateCases).toEqual([]);
  });

  it.each([[10*60_000-1,true],[10*60_000,false],[-1,false]] as const)("checks the unchanged observation at elapsed %s ms",async(elapsed,reusable)=>{
    vi.useFakeTimers({toFake:["Date"]});
    const observed=Date.parse("2026-10-08T00:00:00.000Z");vi.setSystemTime(observed);
    try{
      const p=await paused();vi.setSystemTime(observed+elapsed);
      const setup=semanticPorts();
      const result=await runServerHoldout(p,{...setup.ports,readArtifactFingerprint:async()=>artifactBinding});
      expect(setup.currentCases).toHaveLength(reusable?0:1);
      expect(setup.candidateCases).toHaveLength(reusable?0:1);
      expect(result.validation.baselineObservedAt).toBe(reusable?observed:observed+elapsed);
    }finally{vi.useRealTimers();}
  });

});
