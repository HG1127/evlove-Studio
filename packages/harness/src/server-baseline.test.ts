import { describe, expect, it, vi } from "vitest";
import type { EvaluateAiResult, EvolveProject, TargetRunResult } from "@evolution/contracts";
import { campaignScoringInputFingerprint, fastHash } from "@evolution/core";
import { canReuseServerBaseline, runServerBaseline } from "./server-baseline";
import { serverBaselineFingerprint } from "./server-baseline-evidence";

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
  it("diagnoses a measured document deficiency after locking Original bytes without accepting the future Candidate",async()=>{
    const p=fixture();
    p.sourceArtifacts[0]={...p.sourceArtifacts[0]!,extension:"html",mimeType:"text/html",inputMode:"upload",storageRef:"original",size:1000};
    p.acceptanceRubric.forEach(c=>c.weight=c.id==="CONTENT"?45:c.id==="FORMAT"?25:15);
    p.acceptanceRubric.push({id:"PROTECT",title:"保留原版",requirement:"保留原版格式与交互",source:"protected-item",weight:10,
      hardGate:true,judgeType:"pairwise",validationMethod:"semantic-judge",minScore:95,evidenceExpected:["原版对照"],protectedConstraint:true,
      artifactIds:["source"],category:"protected"});
    p.acceptanceRubric.push({...p.acceptanceRubric.at(-1)!,id:"SYS-PAIRWISE",title:"相对原版改进",source:"system-integrity",weight:5});
    p.evalSuite[0]!.criterionIds.push("SYS-PAIRWISE");
    p.hiddenEvalSuite[0]!.criterionIds.push("SYS-PAIRWISE");
    p.evalSuite.push({...p.evalSuite[0]!,id:"VP",title:"保护项浏览器检查",criterionIds:["PROTECT"],executionMode:"external-runner"});
    p.hiddenEvalSuite.push({...p.evalSuite.at(-1)!,id:"HP",hidden:true});
    const proof={schemaVersion:"original-artifact-reference-v1",missionId:p.id,sourceArtifactId:"source",blobId:"original",sha256:"a".repeat(64),sizeBytes:1000};
    const context={id:"source",artifactSha256:proof.sha256,content:"完整原文：缺少重试说明。",originalChars:1000,projectionChars:12,truncated:false,
      contextRepresentation:"complete-html-static-text-projection",excludes:["scripts","styles","visual-fidelity","runtime-behavior"],originalReference:proof};
    const executeSemanticBatch=vi.fn(async()=>{throw Error("Reading the actual document must not need an invented execution summary");});
    const seenRubrics:string[][]=[];
    const ports={executeSemanticBatch,buildCurrentArtifactContext:async()=>[context],
      executeStoredEvidence:async({testCase}:{testCase:{id:string}})=>({testCaseId:testCase.id,output:"exact current file evidence",verificationStatus:"verified" as const,latencyMs:1,cost:0,trace:[]}),
      executeExternalBatch:async()=>[{testCaseId:"VP",output:"browser observation fixture",verificationStatus:"verified" as const,latencyMs:1,cost:0,trace:[]}],
      judge:async(payload:unknown)=>{
        seenRubrics.push((payload as {acceptanceRubric:Array<{id:string}>}).acceptanceRubric.map(c=>c.id));
        return {...judge(),criteria:p.acceptanceRubric.filter(c=>c.id!=="PROTECT").map(c=>({criterionId:c.id,score:c.id==="CONTENT"?82:99,
          pass:c.id!=="CONTENT",evidence:["实际当前内容"],gaps:c.id==="CONTENT"?["缺重试说明"]:[],testCaseIds:c.id==="CONTENT"?["V1"]:c.id==="FORMAT"?["V2"]:["V3"]}))};
      }};
    const result=await runServerBaseline(p,ports);
    expect(result.ready).toBe(true);expect(result.project.stage).toBe("problem");
    expect(result.baseline.result?.criterionScores?.find(c=>c.criterionId==="CONTENT")).toMatchObject({score:82,pass:false,verificationStatus:"verified"});
    expect(result.baseline.result?.criterionScores?.find(c=>c.criterionId==="PROTECT")?.pass).toBe(false);
    expect(result.baseline.result?.criterionScores?.find(c=>c.criterionId==="SYS-PAIRWISE"))
      .toMatchObject({score:0,pass:false,verificationStatus:"unverified",testCaseIds:["V1"]});
    expect(result.baseline.result?.unverifiedCriterionIds).toContain("SYS-PAIRWISE");
    expect(result.baseline.referenceOnlyCriterionIds).toEqual(["PROTECT"]);
    expect(result.baseline.originalReferences).toEqual([proof]);
    expect(seenRubrics[0]).not.toContain("PROTECT");
    expect(seenRubrics[0]).not.toContain("SYS-PAIRWISE");
    expect(executeSemanticBatch).not.toHaveBeenCalled();
    const missing=await runServerBaseline(p,{...ports,buildCurrentArtifactContext:async()=>[{...context,originalReference:undefined}]});
    expect(missing.ready).toBe(false);expect(missing.reason).toContain("PROTECT");
    const noBrowser=await runServerBaseline(p,{...ports,executeExternalBatch:undefined});
    expect(noBrowser.ready).toBe(false);expect(noBrowser.capabilityGaps).toContain("VP");
  });

  it("gives the independent judge the same current source context rather than only model observations",async()=>{
    const project=fixture();
    project.sourceArtifacts[0]={...project.sourceArtifacts[0]!,inputMode:"upload",storageRef:"actual-upload"};
    const exact={id:"source",content:"原版完整正文：实际安装步骤；尚缺回滚操作。 END-OF-CURRENT-DOCUMENT",truncated:false,originalChars:42};
    const observed=vi.fn(async()=>({results:[{testCaseId:"V1",output:"已观察到安装步骤，原版缺回滚操作。",trace:[]}]}));
    const independent=vi.fn(async(payload:unknown)=>{
      expect(payload).toMatchObject({artifactContext:[exact]});
      expect(JSON.stringify(payload)).toContain("END-OF-CURRENT-DOCUMENT");
      expect(JSON.stringify(payload)).not.toContain("H1");
      return judge();
    });
    await runServerBaseline(project,{buildCurrentArtifactContext:async()=>[exact],executeSemanticBatch:observed,judge:independent});
    expect(independent).toHaveBeenCalledOnce();
    expect(observed).toHaveBeenCalledOnce();
  });

  it("uses exact current Markdown defect as VERIFIED failure without sending that criterion to Judge",async()=>{
    const project=fixture();
    const text=["# 中文投资研究报告规范","## 角色","你是研究助手。",
      "## 当前缺陷","历史版本容易写出没有证据来源的核心论点。","## 边界","不得编造事实。"].join("\n");
    project.sourceArtifacts=[{...project.sourceArtifacts[0]!,textContent:text,
      textExcerpt:text,size:new TextEncoder().encode(text).byteLength}];
    project.evolutionCommand="重要结论必须绑定可核验出处";
    project.acceptanceRubric[0]={...project.acceptanceRubric[0]!,id:"USER-PRIMARY-INTENT",requirement:"重要结论绑定可核验来源"};
    project.evalSuite[0]={...project.evalSuite[0]!,criterionIds:["USER-PRIMARY-INTENT"]};
    project.hiddenEvalSuite[0]={...project.hiddenEvalSuite[0]!,criterionIds:["USER-PRIMARY-INTENT"]};
    let modelCalls=0,judgeCalls=0;
    const ports={executeSemanticBatch:async()=>{modelCalls++;throw new Error("No model response");},
      judge:async(payload:unknown)=>{
        judgeCalls++;
        const scoped=payload as {acceptanceRubric:Array<{id:string}>};
        expect(scoped.acceptanceRubric.map(c=>c.id)).not.toContain("USER-PRIMARY-INTENT");
        return {...judge(),cases:[{testCaseId:"V3",accuracy:98,evidence:98,completeness:98,reason:"当前正文可读取"}],
          criteria:[{criterionId:"STRUCTURE",score:98,pass:true,evidence:["V3 实际正文"],gaps:[],testCaseIds:["V3"]}]};
      }};
    const measured=await runServerBaseline(project,ports);
    expect(modelCalls).toBe(0);
    expect(judgeCalls).toBe(1); // The independent structure criterion still requires Judge.
    expect(measured.ready).toBe(true);
    expect(measured.project.stage).toBe("problem");
    expect(measured.baseline.runs.find(r=>r.testCaseId==="V1")).toMatchObject({
      verificationStatus:"verified",trace:[{stage:"baseline-exact-source-negative-evidence",status:"pass"}],
    });
    expect(measured.baseline.result?.criterionScores?.find(c=>c.criterionId==="USER-PRIMARY-INTENT"))
      .toMatchObject({score:0,pass:false,verificationStatus:"verified"});
    const incomplete="# 中文投资研究报告规范\n## 角色\n请引用来源。";
    const ungrounded={...project,sourceArtifacts:[{...project.sourceArtifacts[0]!,textContent:incomplete,
      textExcerpt:incomplete,size:new TextEncoder().encode(incomplete).byteLength}]};
    const blocked=await runServerBaseline(ungrounded,ports);
    expect(blocked.ready).toBe(false);
    expect(blocked.baseline.result?.criterionScores?.find(c=>c.criterionId==="USER-PRIMARY-INTENT")?.verificationStatus).toBe("unverified");
  });

  it("defers a source-inspected UNKNOWN soft objective while preserving exact original hard evidence",async()=>{
    const project=fixture();
    project.evalSuite[2]={...project.evalSuite[2]!,executionMode:"artifact-runtime"};
    const runner=async({testCases}:{testCases:Array<{id:string}>})=>({
      results:testCases.map(testCase=>testCase.id==="V3"
        ?{testCaseId:testCase.id,output:"UNVERIFIED - 原版没有具体核验步骤",
          trace:[{id:"source-inspection",stage:"inspect",status:"fail" as const,summary:"原文未定义步骤"}]}
        :{testCaseId:testCase.id,output:"当前说明包含安装步骤但验证与回滚不足",trace:[]}),
    });
    const ports={executeSemanticBatch:runner,judge:async()=>judge()};
    const result=await runServerBaseline(project,ports);
    expect(result.ready).toBe(true);
    expect(result.project.stage).toBe("problem");
    expect(result.project.baselineRun.runs.find(run=>run.testCaseId==="V3")?.verificationStatus).toBe("unverified");
    expect(result.project.baselineRun.result?.criterionScores?.find(row=>row.criterionId==="STRUCTURE"))
      .toMatchObject({verificationStatus:"unverified",pass:false});
    expect(result.project.baselineRun.result?.criterionScores?.find(row=>row.criterionId==="CONTENT"))
      .toMatchObject({verificationStatus:"verified",pass:false});
    expect(result.reason).toContain("原版非强制题仍为 UNVERIFIED");
    expect(result.capabilityGaps).toEqual([]);
    expect(canReuseServerBaseline(result.project)).toBe(true);

    const hard=fixture();
    hard.evalSuite[2]={...hard.evalSuite[2]!,executionMode:"artifact-runtime"};
    hard.acceptanceRubric[2]={...hard.acceptanceRubric[2]!,hardGate:true};
    hard.hiddenEvalSuite.push({...hard.hiddenEvalSuite[0]!,id:"H3",criterionIds:["STRUCTURE"]});
    const mustBlock=await runServerBaseline(hard,ports);
    expect(mustBlock.ready).toBe(false);
    expect(mustBlock.reason).toContain("STRUCTURE");
    expect(mustBlock.project.campaign.status).toBe("paused");

    const mixed=fixture();
    mixed.evalSuite[2]={...mixed.evalSuite[2]!,criterionIds:["STRUCTURE","CONTENT"],executionMode:"artifact-runtime"};
    const noMixedWaiver=await runServerBaseline(mixed,ports);
    expect(noMixedWaiver.ready).toBe(false);

    const noReceipt=await runServerBaseline(project,{
      ...ports,
      executeSemanticBatch:async({testCases})=>({
        results:testCases.filter(t=>t.id!=="V3").map(t=>({
          testCaseId:t.id,output:"观察到安装步骤，但验证与回滚不足",trace:[],
        })),
      }),
    });
    expect(noReceipt.ready).toBe(false);
    expect(noReceipt.capabilityGaps).toContain("V3");
    expect(noReceipt.baseline.runs.find(r=>r.testCaseId==="V3")?.verificationStatus).toBe("unverified");
  });

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

  it("defers comparison-only SYS-PAIRWISE until Candidate Holdout while preserving other hard gates",async()=>{
    const project=fixture();
    project.acceptanceRubric=[
      {...project.acceptanceRubric[0]!,weight:50},
      {...project.acceptanceRubric[1]!,weight:30},
      {...project.acceptanceRubric[2]!,weight:10},
      {id:"SYS-PAIRWISE",title:"相对原版真实改进",requirement:"候选必须相对原版真实改进",source:"system-integrity",weight:10,hardGate:true,judgeType:"pairwise",validationMethod:"semantic-judge",minScore:85,evidenceExpected:["Original vs Evolved"],protectedConstraint:false,artifactIds:[],category:"outcome"},
    ];
    const pairCase={id:"V-PAIRWISE",title:"相对原版比较",input:"候选是否优于原版",expected:["真实提升"],tags:[],hidden:false,criterionIds:["SYS-PAIRWISE"],executionMode:"artifact-runtime" as const,evidenceScope:"product-behavior" as const};
    project.evalSuite.push(pairCase);
    project.hiddenEvalSuite.push({...pairCase,id:"H-PAIRWISE",hidden:true});
    const outcome=await runServerBaseline(project,{
      executeSemanticBatch:async({testCases})=>({results:testCases.map((testCase)=>({testCaseId:testCase.id,output:"当前说明包含安装步骤，但验证与回滚说明不足。",trace:[]}))}),
      judge:async()=>judge(),
    });
    expect(outcome.ready).toBe(true);
    expect(outcome.project.stage).toBe("problem");
    expect(outcome.baseline.result?.criterionScores?.find((item)=>item.criterionId==="SYS-PAIRWISE")?.verificationStatus).not.toBe("verified");
    expect(outcome.project.campaign.checkpoint).toMatchObject({round:1,completedPhase:"baseline"});
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
