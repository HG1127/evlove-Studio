import { describe, expect, it } from "vitest";
import type { EvaluateAiResult, EvolveProject, TargetRunResult } from "@evolution/contracts";
import { campaignScoringInputFingerprint, fastHash, htmlProtectionContractBlocker, normalizeEvalSuiteForProject, reusableBaselineRuns, sourceGroundedHtmlProtectionSteps } from "@evolution/core";
import { canReuseServerBaseline, runServerBaseline } from "./server-baseline";
import { serverBaselineFingerprint } from "./server-baseline-evidence";
import { exactServerHoldoutSuite } from "./server-holdout-preflight";
import { executeServerCurrentArtifactSuite } from "./server-current-artifact-runner";

function fixture(): EvolveProject {
  const now="2026-09-20T13:00:00.000Z";
  return {
    id:"baseline-mission",name:"Baseline",objectType:"document",department:"test",goal:"提升说明完整度",problemStatement:"",desiredOutcome:"",
    evolutionCommand:"让说明更完整",protectedItems:["事实"],editableItems:["表达"],metrics:[],
    sourceArtifacts:[{id:"source",name:"source.md",role:"target",artifactKind:"document",mimeType:"text/markdown",size:40,extension:"md",inputMode:"paste",parseStatus:"ready",textContent:"当前说明包含安装步骤，但缺少验证与回滚说明。",textExcerpt:"当前说明包含安装步骤",structure:[],warnings:[],createdAt:now}],
    inputClarifications:[],commandHistory:[],supplementalValidationEvidence:[],adviceLedger:[],
    acceptanceRubric:[
      {id:"CONTENT",title:"操作闭环",requirement:"说明包含安装、验证和回滚",source:"user-command",weight:60,hardGate:true,judgeType:"llm",validationMethod:"semantic-judge",minScore:85,evidenceExpected:["验证","回滚"],protectedConstraint:false,artifactIds:["source"],category:"outcome"},
      {id:"FORMAT",title:"格式保持",requirement:"Markdown 可往返",source:"system-integrity",weight:30,hardGate:true,judgeType:"integrity",validationMethod:"format-roundtrip",minScore:90,evidenceExpected:["roundtrip"],protectedConstraint:true,artifactIds:["source"],category:"integrity"},
      {id:"STRUCTURE",title:"结构可读",requirement:"当前文档存在可检查正文",source:"system-integrity",weight:10,hardGate:false,judgeType:"structural",validationMethod:"static-structure",minScore:70,evidenceExpected:["正文"],protectedConstraint:false,artifactIds:["source"],category:"integrity"},
    ],
    acceptanceRubricState:{status:"ready",summary:"ready",version:1,weightTotal:100,uncoveredCriterionIds:[],warnings:[],confirmedAt:now},
    evalSuite:[
      {id:"V1",title:"操作闭环",input:"检查安装、验证和回滚",expected:["安装","验证","回滚"],tags:[],hidden:false,criterionIds:["CONTENT"],executionMode:"artifact-runtime",evidenceScope:"product-behavior"},
      {id:"V2",title:"格式往返",input:"检查 Markdown 原格式",expected:["逐字往返"],tags:[],hidden:false,criterionIds:["FORMAT"],executionMode:"roundtrip",evidenceScope:"format"},
      {id:"V3",title:"正文结构",input:"检查当前正文",expected:["存在正文"],tags:[],hidden:false,criterionIds:["STRUCTURE"],executionMode:"static-evidence",evidenceScope:"implementation"},
    ],
    hiddenEvalSuite:[
      {id:"H1",title:"隐藏闭环",input:"检查闭环",expected:["验证","回滚"],tags:[],hidden:true,criterionIds:["CONTENT"],executionMode:"artifact-runtime",evidenceScope:"product-behavior"},
      {id:"H2",title:"隐藏格式",input:"检查格式",expected:["roundtrip"],tags:[],hidden:true,criterionIds:["FORMAT"],executionMode:"roundtrip",evidenceScope:"format"},
    ],
    baselineRun:{id:"baseline",status:"idle",suiteName:"Core",totalCases:2,runs:[]},
    problems:[],candidates:[],selectedCandidateIds:[],lessons:[],nextQueue:[],versions:[],outputArtifacts:[],appliedPatches:[],searchAppliedPatches:[],evolutionArchive:[],roundHistory:[],
    experimentRun:{id:"experiment",status:"idle",candidateResults:[]},validationRun:{id:"validation",status:"idle",checks:[],runs:[],baselineRuns:[]},
    artifactAcceptance:{id:"acceptance",status:"idle",overallScore:0,coverageScore:0,integrityScore:0,pairwiseScore:0,hardGatePass:false,results:[],attempts:0,maxRepairAttempts:3,summary:""},
    release:{status:"idle",trafficPercent:0,healthy:true,kpis:[],history:[],evidenceMode:"simulation"},
    targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"},
    experimentPolicy:{batchArtifactRuntime:true,batchSize:4},
    aiProfile:{},
    gates:[
      {id:"target-ready",label:"Target Ready",status:"approved",approvedAt:now},
      {id:"experiment-ready",label:"Experiment Ready",status:"pending"},
      {id:"artifact-ready",label:"Artifact Ready",status:"pending"},
      {id:"release-ready",label:"Release Ready",status:"pending"},
    ],
    stage:"target",version:"V1",currentVersionId:"V1",updatedAt:now,
    campaign:{status:"idle",executionMode:"auto-rounds",currentRound:0,noImprovementRounds:0,candidateCount:2,searchMode:"focused",parentStrategy:"champion-only",eliteCount:2,exploreRatio:0.3,estimatedCost:0,autoApproveOfflineExperiment:true,stopCriteria:{maxRounds:3,patienceRounds:2,minImprovement:1,stopWhenAcceptanceMet:true,stopOnSafetyFailure:true,stopWhenMetricTargetsMet:false},schedule:{enabled:false,mode:"manual",intervalMinutes:60,hour:8,minute:0,daysOfWeek:[]}},
  } as unknown as EvolveProject;
}

function judge(): EvaluateAiResult {
  return {
    accuracy:72,evidence:78,riskCoverage:70,completeness:68,safety:"PASS",
    notes:["当前说明尚缺回滚细节"],failures:["操作闭环不足"],
    cases:[{testCaseId:"V1",accuracy:72,evidence:78,completeness:68,reason:"有安装步骤，但验证/回滚不足"}],
    criteria:[{criterionId:"CONTENT",score:72,pass:false,evidence:["V1: 有安装步骤"],gaps:["缺验证/回滚"],testCaseIds:["V1"]}],
  };
}

describe("server baseline",()=>{
  it("settles a proven format-only Baseline without requiring an AI provider",async()=>{
    const project=fixture();
    project.acceptanceRubric=[
      {...project.acceptanceRubric[1]!,weight:34},
      {...project.acceptanceRubric[1]!,id:"USER-FORMAT",source:"user-command",protectedConstraint:false,weight:33},
      {...project.acceptanceRubric[1]!,id:"PROTECT-FORMAT",weight:33},
    ];
    const ids=project.acceptanceRubric.map((criterion)=>criterion.id);
    project.evalSuite=[{...project.evalSuite[1]!,criterionIds:ids}];
    project.hiddenEvalSuite=[{...project.hiddenEvalSuite[1]!,criterionIds:ids}];
    let judgeCalls=0;
    const outcome=await runServerBaseline(project,{
      executeSemanticBatch:async()=>{throw new Error("no semantic execution was requested");},
      judge:async()=>{judgeCalls+=1;throw new Error("provider unavailable");},
    });
    expect(judgeCalls).toBe(0);
    expect(outcome.ready).toBe(true);
    expect(outcome.baseline.status).toBe("completed");
    expect(outcome.project.stage).toBe("problem");
    expect(outcome.baseline.result).toMatchObject({accuracy:0,evidence:0,riskCoverage:0,completeness:0,failures:[],caseScores:[],rubricScore:100,verifiedRubricCoverage:100});
    expect(outcome.baseline.result?.criterionScores).toHaveLength(3);
    expect(outcome.baseline.result?.criterionScores?.every((criterion)=>criterion.pass&&criterion.verificationStatus==="verified"&&criterion.score===100)).toBe(true);
    expect(canReuseServerBaseline(outcome.project)).toBe(true);
  });

  it("keeps missing semantic evidence unverified without sending an empty Judge request",async()=>{
    const project=fixture();
    project.evalSuite=project.evalSuite.map((testCase)=>testCase.id==="V3"?{...testCase,executionMode:"external-runner"}:testCase);
    let judgeCalls=0;
    const outcome=await runServerBaseline(project,{
      executeSemanticBatch:async()=>{throw new Error("semantic runtime unavailable");},
      judge:async()=>{judgeCalls+=1;throw new Error("empty evidence must not reach Judge");},
    });
    expect(judgeCalls).toBe(0);
    expect(outcome.ready).toBe(false);
    expect(outcome.baseline.status).toBe("completed");
    expect(outcome.reason).toContain("baseline-evidence-pending");
    expect(outcome.baseline.result?.criterionScores?.find((item)=>item.criterionId==="CONTENT")).toMatchObject({pass:false,verificationStatus:"unverified"});
    expect(outcome.baseline.result?.criterionScores?.find((item)=>item.criterionId==="FORMAT")).toMatchObject({pass:true,verificationStatus:"verified"});
    expect(outcome.baseline.result?.failures).toEqual([]);
    expect(outcome.project.stage).toBe("baseline");
  });

  it("still requires a Judge for structural evidence instead of treating file presence as acceptance",async()=>{
    const project=fixture();
    project.evalSuite=project.evalSuite.map((testCase)=>testCase.id==="V1"?{...testCase,executionMode:"external-runner"}:testCase);
    let judgeCalls=0;
    const outcome=await runServerBaseline(project,{
      executeSemanticBatch:async()=>({results:[]}),
      judge:async()=>{judgeCalls+=1;throw new Error("provider unavailable");},
    });
    expect(judgeCalls).toBe(1);
    expect(outcome.ready).toBe(false);
    expect(outcome.baseline.status).toBe("failed");
    expect(outcome.reason).toContain("baseline-judge-pending");
  });

  it("sends only observable criteria and cases to a required Judge",async()=>{
    const project=fixture();
    project.evalSuite=project.evalSuite.map((testCase)=>testCase.id==="V1"?{...testCase,executionMode:"external-runner"}:testCase);
    const outcome=await runServerBaseline(project,{
      executeSemanticBatch:async()=>({results:[]}),
      judge:async(payload)=>{
        const request=payload as {acceptanceRubric:Array<{id:string}>;testCases:Array<{id:string}>;runs:Array<{testCaseId:string}>};
        expect(request.acceptanceRubric.map((criterion)=>criterion.id)).toEqual(["STRUCTURE"]);
        expect(request.testCases.map((testCase)=>testCase.id)).toEqual(["V3"]);
        expect(request.runs.map((run)=>run.testCaseId)).toEqual(["V3"]);
        return judge();
      },
    });
    expect(outcome.ready).toBe(false);
    expect(outcome.baseline.result?.criterionScores?.find((criterion)=>criterion.criterionId==="CONTENT")).toMatchObject({pass:false,verificationStatus:"unverified"});
  });

  it("does not score a repeated semantic Test Case result as verified evidence",async()=>{
    const outcome=await runServerBaseline(fixture(),{
      executeSemanticBatch:async()=>({results:[
        {testCaseId:"V1",output:"contradictory first",trace:[]},
        {testCaseId:"V1",output:"contradictory second",trace:[]},
      ]}),
      judge:async()=>{throw new Error("ambiguous evidence must not reach Judge");},
    });
    const run=outcome.baseline.runs.find((item)=>item.testCaseId==="V1");
    expect(run?.verificationStatus).toBe("unverified");
    expect(run?.output).toContain("重复结果");
    expect(outcome.ready).toBe(false);
  });

  it("does not trust repeated external Runner results",async()=>{
    const project=fixture();
    project.evalSuite[0]={...project.evalSuite[0]!,executionMode:"external-runner"};
    project.acceptanceRubric[0]={...project.acceptanceRubric[0]!,validationMethod:"executable-test"};
    const outcome=await runServerBaseline(project,{
      executeSemanticBatch:async()=>({results:[]}),
      executeExternalBatch:async()=>[
        {testCaseId:"V1",output:"passed",latencyMs:1,cost:0,verificationStatus:"verified",trace:[]},
        {testCaseId:"V1",output:"failed",latencyMs:1,cost:0,verificationStatus:"failed",trace:[]},
      ],
      judge:async()=>{throw new Error("ambiguous evidence must not reach Judge");},
    });
    expect(outcome.baseline.runs.find((item)=>item.testCaseId==="V1")).toMatchObject({verificationStatus:"unverified"});
  });

  it("executes semantic + deterministic evidence and produces a ready BaselineRun",async()=>{
    const outcome=await runServerBaseline(fixture(),{
      executeSemanticBatch:async({testCases})=>({results:testCases.map((testCase)=>({testCaseId:testCase.id,output:"当前说明包含安装步骤，但验证与回滚说明不足。",trace:[]}))}),
      judge:async()=>judge(),
    },{now:()=> "2026-09-20T13:05:00.000Z"});
    expect(outcome.ready).toBe(true);
    expect(outcome.baseline.status).toBe("completed");
    expect(outcome.baseline.runs.find((run)=>run.testCaseId==="V1")?.verificationStatus).toBe("verified");
    expect(outcome.baseline.runs.find((run)=>run.testCaseId==="V2")?.verificationStatus).toBe("verified");
    expect(outcome.baseline.result?.demoJudged).not.toBe(true);
    expect(outcome.baseline.result?.criterionScores?.find((item)=>item.criterionId==="CONTENT")).toMatchObject({verificationStatus:"verified",pass:false});
    expect(outcome.project.stage).toBe("problem");
    expect(outcome.project.campaign.rootBaseline).toBeTruthy();
    expect(outcome.project.campaign.checkpoint).toMatchObject({round:1,completedPhase:"baseline"});
    expect(canReuseServerBaseline(outcome.project)).toBe(true);
    expect(canReuseServerBaseline(outcome.project, "other-route")).toBe(false);
    expect(canReuseServerBaseline({ ...outcome.project, evalSuite: [{ ...outcome.project.evalSuite[0]!, input: "changed" }, ...outcome.project.evalSuite.slice(1)] })).toBe(false);
    expect(canReuseServerBaseline({ ...outcome.project, sourceArtifacts: [{ ...outcome.project.sourceArtifacts[0]!, textContent: "changed" }] })).toBe(false);
    expect(canReuseServerBaseline({ ...outcome.project, sourceArtifacts: [{ ...outcome.project.sourceArtifacts[0]!, name: "renamed.md" }] })).toBe(false);
    expect(canReuseServerBaseline({ ...outcome.project, targetConnection: { ...outcome.project.targetConnection, status: "error", label: "Renamed" } })).toBe(true);
    expect(canReuseServerBaseline({ ...outcome.project, baselineRun: { ...outcome.baseline, measurementFingerprint: undefined } })).toBe(false);
  });

  it("remeasures live Target observations in each new Campaign round while reusing a same-round checkpoint", async () => {
    const measured = await runServerBaseline(fixture(), {
      executeSemanticBatch: async ({ testCases }) => ({ results: testCases.map((testCase) => ({ testCaseId: testCase.id, output: "当前说明包含安装步骤，但验证与回滚说明不足。", trace: [] })) }),
      judge: async () => judge(),
    });
    expect(measured.ready).toBe(true);
    for (const adapter of ["http", "connector"] as const) {
      const dynamic = { ...measured.project, targetConnection: { ...measured.project.targetConnection, adapter } };
      const bound = { ...dynamic, baselineRun: { ...dynamic.baselineRun, measurementFingerprint: serverBaselineFingerprint(dynamic) } };
      expect(canReuseServerBaseline(bound)).toBe(true);
      expect(canReuseServerBaseline(bound, undefined, Date.parse(bound.baselineRun.completedAt!) + 10 * 60_000)).toBe(false);
      expect(canReuseServerBaseline({ ...bound, campaign: { ...bound.campaign, currentRound: 1, checkpoint: undefined } })).toBe(false);
    }
    const external = { ...measured.project, evalSuite: measured.project.evalSuite.map((testCase, index) => index === 0 ? { ...testCase, executionMode: "external-runner" as const } : testCase) };
    const externalBound = { ...external, baselineRun: { ...external.baselineRun, measurementFingerprint: serverBaselineFingerprint(external) } };
    expect(canReuseServerBaseline(externalBound)).toBe(true);
    expect(canReuseServerBaseline({ ...externalBound, campaign: { ...externalBound.campaign, currentRound: 1, checkpoint: undefined } })).toBe(false);
    expect(canReuseServerBaseline({ ...measured.project, campaign: { ...measured.project.campaign, currentRound: 1, checkpoint: undefined } })).toBe(true);
    const snapshotted = {
      ...measured.project,
      targetConnection: {
        ...measured.project.targetConnection,
        adapter: "connector" as const,
        connectorSnapshot: { connectorId: "connector", targetId: "target", versionRef: "v1", artifactId: "source", observedAt: "2026-09-20T13:00:00Z" },
      },
    };
    const snapshotBound = { ...snapshotted, baselineRun: { ...snapshotted.baselineRun, measurementFingerprint: serverBaselineFingerprint(snapshotted) } };
    expect(canReuseServerBaseline({ ...snapshotBound, campaign: { ...snapshotBound.campaign, currentRound: 1, checkpoint: undefined } })).toBe(true);
  });
  it("fails closed when the server judge cannot complete",async()=>{
    const outcome=await runServerBaseline(fixture(),{
      executeSemanticBatch:async({testCases})=>({results:testCases.map((testCase)=>({testCaseId:testCase.id,output:"当前说明包含安装步骤。",trace:[]}))}),
      judge:async()=>{throw new Error("judge unavailable");},
    });
    expect(outcome.ready).toBe(false);
    expect(outcome.baseline.status).toBe("failed");
    expect(outcome.reason).toContain("baseline-judge-pending");
    expect(outcome.project.campaign.status).toBe("paused");
  });

  it("does not turn missing external execution into a product failure",async()=>{
    const project=fixture();
    project.evalSuite=[
      {id:"V1",title:"真实运行",input:"运行 E2E",expected:["通过"],tags:[],hidden:false,criterionIds:["CONTENT"],executionMode:"external-runner",evidenceScope:"product-behavior"},
      project.evalSuite[1]!,
      project.evalSuite[2]!,
    ];
    const outcome=await runServerBaseline(project,{
      executeSemanticBatch:async()=>({results:[]}),
      executeExternalBatch:async({testCases})=>testCases.map((testCase):TargetRunResult=>({
        testCaseId:testCase.id,output:"UNVERIFIED：Sandbox OIDC unavailable",latencyMs:0,cost:0,verificationStatus:"unverified",trace:[],
      })),
      judge:async()=>judge(),
    });
    expect(outcome.ready).toBe(false);
    expect(outcome.reason).toContain("baseline-evidence-pending");
    const run=outcome.baseline.runs.find((item)=>item.testCaseId==="V1");
    expect(run?.verificationStatus).toBe("unverified");
    expect(run?.error).toBeUndefined();
    expect(outcome.baseline.result?.failures).not.toContain("Sandbox OIDC unavailable");
  });

  it("routes visual-review through the real external/browser port instead of a local text substitute",async()=>{
    const project=fixture();
    project.acceptanceRubric[0]={...project.acceptanceRubric[0]!,validationMethod:"visual-review"};
    project.evalSuite[0]={...project.evalSuite[0]!,executionMode:"visual-review"};
    let externalCalls=0;
    const outcome=await runServerBaseline(project,{
      executeSemanticBatch:async()=>({results:[]}),
      executeExternalBatch:async({testCases})=>{
        externalCalls+=1;
        return testCases.map((testCase):TargetRunResult=>({
          testCaseId:testCase.id,output:"真实 Chromium 截图已经由外部端口评审。",latencyMs:10,cost:0,verificationStatus:"partial",trace:[],
        }));
      },
      judge:async()=>judge(),
    });
    expect(externalCalls).toBe(1);
    expect(outcome.baseline.runs.find((run)=>run.testCaseId==="V1")?.verificationStatus).toBe("partial");
  });

  it("measures the accepted Search Champion snapshot instead of falling back to the original text",async()=>{
    const project=fixture();
    const candidate={
      id:"champion-candidate",
      name:"S1",
      change:"补齐验证与回滚",
      status:"winner" as const,
      artifactBuildStatus:"ready" as const,
      artifactSnapshots:[{
        id:"champion-snapshot",
        sourceArtifactId:"source",
        name:"source.md",
        mimeType:"text/markdown",
        content:"S1 CURRENT CHAMPION：安装、验证、回滚均已完整。",
        contentHash:"hash-s1",
        buildMode:"ai-full" as const,
        notes:[],
        createdAt:"2026-09-20T13:10:00.000Z",
      }],
      patches:[],
      addressesAdvice:[],
      riskLevel:"low" as const,
      risks:[],
      accuracy:90,evidence:90,riskCoverage:90,costDelta:0,speedDelta:0,safety:"PASS" as const,recommended:true,notes:[],
    };
    const acceptedEvaluation={accuracy:92,evidence:92,riskCoverage:90,completeness:94,safety:"PASS" as const,averageCost:0.01,averageLatencyMs:10,notes:[],failures:[],rubricScore:92,verifiedRubricCoverage:100,unverifiedCriterionIds:[]};
    const validation={...project.validationRun,status:"completed" as const,candidateId:candidate.id,recommendation:"release" as const,evaluation:acceptedEvaluation};
    const acceptance={...project.artifactAcceptance,status:"passed" as const,candidateId:candidate.id,hardGatePass:true,overallScore:92,coverageScore:92,integrityScore:92,pairwiseScore:92};
    project.searchChampion={
      id:"champion-s1",versionLabel:"S1",round:1,score:92,candidate,
      evaluation:acceptedEvaluation,validation,artifactAcceptance:acceptance,patches:[],
      parentVersionId:"V1",reason:"accepted",selectedAt:"2026-09-20T13:10:00.000Z",
    };
    project.campaign.currentRound=1;
    project.campaign.scoringInputFingerprint=campaignScoringInputFingerprint(project);
    let observed="";
    const outcome=await runServerBaseline(project,{
      buildCurrentArtifactContext:async()=>[{id:"source",content:"S1 CURRENT CHAMPION：安装、验证、回滚均已完整。",truncated:false}],
      executeSemanticBatch:async({testCases,artifactContext})=>{
        observed=String(artifactContext.find((item)=>item.id==="source")?.content??"");
        return {results:testCases.map((testCase)=>({testCaseId:testCase.id,output:"S1 CURRENT CHAMPION 已包含安装、验证、回滚。",trace:[]}))};
      },
      judge:async()=>judge(),
    });
    expect(observed).toContain("S1 CURRENT CHAMPION");
    expect(observed).not.toContain("缺少验证与回滚说明");
    expect(outcome.baseline.runs.find((run)=>run.testCaseId==="V2")?.verificationStatus).toBe("unverified");
    expect(outcome.ready).toBe(false);
    expect(outcome.project.campaign.status).toBe("paused");
  });
});

describe("server Baseline evidence provenance", () => {
  it("requires a fresh Baseline after the former prefix-only context policy",async()=>{
    const project=fixture();
    const legacy=fastHash({
      version:"server-baseline-v2",scoringInputFingerprint:campaignScoringInputFingerprint(project),
      scoringRouteFingerprint:undefined,goal:project.goal,command:project.evolutionCommand,
      rubric:project.acceptanceRubric,evalSuite:project.evalSuite,hiddenEvalSuite:project.hiddenEvalSuite,
      protectedItems:project.protectedItems,clarifications:project.inputClarifications,
      metrics:project.metrics.map(({key,target,direction})=>({key,target,direction})),
      targets:project.sourceArtifacts.map(artifact=>({id:artifact.id,role:artifact.role,text:artifact.textContent??artifact.textExcerpt??"",structure:artifact.structure,descriptor:artifact.artifactDescriptor})),
      champion:undefined,
    });
    const outcome=await runServerBaseline(project,{
      executeSemanticBatch:async({testCases})=>({results:testCases.map(testCase=>({testCaseId:testCase.id,output:"当前说明包含安装步骤，但验证与回滚说明不足。",trace:[]}))}),
      judge:async()=>judge(),
    });
    expect(outcome.ready).toBe(true);
    expect(serverBaselineFingerprint(project)).not.toBe(legacy);
    expect(canReuseServerBaseline({...outcome.project,baselineRun:{...outcome.baseline,measurementFingerprint:legacy}})).toBe(false);
  });

  it("includes the actual scoring route in the measurement fingerprint", () => {
    const project = fixture();
    expect(serverBaselineFingerprint(project, "route-a")).not.toBe(serverBaselineFingerprint(project, "route-b"));
    expect(serverBaselineFingerprint(project, "route-a")).toBe(serverBaselineFingerprint(project, "route-a"));
  });
});
describe("server Campaign scoring route binding", () => {
  it("stops an established Campaign before executing under a changed route", async () => {
    const project = fixture();
    project.campaign.currentRound = 1;
    project.campaign.scoringInputFingerprint = campaignScoringInputFingerprint(project);
    project.campaign.scoringRouteFingerprint = "old-route";
    const outcome = await runServerBaseline(project, {
      scoringRouteFingerprint: "new-route",
      executeSemanticBatch: async () => { throw new Error("must not execute"); },
      judge: async () => { throw new Error("must not judge"); },
    });
    expect(outcome.ready).toBe(false);
    expect(outcome.reason).toContain("重置搜索");
    expect(outcome.project.campaign.status).toBe("paused");
    expect(outcome.project.campaign.scoringRouteFingerprint).toBe("old-route");
    expect(outcome.baseline).toBe(project.baselineRun);
  });

  it("reanchors an incomplete first-round Baseline when a retry finally measures it", async () => {
    const project = fixture();
    project.campaign.scoringInputFingerprint = campaignScoringInputFingerprint(project);
    project.campaign.rootBaseline = {
      accuracy: 1, evidence: 1, riskCoverage: 1, completeness: 1, safety: "PASS",
      averageCost: 0, averageLatencyMs: 1, notes: [], failures: [],
    };
    const outcome = await runServerBaseline(project, {
      executeSemanticBatch: async ({ testCases }) => ({
        results: testCases.map((testCase) => ({
          testCaseId: testCase.id,
          output: "当前说明包含安装步骤，但验证与回滚说明不足。",
          trace: [],
        })),
      }),
      judge: async () => judge(),
    });
    expect(outcome.ready).toBe(true);
    expect(outcome.project.campaign.rootBaseline).toEqual(outcome.baseline.result);
    expect(outcome.project.campaign.rootBaseline?.accuracy).not.toBe(1);
  });
  it("reanchors a fresh first-round measurement even when the previous Baseline was ready", async () => {
    const ports = {
      executeSemanticBatch: async ({ testCases }: { testCases: EvolveProject["evalSuite"] }) => ({
        results: testCases.map((testCase) => ({ testCaseId: testCase.id, output: "当前说明包含安装步骤，但验证与回滚说明不足。", trace: [] })),
      }),
      judge: async () => judge(),
    };
    const previous = await runServerBaseline(fixture(), ports);
    expect(previous.ready).toBe(true);
    const oldRoot = { ...previous.baseline.result!, accuracy: 1 };
    const rerun = await runServerBaseline({
      ...previous.project,
      campaign: { ...previous.project.campaign, currentRound: 0, rootBaseline: oldRoot },
    }, ports);
    expect(rerun.ready).toBe(true);
    expect(rerun.project.campaign.rootBaseline).toEqual(rerun.baseline.result);
    expect(rerun.project.campaign.rootBaseline?.accuracy).not.toBe(1);
  });
  it("remeasures and reanchors the first round after a scoring route change", async () => {
    const project = fixture();
    project.campaign.scoringRouteFingerprint = "old-route";
    project.campaign.rootBaseline = {
      accuracy: 1, evidence: 1, riskCoverage: 1, completeness: 1, safety: "PASS",
      averageCost: 0, averageLatencyMs: 1, notes: [], failures: [],
    };
    const outcome = await runServerBaseline(project, {
      scoringRouteFingerprint: "new-route",
      executeSemanticBatch: async ({ testCases }) => ({
        results: testCases.map((testCase) => ({
          testCaseId: testCase.id,
          output: "当前说明包含安装步骤，但验证与回滚说明不足。",
          trace: [],
        })),
      }),
      judge: async () => judge(),
    });
    expect(outcome.ready).toBe(true);
    expect(outcome.project.campaign.scoringRouteFingerprint).toBe("new-route");
    expect(outcome.project.campaign.rootBaseline).toEqual(outcome.baseline.result);
    expect(outcome.project.campaign.rootBaseline?.accuracy).not.toBe(1);
  });
});

describe("generated HTML paper identity", () => {
  function htmlPaper() {
    const base = fixture();
    const html = '<html><style>.search-hidden{display:none}</style><body><input id="search"><span id="searchCount"></span><article class="slide-card" id="slide-2" data-search="intro">Intro</article><article class="slide-card" id="slide-3" data-search="end">End</article><script>const search=document.querySelector("#search");search.addEventListener("input",()=>{document.querySelectorAll(".slide-card").forEach(card=>card.dataset.search.includes(search.value))});</script></body></html>';
    const criterion = { ...base.acceptanceRubric[0]!, id: "PROTECT-ALL", weight: 100, protectedConstraint: true, artifactIds: ["source"] };
    const test = { ...base.evalSuite[0]!, criterionIds: [criterion.id], executionMode: "external-runner" as const };
    const paper = { ...base, acceptanceRubric: [criterion], sourceArtifacts: [{ ...base.sourceArtifacts[0]!, extension: "html", textContent: html }] };
    const steps = sourceGroundedHtmlProtectionSteps(paper, [criterion], test)!;
    const legacy = [...steps.slice(0, 3), ...steps.slice(6, 8), ...steps.slice(3, 6), ...steps.slice(11)];
    return { ...paper, evalSuite: [{ ...test, browserSteps: legacy, tags: ["source-grounded-html-assertions"] }],
      hiddenEvalSuite: [{ ...test, id: "H1", hidden: true, browserSteps: legacy, tags: ["source-grounded-html-assertions"] }] };
  }

  it("refuses a stored old recipe before any execution, judgment or frozen Hidden rewrite", async () => {
    const paper = htmlPaper();
    const calls: string[] = [];
    const paused = await runServerBaseline(paper, {
      executeSemanticBatch: async () => { calls.push("semantic"); throw new Error("unexpected"); },
      executeExternalBatch: async () => { calls.push("browser"); throw new Error("unexpected"); },
      judge: async () => { calls.push("judge"); throw new Error("unexpected"); },
    });
    expect(paused.ready).toBe(false);
    expect(paused.reason).toContain("html-protection-contract-pending");
    expect(paused.project.evalSuite).toEqual(paper.evalSuite);
    expect(paused.project.hiddenEvalSuite).toEqual(paper.hiddenEvalSuite);
    expect(paused.project.baselineRun).toEqual(paper.baselineRun);
    expect(calls).toEqual([]);
    expect(() => exactServerHoldoutSuite(paper)).toThrow("html-protection-contract-pending");
    expect(canReuseServerBaseline(paper)).toBe(false);
  });

  it("binds upgraded visible and paired Hidden observations to a new paper identity", () => {
    const old = htmlPaper();
    const normalized = normalizeEvalSuiteForProject(old, old.evalSuite, old.hiddenEvalSuite);
    const current = { ...old, evalSuite: normalized.validationCases, hiddenEvalSuite: normalized.hiddenCases };
    const oldVisible = serverBaselineFingerprint(old, "same-route");
    const oldHidden = serverBaselineFingerprint({ ...old, evalSuite: old.hiddenEvalSuite }, "same-route");
    const currentVisible = serverBaselineFingerprint(current, "same-route");
    const currentHidden = serverBaselineFingerprint({ ...current, evalSuite: current.hiddenEvalSuite }, "same-route");
    expect(currentVisible).not.toBe(oldVisible);
    expect(currentHidden).not.toBe(oldHidden);
    expect(htmlProtectionContractBlocker(current)).toBeUndefined();
    expect(exactServerHoldoutSuite(current)).toEqual(current.hiddenEvalSuite);
    const prior = { ...current, baselineRun: { ...current.baselineRun, measurementFingerprint: oldVisible,
      runs: current.evalSuite.map(test => ({ testCaseId: test.id, verificationStatus: "verified" as const, latencyMs: 1, cost: 0, output: "old", trace: [] })),
      result: { ...judge(), averageCost: 0, averageLatencyMs: 1, criterionScores: [{ criterionId: "PROTECT-ALL", score: 100, pass: true, evidence: [], gaps: [], testCaseIds: ["V1"], verificationStatus: "verified" as const }] } as EvolveProject["baselineRun"]["result"],
    } };
    expect(reusableBaselineRuns(prior, currentVisible, true)).toEqual([]);
  });
});


it("defers Candidate-only pairwise requirements while measuring current deficiencies",async()=>{
  const project=fixture();
  const comparison={...project.acceptanceRubric[0]!,id:"SYS-PAIRWISE",title:"Relative improvement",requirement:"Candidate improves over current",weight:5,judgeType:"pairwise" as const};
  project.acceptanceRubric=[...project.acceptanceRubric.map(c=>({...c,weight:c.weight*0.95})),comparison];
  const pure={...project.evalSuite[0]!,id:"PAIRWISE",criterionIds:[comparison.id]};
  project.evalSuite=[{...project.evalSuite[0]!,criterionIds:["CONTENT",comparison.id]},...project.evalSuite.slice(1),pure];
  project.hiddenEvalSuite=[...project.hiddenEvalSuite,{...pure,id:"H-PAIRWISE",hidden:true}];
  const original=JSON.stringify(project.acceptanceRubric);
  const outcome=await runServerBaseline(project,{
    executeSemanticBatch:async({testCases})=>{
      expect(testCases.flatMap(t=>t.criterionIds)).not.toContain("SYS-PAIRWISE");
      return {results:testCases.map(t=>({testCaseId:t.id,output:"Observed full current guide. Required rollback instructions are absent.",trace:[]}))};
    },judge:async(payload)=>{
      expect(JSON.stringify(payload)).not.toContain('"criterionId":"SYS-PAIRWISE"');
      return judge();
    },
  });
  expect(outcome.ready).toBe(true);
  expect(outcome.project.stage).toBe("problem");
  expect(outcome.baseline.runs.find(r=>r.testCaseId==="PAIRWISE")?.verificationStatus).toBe("unverified");
  expect(outcome.baseline.result?.criterionScores?.find(s=>s.criterionId==="SYS-PAIRWISE")?.pass).toBe(false);
  expect(outcome.baseline.result?.criterionScores?.find(s=>s.criterionId==="CONTENT")).toMatchObject({verificationStatus:"verified",pass:false});
  expect(JSON.stringify(outcome.project.acceptanceRubric)).toBe(original);
  expect(outcome.project.hiddenEvalSuite.at(-1)?.criterionIds).toEqual([comparison.id]);
});


it("does not reuse a completed Baseline that failed required current hard evidence",async()=>{
  const project=fixture();
  const outcome=await runServerBaseline(project,{
    executeSemanticBatch:async({testCases})=>({results:testCases.map(t=>({testCaseId:t.id,output:"Install observed. UNVERIFIED rollback details outside the supplied index.",trace:[]}))}),
    judge:async()=>judge(),
  });
  expect(outcome.baseline.status).toBe("completed");
  expect(outcome.ready).toBe(false);
  expect(outcome.capabilityGaps).toContain("criterion:CONTENT");
  expect(canReuseServerBaseline(outcome.project)).toBe(false);
});

it("defers canonical original protection only in the current-only Baseline without inventing a pass",async()=>{
  const project=fixture();
  const protection={...project.acceptanceRubric[0]!,id:"PROTECT-ALL",title:"Protection compared with original",
    source:"protected-item" as const,judgeType:"pairwise" as const,validationMethod:"semantic-judge" as const,
    protectedConstraint:true,category:"protected" as const,weight:8,minScore:95,artifactIds:[],
    requirement:"以下保护项必须全部保持不变："+project.protectedItems.join("；"),
    evidenceExpected:project.protectedItems.map(item=>"与原始版本对比确认未破坏："+item)};
  project.acceptanceRubric=[...project.acceptanceRubric.map(c=>({...c,weight:c.weight*0.92})),protection];
  const pure={...project.evalSuite[0]!,id:"PROTECTED-PAIR",criterionIds:[protection.id],executionMode:"external-runner" as const,tags:["source-grounded-html-assertions"]};
  project.evalSuite=[{...project.evalSuite[0]!,criterionIds:["CONTENT",protection.id]},...project.evalSuite.slice(1),pure];
  project.hiddenEvalSuite=[...project.hiddenEvalSuite,{...pure,id:"H-PROTECTED-PAIR",hidden:true}];
  const originalContract=JSON.stringify([project.acceptanceRubric,project.evalSuite,project.hiddenEvalSuite]);
  let externalCalls=0;
  const outcome=await runServerBaseline(project,{
    executeSemanticBatch:async({testCases})=>{
      expect(testCases.flatMap(t=>t.criterionIds)).not.toContain("PROTECT-ALL");
      return {results:testCases.map(t=>({testCaseId:t.id,output:"Observed complete current installation instructions; rollback absent.",trace:[]}))};
    },
    executeExternalBatch:async({testCases})=>{externalCalls++;return testCases.map(t=>({testCaseId:t.id,output:"search measured only",verificationStatus:"verified" as const,latencyMs:1,cost:0,trace:[]}));},
    judge:async(payload)=>{expect(JSON.stringify(payload)).not.toContain('"criterionId":"PROTECT-ALL"');return judge();},
  });
  expect(outcome.ready).toBe(true);
  expect(externalCalls).toBe(0);
  expect(outcome.baseline.runs.find(r=>r.testCaseId===pure.id)).toMatchObject({verificationStatus:"unverified"});
  expect(outcome.baseline.result?.criterionScores?.find(c=>c.criterionId===protection.id)).toMatchObject({pass:false,verificationStatus:"unverified"});
  expect(outcome.baseline.result?.criterionScores?.find(c=>c.criterionId==="CONTENT")).toMatchObject({pass:false,verificationStatus:"verified"});
  expect(JSON.stringify([outcome.project.acceptanceRubric,outcome.project.evalSuite,outcome.project.hiddenEvalSuite])).toBe(originalContract);
  expect(canReuseServerBaseline(outcome.project)).toBe(true);
});

it("does not defer PROTECT on the paired Hidden current arm",async()=>{
 const project=fixture();
 const protect={...project.acceptanceRubric[0]!,id:"PROTECT-ALL",source:"protected-item" as const,judgeType:"pairwise" as const,
  protectedConstraint:true,category:"protected" as const,requirement:project.protectedItems.join("；"),evidenceExpected:project.protectedItems.map(item=>"与原始版本对比确认未破坏："+item)};
 project.acceptanceRubric=[protect];
 const hidden={...project.hiddenEvalSuite[0]!,id:"H-PROTECT",criterionIds:[protect.id]};
 const before=JSON.stringify(hidden);
 let calls=0;
 const runs=await executeServerCurrentArtifactSuite(project,[hidden],{executeSemanticBatch:async({testCases})=>{
  calls++;expect(testCases[0]!.criterionIds).toEqual(["PROTECT-ALL"]);
  return {results:[{testCaseId:hidden.id,output:"Current content measured; runtime protection UNVERIFIED.",trace:[]}]};
 },judge:async()=>judge()});
 expect(calls).toBe(1);
 expect(runs[0]).toMatchObject({testCaseId:hidden.id,verificationStatus:"partial"});
 expect(JSON.stringify(hidden)).toBe(before);
});
it("retains the current hard evidence requirement in a mixed comparison paper",async()=>{
 const project=fixture();
 const protect={...project.acceptanceRubric[0]!,id:"PROTECT-ALL",source:"protected-item" as const,judgeType:"pairwise" as const,
  protectedConstraint:true,category:"protected" as const,weight:8,requirement:project.protectedItems.join("；"),evidenceExpected:project.protectedItems.map(item=>"与原始版本对比确认未破坏："+item)};
 project.acceptanceRubric=[...project.acceptanceRubric.map(c=>({...c,weight:c.weight*0.92})),protect];
 project.evalSuite=project.evalSuite.map(c=>c.id==="V1"?{...c,criterionIds:["CONTENT","PROTECT-ALL"]}:c);
 project.hiddenEvalSuite.push({...project.hiddenEvalSuite[0]!,id:"H-PROTECT",criterionIds:["PROTECT-ALL"]});
 const result=await runServerBaseline(project,{executeSemanticBatch:async({testCases})=>({results:testCases.map(t=>({testCaseId:t.id,output:"UNVERIFIED current content unavailable",trace:[]}))}),judge:async()=>judge()});
 expect(result.ready).toBe(false);
 expect(result.capabilityGaps).toContain("criterion:CONTENT");
 expect(result.baseline.result?.criterionScores?.find(c=>c.criterionId==="PROTECT-ALL")).toMatchObject({pass:false,verificationStatus:"unverified"});
});

function originalHtmlDiagnosticFixture() {
  const project = fixture(), html = "<!doctype html><html><body><p>Current instructions omit configuration.</p></body></html>";
  project.sourceArtifacts = [{ ...project.sourceArtifacts[0]!, name: "source.html", extension: "html", mimeType: "text/html",
    inputMode: "upload", storageRef: "source-blob", size: new TextEncoder().encode(html).length, textContent: html }];
  project.acceptanceRubric = [{ ...project.acceptanceRubric[0]!, weight: 82 }, {
    id: "SYS-INTEGRITY", title: "成果完整性", requirement: "最终成果必须完整、无截断、无占位符、无未处理 TODO，且不能因进化丢失未授权内容。",
    source: "system-integrity", weight: 8, hardGate: true, judgeType: "integrity", validationMethod: "static-structure", minScore: 95,
    evidenceExpected: ["完整成果", "无 truncation / placeholder / unresolved TODO"], protectedConstraint: true, artifactIds: [], category: "integrity",
  }];
  project.acceptanceRubric.push({ ...project.acceptanceRubric[0]!, id: "READABLE", title: "Readable body",
    requirement: "Current body contains readable instructions", weight: 10, hardGate: false,
    judgeType: "structural", validationMethod: "static-structure", minScore: 70, evidenceExpected: ["Readable current body"] });
  project.evalSuite = [project.evalSuite[0]!, { ...project.evalSuite[2]!, id: "I", criterionIds: ["SYS-INTEGRITY", "READABLE"] }];
  project.hiddenEvalSuite = [project.hiddenEvalSuite[0]!, { ...project.evalSuite[1]!, id: "H-I", hidden: true }];
  const physical = { sourceArtifactId: "source", sha256: "a".repeat(64), byteLength: project.sourceArtifacts[0]!.size };
  const binding = { schemaVersion: "original-html-baseline-diagnostic-binding-v1", binding: {
    missionId: project.id, testCaseId: "I", criterionId: "SYS-INTEGRITY", paperSha256: "b".repeat(64),
    original: physical, executed: { ...physical }, subject: { kind: "current", versionId: project.version },
  } };
  const evaluated = { ...judge(), cases: [...judge().cases, { testCaseId: "I", accuracy: 95, evidence: 95, completeness: 95, reason: "Full file read" }],
    criteria: [...judge().criteria, { criterionId: "SYS-INTEGRITY", score: 95, pass: true, evidence: ["I: Full current file"], gaps: [], testCaseIds: ["I"] }, { criterionId: "READABLE", score: 95, pass: true, evidence: ["I: Readable body"], gaps: [], testCaseIds: ["I"] }] };
  let readCalls = 0;
  const ports = {
    readOriginalHtmlDiagnosticBinding: async () => { readCalls++; return structuredClone(binding); },
    buildCurrentArtifactContext: async () => [{ id: "source", content: html, artifactSha256: physical.sha256, truncated: false }],
    executeStoredEvidence: async ({ testCase }: { testCase: EvolveProject["evalSuite"][number] }) => ({ testCaseId: testCase.id,
      output: "Complete current physical HTML statically indexed; interaction remains unverified.", artifactHash: physical.sha256,
      latencyMs: 1, cost: 0, verificationStatus: "verified" as const, trace: [] }),
    executeSemanticBatch: async ({ testCases }: { testCases: EvolveProject["evalSuite"] }) => ({ results: testCases.map(testCase => ({
      testCaseId: testCase.id, output: "Complete current instructions inspected; configuration details are absent.", trace: [],
    })) }),
    judge: async () => structuredClone(evaluated),
  };
  return { project, physical, binding, evaluated, ports, readCalls: () => readCalls };
}
describe("fresh physical original HTML Baseline diagnosis without protection promotion", () => {
  it("continues to current diagnosis with actual-context hash and independent Judge while strict reuse stays false", async () => {
    const f = originalHtmlDiagnosticFixture(), paper = JSON.stringify([f.project.acceptanceRubric, f.project.evalSuite, f.project.hiddenEvalSuite]);
    const outcome = await runServerBaseline(f.project, f.ports);
    expect(outcome.ready).toBe(true); expect(outcome.project.stage).toBe("problem"); expect(f.readCalls()).toBe(2);
    expect(outcome.diagnosticEligibility?.binding.executed).toEqual(f.physical);
    expect(outcome.capabilityGaps).toContain("criterion:SYS-INTEGRITY");
    expect(outcome.baseline.result?.criterionScores?.find(score => score.criterionId === "SYS-INTEGRITY")).toMatchObject({ verificationStatus: "partial", pass: false });
    expect(outcome.baseline.result?.criterionScores?.find(score => score.criterionId === "CONTENT")).toMatchObject({ verificationStatus: "verified", pass: false });
    expect(outcome.baseline.runs.find(run => run.testCaseId === "V1")?.artifactHash).toBe(f.physical.sha256);
    expect(canReuseServerBaseline(outcome.project)).toBe(false);
    expect(JSON.stringify([outcome.project.acceptanceRubric, outcome.project.evalSuite, outcome.project.hiddenEvalSuite])).toBe(paper);
    expect(outcome.project.baselineRun).not.toHaveProperty("diagnosticEligibility");
  });
  it("cannot derive qualification from a stored score without the internal physical port", async () => {
    const f = originalHtmlDiagnosticFixture(), { readOriginalHtmlDiagnosticBinding: _read, ...ports } = f.ports; void _read;
    const outcome = await runServerBaseline(f.project, ports);
    expect(outcome.ready).toBe(false); expect(outcome.diagnosticEligibility).toBeUndefined();
    expect(outcome.capabilityGaps).toContain("criterion:SYS-INTEGRITY");
  });
  it.each(["context-hash", "readback-drift", "missing-context-hash", "truncated-context", "physical-port-failure"])("keeps %s pending instead of relabeling a later file", async variant => {
    const f = originalHtmlDiagnosticFixture();
    const ports = { ...f.ports,
      buildCurrentArtifactContext: async () => [{ id: "source", content: "Actual content", truncated: variant === "truncated-context",
        ...(variant === "missing-context-hash" ? {} : { artifactSha256: variant === "context-hash" ? "c".repeat(64) : f.physical.sha256 }) }],
      readOriginalHtmlDiagnosticBinding: async () => {
        if (variant === "physical-port-failure") throw Error("Actual file unavailable");
        const value = await f.ports.readOriginalHtmlDiagnosticBinding();
        if (variant === "readback-drift" && f.readCalls() > 1) {
          value.binding.executed.sha256 = "c".repeat(64); value.binding.original.sha256 = "c".repeat(64);
        }
        return value;
      },
    };
    const outcome = await runServerBaseline(f.project, ports);
    expect(outcome.ready).toBe(false); expect(outcome.diagnosticEligibility).toBeUndefined();
  });
  it.each(["FAIL", "REVIEW", "missing-integrity", "foreign-case", "duplicate-criterion"])("retains %s independent Judge boundary", async variant => {
    const f = originalHtmlDiagnosticFixture();
    if (variant === "FAIL" || variant === "REVIEW") f.evaluated.safety = variant;
    if (variant === "missing-integrity") f.evaluated.criteria = f.evaluated.criteria.filter(criterion => criterion.criterionId !== "SYS-INTEGRITY");
    if (variant === "foreign-case") f.evaluated.cases[0]!.testCaseId = "foreign";
    if (variant === "duplicate-criterion") f.evaluated.criteria.push(f.evaluated.criteria[0]!);
    const outcome = await runServerBaseline(f.project, f.ports);
    expect(outcome.ready).toBe(false); expect(outcome.diagnosticEligibility).toBeUndefined();
  });
  it("preserves honest current capability failure and never allows it through the SYS-only ceiling", async () => {
    const f = originalHtmlDiagnosticFixture();
    const outcome = await runServerBaseline(f.project, { ...f.ports, executeSemanticBatch: async () => ({ results: [{
      testCaseId: "V1", output: "UNVERIFIED current content observation unavailable", trace: [],
    }] }) });
    expect(outcome.ready).toBe(false); expect(outcome.capabilityGaps).toContain("V1");
    expect(outcome.diagnosticEligibility).toBeUndefined();
  });
});
