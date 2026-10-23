import {describe,expect,it,vi} from "vitest";
import {InputUnderstandingSchema,type Candidate,type EvolveProject} from "@evolution/contracts";
import {campaignGoalSatisfied,campaignStopReason,completeAutonomousMission,evidenceFingerprint,materializeAcceptedChampionPackage,reconcileAcceptedOfflineChampion} from "@evolution/core";
import {runServerArtifactAcceptance} from "./server-artifact-acceptance";
import {buildServerHarnessPlan} from "./server-plan";

function fixture(pass=true){
  const now="2026-09-20T14:00:00.000Z";
  const frozen={sourceArtifactId:"source",snapshotHash:"hash",blobId:"blob",name:"a.md",mimeType:"text/markdown",sha256:"sha",size:3,verifiedAt:now,checks:["ok"],limitations:[]};
  const candidate={id:"C1",name:"c",patches:[],notes:[],status:"winner",artifactBuildStatus:"ready",artifactSnapshots:[{id:"snap-C1",sourceArtifactId:"source",name:"a.md",mimeType:"text/markdown",content:"new",contentHash:"hash",buildMode:"ai-full",notes:[],createdAt:now,frozenArtifact:frozen}]} as unknown as Candidate;
  const project={
    id:"mission",name:"Gate F",objectType:"document",department:"test",goal:"g",problemStatement:"",desiredOutcome:"",evolutionCommand:"e",protectedItems:[],editableItems:[],metrics:[],
    sourceArtifacts:[{id:"source",name:"a.md",role:"target",artifactKind:"document",mimeType:"text/markdown",size:3,extension:"md",inputMode:"paste",parseStatus:"ready",textContent:"old",textExcerpt:"old",structure:[],warnings:[],createdAt:now}],
    evalSuite:[{id:"V1",title:"visible",input:"check",expected:["ok"],tags:[],hidden:false,criterionIds:["CONTENT"],executionMode:"artifact-runtime",evidenceScope:"product-behavior"}],
    hiddenEvalSuite:[{id:"H1",title:"hidden",input:"check",expected:["ok"],tags:[],hidden:true,criterionIds:["CONTENT"],executionMode:"artifact-runtime",evidenceScope:"product-behavior"}],
    acceptanceRubric:[{id:"CONTENT",title:"内容",requirement:"通过",source:"user-command",weight:100,hardGate:true,judgeType:"llm",validationMethod:"semantic-judge",minScore:80,evidenceExpected:["ok"],protectedConstraint:false,artifactIds:["source"],category:"outcome"}],
    candidates:[candidate],selectedCandidateIds:["C1"],problems:[],lessons:[],nextQueue:[],versions:[],outputArtifacts:[],appliedPatches:[],searchAppliedPatches:[],evolutionArchive:[],roundHistory:[],inputClarifications:[],commandHistory:[],supplementalValidationEvidence:[],adviceLedger:[],
    baselineRun:{id:"b",status:"completed",suiteName:"Core",totalCases:1,runs:[],result:{accuracy:70,evidence:70,riskCoverage:70,completeness:70,safety:"PASS",averageCost:0,averageLatencyMs:1,notes:[],failures:[]}},
    experimentRun:{id:"e",status:"completed",winnerId:"C1",candidateResults:[]},
    validationRun:{id:"v",status:"completed",validationMode:"full",candidateId:"C1",recommendation:pass?"release":"hold",runs:[{testCaseId:"H1",output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}],baselineRuns:[{testCaseId:"H1",output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified"}],baselineEvaluation:{accuracy:70,evidence:70,riskCoverage:70,completeness:70,safety:"PASS",averageCost:0,averageLatencyMs:1,notes:[],failures:[]},baselineSuiteIds:["H1"],baselineContextFingerprint:"same-paper",baselineObservedAt:123456,checks:[],evaluation:{accuracy:pass?92:50,evidence:90,riskCoverage:90,completeness:pass?92:50,safety:"PASS",averageCost:0,averageLatencyMs:1,notes:[],failures:[],rubricScore:pass?92:50,verifiedRubricCoverage:100,unverifiedCriterionIds:[],criterionScores:[{criterionId:"CONTENT",score:pass?92:50,pass,verificationStatus:"verified",evidence:["hidden"],gaps:pass?[]:["still bad"],testCaseIds:["H1"]}]}},
    artifactAcceptance:{id:"a",status:"idle",overallScore:0,coverageScore:0,integrityScore:0,pairwiseScore:0,hardGatePass:false,results:[],attempts:0,maxRepairAttempts:2,summary:""},
    release:{status:"idle",trafficPercent:0,healthy:true,kpis:[],history:[],evidenceMode:"simulation"},
    targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"},experimentPolicy:{},aiProfile:{},
    gates:[{id:"target-ready",label:"Target",status:"approved"},{id:"experiment-ready",label:"Experiment",status:"approved"},{id:"artifact-ready",label:"Artifact",status:"pending"},{id:"release-ready",label:"Release",status:"pending"}],
    stage:"validation",version:"V1",currentVersionId:"V1",updatedAt:now,
    campaign:{status:"running",executionMode:"auto-rounds",currentRound:0,noImprovementRounds:0,candidateCount:2,parentStrategy:"champion-only",exploreRatio:0.3,eliteCount:2,estimatedCost:0,autoApproveOfflineExperiment:true,stopCriteria:{maxRounds:3,patienceRounds:2,minImprovement:1,stopWhenAcceptanceMet:true,stopOnSafetyFailure:true,stopWhenMetricTargetsMet:false},schedule:{enabled:false,mode:"manual",intervalMinutes:60,hour:8,minute:0,daysOfWeek:[]},checkpoint:{round:1,completedPhase:"validation",at:now}},
  } as unknown as EvolveProject;
  project.validationRun.evidenceFingerprint=evidenceFingerprint(project,candidate);
  return {project,candidate,frozen};
}

describe("server artifact acceptance",()=>{
  it("accepts exact frozen bytes and settles Search Champion/round",async()=>{
    const x=fixture(true);
    const outcome=await runServerArtifactAcceptance(x.project,{
      verifyFrozenArtifacts:async()=>({verified:[x.frozen],unavailable:[],failed:[]}),
      repairCandidate:async()=>{throw new Error("repair must not run");},
    },{now:()=> "2026-09-20T14:30:00.000Z"});
    expect(outcome.accepted).toBe(true);
    expect(outcome.project.artifactAcceptance.status).toBe("passed");
    expect(outcome.project.searchChampion?.candidate?.id).toBe("C1");
    expect(outcome.project.campaign.currentRound).toBe(1);
    expect(outcome.project.campaign.checkpoint).toBeUndefined();
    expect(outcome.project.gates.find((gate)=>gate.id==="artifact-ready")?.status).toBe("approved");
    expect(outcome.project.gates.find((gate)=>gate.id==="release-ready")?.status).toBe("ready");
    expect(campaignGoalSatisfied(outcome.project)).toBe(true);
    expect(campaignStopReason(outcome.project)).toContain("全部通过");

    expect(buildServerHarnessPlan(outcome.project).decision.action).toBe("package");
    const packaged={...outcome.project,outputArtifacts:materializeAcceptedChampionPackage(outcome.project,"2026-09-20T14:31:00.000Z")};
    expect(buildServerHarnessPlan(packaged).decision.action).toBe("distill");
    const learned={...packaged,lessons:[{id:"lesson",title:"经验",summary:"有效",reusable:true,effect:"改善",limit:"离线",trigger:[],method:[],validatedOn:["offline"],status:"lesson" as const}]};
    expect(buildServerHarnessPlan(learned).decision.action).toBe("next-queue");
    const queued={...learned,nextQueue:[{id:"next",title:"下一轮",reason:"继续",priority:"P1" as const,source:"lesson",suggestedMetrics:[]}]};
    const completePlan=buildServerHarnessPlan(queued);
    expect(completePlan.decision.action).toBe("complete");
    const completed=completeAutonomousMission(queued,{at:"2026-09-20T14:32:00.000Z",reason:completePlan.decision.reason});
    expect(completed.campaign.status).toBe("completed");
    expect(completed.campaign.checkpoint).toBeUndefined();
  });

  it("continues multi-round evolution after a verified S1 Champion when stopWhenAcceptanceMet=false",async()=>{
    const x=fixture(true);
    x.project.inputUnderstanding=InputUnderstandingSchema.parse({status:"ready",confidence:0.95});
    // Use a complete, three-criterion contract rather than the deliberately
    // minimal one-criterion unit fixture; the Planner must be allowed to advance.
    const content=x.project.acceptanceRubric[0]!;
    x.project.acceptanceRubric=[
      {...content,weight:60},
      {...content,id:"PROTECT",source:"protected-item",protectedConstraint:true,weight:20},
      {...content,id:"SYS-INTEGRITY",source:"system-integrity",protectedConstraint:true,weight:20},
    ];
    const ids=x.project.acceptanceRubric.map(c=>c.id);
    x.project.evalSuite[0]={...x.project.evalSuite[0]!,criterionIds:ids};
    x.project.hiddenEvalSuite[0]={...x.project.hiddenEvalSuite[0]!,criterionIds:ids};
    x.project.validationRun.evaluation!.criterionScores=ids.map(criterionId=>({
      criterionId,score:92,pass:true,verificationStatus:"verified",
      evidence:["H1 frozen observed"],gaps:[],testCaseIds:["H1"],
    }));
    x.project.validationRun.evidenceFingerprint=evidenceFingerprint(x.project,x.candidate);
    x.project.campaign.stopCriteria={
      ...x.project.campaign.stopCriteria,
      stopWhenAcceptanceMet:false,maxRounds:2,patienceRounds:3,stopWhenMetricTargetsMet:false,
    };
    const accepted=await runServerArtifactAcceptance(x.project,{
      verifyFrozenArtifacts:async()=>({verified:[x.frozen],unavailable:[],failed:[]}),
      repairCandidate:async()=>{throw new Error("unexpected repair");},
    },{now:()=> "2026-09-20T14:30:00.000Z"});
    expect(accepted.accepted).toBe(true);
    const first=accepted.project;
    expect(first.searchChampion?.versionLabel).toBe("S1");
    expect(first.roundHistory).toHaveLength(1);
    expect(first.campaign.currentRound).toBe(1);
    expect(campaignStopReason(first)).toBeUndefined();
    expect(buildServerHarnessPlan(first).decision.action).toBe("run-campaign");
    // A stale temporary checkpoint cannot accidentally package a candidate
    // before the full second Hidden and Gate F have run.
    const active={...first,campaign:{...first.campaign,
      checkpoint:{round:2,completedPhase:"problem" as const,at:first.updatedAt}}};
    expect(buildServerHarnessPlan(active).decision.action).not.toBe("package");
    // Boundaries stop the exploration and package only the already accepted
    // frozen Champion. This does not create a new version or rewrite its SHA.
    const exhausted={...first,campaign:{...first.campaign,currentRound:2}};
    expect(buildServerHarnessPlan(exhausted).decision.action).toBe("package");
    const patience={...first,campaign:{...first.campaign,noImprovementRounds:3}};
    expect(buildServerHarnessPlan(patience).decision.action).toBe("package");
    const evidencePause={...first,campaign:{...first.campaign,status:"paused" as const,
      stopReason:"[server-campaign-holdout-evidence-pending] missing evidence"}};
    expect(buildServerHarnessPlan(evidencePause).decision.action).not.toBe("package");
    const explicitStop={...first,campaign:{...first.campaign,stopCriteria:{
      ...first.campaign.stopCriteria,stopWhenAcceptanceMet:true,
    }}};
    expect(buildServerHarnessPlan(explicitStop).decision.action).toBe("package");
    expect(first.searchChampion?.candidate?.artifactSnapshots).toEqual(x.candidate.artifactSnapshots);
  });

  it("after an unpromoted Round 2, delivers the existing exact S1 package once then continues learning",async()=>{
    const x=fixture(true);
    const accepted=await runServerArtifactAcceptance(x.project,{
      verifyFrozenArtifacts:async()=>({verified:[x.frozen],unavailable:[],failed:[]}),
      repairCandidate:async()=>{throw new Error("No repair");},
    },{now:()=>"2026-09-20T14:30:00.000Z"});
    const first=accepted.project;
    const secondAttempt={
      ...first,
      stage:"learning" as const,
      campaign:{...first.campaign,currentRound:2,status:"running" as const,
        stopCriteria:{...first.campaign.stopCriteria,maxRounds:2,patienceRounds:3,stopWhenAcceptanceMet:false}},
      experimentRun:{...first.experimentRun,status:"completed" as const,
        winnerId:undefined,candidateResults:[]},
      validationRun:{...first.validationRun,status:"idle" as const,candidateId:undefined,
        evaluation:undefined,runs:[],baselineRuns:[]},
      roundHistory:[...first.roundHistory,{...first.roundHistory[0]!,id:"round-2-declined",
        round:2,winnerCandidateId:undefined,championChanged:false,globalChampionId:first.searchChampion?.id,
        summary:"Round 2 未产生可晋级 Candidate，保留第一轮 Champion"}],
    } as EvolveProject;
    const generated=materializeAcceptedChampionPackage(secondAttempt,"2026-09-20T15:00:00.000Z");
    expect(generated.filter(row=>row.kind==="primary"&&row.accepted)).toHaveLength(1);
    const packaged={...secondAttempt,outputArtifacts:generated};
    expect(packaged.searchChampion?.candidate?.id).toBe("C1");
    expect(packaged.validationRun.status).toBe("idle");
    expect(buildServerHarnessPlan(packaged).decision.action).toBe("distill");
    expect(buildServerHarnessPlan(packaged).decision.reason).toContain("离线");
    const corrupted={...packaged,outputArtifacts:generated.map(item=>
      item.kind==="primary"?{...item,content:"modified after Gate F"}:item)};
    const rejected=buildServerHarnessPlan(corrupted).decision;
    expect(rejected.action).toBe("wait-human");
    expect(rejected.reason).toContain("不一致");
    const wrongCandidate={...packaged,outputArtifacts:generated.map(item=>
      item.kind==="primary"?{...item,candidateId:"C2"}:item)};
    expect(buildServerHarnessPlan(wrongCandidate).decision.action).toBe("wait-human");
    expect(first.searchChampion?.candidate?.artifactSnapshots).toEqual(x.candidate.artifactSnapshots);
  });

  it("recovers an orphaned accepted first Champion without another round or altering frozen evidence",async()=>{
    const x=fixture(true);
    const accepted=await runServerArtifactAcceptance(x.project,{
      verifyFrozenArtifacts:async()=>({verified:[x.frozen],unavailable:[],failed:[]}),
      repairCandidate:async()=>{throw new Error("no repair");},
    },{now:()=> "2026-09-20T14:30:00.000Z"});
    expect(accepted.accepted).toBe(true);
    const previous=accepted.project;
    const orphan:EvolveProject={
      ...previous,
      searchChampion:undefined,
      searchAppliedPatches:[],
      campaign:{...previous.campaign,status:"paused",
        stopReason:"已达到设定的最大进化轮数 1",noImprovementRounds:1},
      roundHistory:previous.roundHistory.map(item=>({...item,
        championChanged:false,globalChampionId:undefined,winnerScore:undefined})),
      evolutionArchive:previous.evolutionArchive.map(item=>({...item,kind:"elite" as const})),
    };
    expect(buildServerHarnessPlan(orphan).decision.action).toBe("run-campaign");
    expect(buildServerHarnessPlan(orphan).decision.reason).toContain("Search Champion");
    const repaired=reconcileAcceptedOfflineChampion(orphan,"2026-09-20T14:32:00.000Z");
    expect(repaired?.searchChampion?.candidate?.id).toBe("C1");
    expect(repaired?.campaign.currentRound).toBe(1);
    expect(repaired?.campaign.noImprovementRounds).toBe(0);
    expect(repaired?.validationRun).toEqual(orphan.validationRun);
    expect(repaired?.artifactAcceptance).toEqual(orphan.artifactAcceptance);
    expect(repaired?.candidates).toEqual(orphan.candidates);
    expect(repaired?.roundHistory[0]).toMatchObject({championChanged:true,winnerCandidateId:"C1"});
    expect(campaignGoalSatisfied(repaired!)).toBe(true);
    expect(buildServerHarnessPlan(repaired!).decision.action).toBe("package");
    const packageItems=materializeAcceptedChampionPackage(repaired!);
    expect(packageItems.filter(item=>item.kind==="primary")).toHaveLength(1);
    expect(packageItems.every(item=>item.accepted)).toBe(true);
    // Unsafe releases, changed inputs and invalid frozen receipts must never reconcile.
    expect(reconcileAcceptedOfflineChampion({...orphan,release:{...orphan.release,status:"shadow"}})).toBeUndefined();
    expect(reconcileAcceptedOfflineChampion({...orphan,goal:"modified after validation"})).toBeUndefined();
    expect(reconcileAcceptedOfflineChampion({...orphan,campaign:{...orphan.campaign,stopReason:"Safety Hard Gate failed"}})).toBeUndefined();
    expect(reconcileAcceptedOfflineChampion({...orphan,artifactAcceptance:{...orphan.artifactAcceptance,frozenArtifacts:[]}})).toBeUndefined();
    expect(reconcileAcceptedOfflineChampion({...orphan,validationRun:{...orphan.validationRun,candidateId:"different"}})).toBeUndefined();
  });

  it("resumes the frozen Gate F checkpoint before generic revalidate when a governed retry is armed",()=>{
    const x=fixture(true);
    const project={
      ...x.project,
      stage:"validation" as const,
      inputUnderstanding:InputUnderstandingSchema.parse({status:"ready",confidence:0.95}),
      artifactAcceptance:{...x.project.artifactAcceptance,status:"unverified" as const,
        hardGatePass:true,summary:"Previous Gate F policy required all original soft observations"},
      campaign:{...x.project.campaign,status:"idle" as const,stopReason:undefined,
        checkpoint:{round:1,completedPhase:"validation" as const,at:"2026-09-20T14:00:00.000Z"}},
    };
    const decision=buildServerHarnessPlan(project).decision;
    expect(decision.action).toBe("run-campaign");
    expect(decision.reason).toContain("Artifact Acceptance");
    // A persistent pause must still require an explicit retry, not auto-resume.
    const paused={...project,campaign:{...project.campaign,status:"paused" as const,
      stopReason:"[server-campaign-artifact-acceptance-evidence-pending] Missing proof"}};
    expect(buildServerHarnessPlan(paused).decision.action).not.toBe("run-campaign");
    const changed={...project,validationRun:{...project.validationRun,candidateId:"another"}};
    expect(buildServerHarnessPlan(changed).decision.action).not.toBe("run-campaign");
  });

  it("pauses a later live Target round instead of settling without paired Hidden evidence",async()=>{
    const x=fixture(true);
    const ports={
      verifyFrozenArtifacts:async()=>({verified:[x.frozen],unavailable:[],failed:[]}),
      repairCandidate:async()=>{throw new Error("repair must not run");},
    };
    const first=await runServerArtifactAcceptance(x.project,ports);
    expect(first.project.searchChampion).toBeDefined();
    const project={
      ...first.project,
      targetConnection:{...first.project.targetConnection,adapter:"http" as const},
      campaign:{...first.project.campaign,checkpoint:{round:2,completedPhase:"validation" as const,at:"2026-09-20T15:00:00.000Z"}},
    };
    project.validationRun={...project.validationRun,evidenceFingerprint:evidenceFingerprint(project,x.candidate)};
    const second=await runServerArtifactAcceptance(project,ports);
    expect(second.control).toBe("stop");
    expect(second.project.campaign.status).toBe("paused");
    expect(second.project.campaign.currentRound).toBe(1);
    expect(second.project.campaign.checkpoint?.round).toBe(2);
    expect(second.project.searchChampion?.id).toBe(first.project.searchChampion?.id);
    expect(second.reason).toContain("live-comparison-pending");
  });

  it("refuses an accepted package if a stored frozen receipt is duplicated later",async()=>{
    const x=fixture(true);
    const outcome=await runServerArtifactAcceptance(x.project,{
      verifyFrozenArtifacts:async()=>({verified:[x.frozen],unavailable:[],failed:[]}),
      repairCandidate:async()=>{throw new Error("repair must not run");},
    });
    expect(outcome.accepted).toBe(true);
    outcome.project.searchChampion!.artifactAcceptance!.frozenArtifacts!.push({...x.frozen});
    expect(()=>materializeAcceptedChampionPackage(outcome.project)).toThrow(/冻结成果身份/);
  });
  it("pauses without repair when frozen evidence is unavailable",async()=>{
    const x=fixture(true);
    const repair=vi.fn();
    const outcome=await runServerArtifactAcceptance(x.project,{
      verifyFrozenArtifacts:async()=>({verified:[],unavailable:["blob unavailable"],failed:[]}),
      repairCandidate:repair,
    });
    expect(outcome.control).toBe("stop");
    expect(outcome.project.artifactAcceptance.status).toBe("unverified");
    expect(outcome.project.campaign.checkpoint).toMatchObject({round:1,completedPhase:"validation"});
    expect(repair).not.toHaveBeenCalled();
  });

  it("repairs only verified failures into a new Candidate and forces Visible before Hidden again",async()=>{
    const x=fixture(false);
    const repaired={...x.candidate,id:"C1-repair-1",name:"repair",status:"draft" as const,artifactSnapshots:[{...x.candidate.artifactSnapshots[0]!,id:"snap-repair",content:"fixed",contentHash:"hash2",frozenArtifact:{...x.frozen,blobId:"blob2",sha256:"sha2",snapshotHash:"hash2"}}]} as Candidate;
    const outcome=await runServerArtifactAcceptance(x.project,{
      verifyFrozenArtifacts:async()=>({verified:[x.frozen],unavailable:[],failed:[]}),
      repairCandidate:async({failedCriteria})=>{
        expect(failedCriteria.map((item)=>item.id)).toEqual(["CONTENT"]);
        return repaired;
      },
    });
    expect(outcome.repaired).toBe(true);
    expect(outcome.project.validationRun.status).toBe("idle");
    expect(outcome.project.validationRun.candidateId).toBe("C1-repair-1");
    expect(outcome.project.campaign.checkpoint).toMatchObject({round:1,completedPhase:"plan"});
    expect(outcome.project.experimentRun).toMatchObject({status:"idle",candidateResults:[]});
    expect(outcome.project.experimentRun.winnerId).toBeUndefined();
    expect(outcome.project.artifactAcceptance.status).toBe("repairing");
    expect(outcome.project.candidates.some((item)=>item.id==="C1-repair-1")).toBe(true);
    expect(campaignGoalSatisfied(outcome.project)).toBe(false);
  });

  it("repairs a bound verified failure without treating an unrelated unknown criterion as failure",async()=>{
    const x=fixture(false);
    x.project.acceptanceRubric.push({...x.project.acceptanceRubric[0]!,id:"PROTECT",title:"保留交互",protectedConstraint:true});
    x.project.hiddenEvalSuite[0]!.criterionIds.push("PROTECT");
    x.project.validationRun.evaluation!.criterionScores!.push({criterionId:"PROTECT",score:93,pass:false,verificationStatus:"partial",evidence:["search only"],gaps:["remaining interactions unobserved"],testCaseIds:["H1"]});
    x.project.validationRun.evaluation!.unverifiedCriterionIds=["PROTECT"];
    x.project.validationRun.evidenceFingerprint=evidenceFingerprint(x.project,x.candidate);
    const evaluation=structuredClone(x.project.validationRun.evaluation);
    const repair=vi.fn(async({failedCriteria}:{failedCriteria:EvolveProject["acceptanceRubric"]})=>{
      expect(failedCriteria.map((item:{id:string})=>item.id)).toEqual(["CONTENT"]);
      return {...x.candidate,id:"C1-repair",status:"draft" as const};
    });
    const ports={verifyFrozenArtifacts:async()=>({verified:[x.frozen],unavailable:[],failed:[]}),repairCandidate:repair};
    const outcome=await runServerArtifactAcceptance(x.project,ports);
    expect(outcome).toMatchObject({control:"continue",accepted:false,repaired:true});
    expect(outcome.project.validationRun.previousEvaluation).toEqual(evaluation);
    expect(outcome.project.gates.find(gate=>gate.id==="artifact-ready")?.status).toBe("pending");
    expect(x.project.validationRun.evaluation).toEqual(evaluation);
    repair.mockClear();
    const unavailable=await runServerArtifactAcceptance(x.project,{...ports,verifyFrozenArtifacts:async()=>({verified:[],unavailable:["missing physical file"],failed:[]})});
    expect(unavailable).toMatchObject({control:"stop",accepted:false,repaired:false});
    expect(repair).not.toHaveBeenCalled();
  });

  it("settles a failed round instead of rewriting after repair budget is exhausted",async()=>{
    const x=fixture(false);
    x.project.artifactAcceptance={...x.project.artifactAcceptance,attempts:2,maxRepairAttempts:2};
    const repair=vi.fn();
    const outcome=await runServerArtifactAcceptance(x.project,{
      verifyFrozenArtifacts:async()=>({verified:[x.frozen],unavailable:[],failed:[]}),
      repairCandidate:repair,
    });
    expect(outcome.control).toBe("continue");
    expect(outcome.accepted).toBe(false);
    expect(outcome.project.campaign.currentRound).toBe(1);
    expect(outcome.project.campaign.checkpoint).toBeUndefined();
    expect(repair).not.toHaveBeenCalled();
  });
});
