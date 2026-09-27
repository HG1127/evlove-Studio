import {describe,expect,it,vi} from "vitest";
import type {Candidate,EvolveProject} from "@evolution/contracts";
import {campaignGoalSatisfied,campaignStopReason,completeAutonomousMission,evidenceFingerprint,materializeAcceptedChampionPackage} from "@evolution/core";
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
    validationRun:{id:"v",status:"completed",validationMode:"full",candidateId:"C1",recommendation:pass?"release":"hold",runs:[],baselineRuns:[],checks:[],evaluation:{accuracy:pass?92:50,evidence:90,riskCoverage:90,completeness:pass?92:50,safety:"PASS",averageCost:0,averageLatencyMs:1,notes:[],failures:[],rubricScore:pass?92:50,verifiedRubricCoverage:100,unverifiedCriterionIds:[],criterionScores:[{criterionId:"CONTENT",score:pass?92:50,pass,verificationStatus:"verified",evidence:["hidden"],gaps:pass?[]:["still bad"],testCaseIds:["H1"]}]}},
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

  it("repairs only verified failures into a new Candidate and forces Hidden Holdout again",async()=>{
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
    expect(outcome.project.campaign.checkpoint).toMatchObject({round:1,completedPhase:"experiment"});
    expect(outcome.project.artifactAcceptance.status).toBe("repairing");
    expect(outcome.project.candidates.some((item)=>item.id==="C1-repair-1")).toBe(true);
    expect(campaignGoalSatisfied(outcome.project)).toBe(false);
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
