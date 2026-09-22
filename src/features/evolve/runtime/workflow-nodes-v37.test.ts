import { deriveNextWorkflowAction, deriveWorkflowSteps, deriveWorkflowGates } from "./workflow-engine";
import { resetForProblem } from "./downstream";
import { describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { AcceptanceCriterionSchema, CandidateArtifactSnapshotSchema, CandidateSchema, EvolveProjectSchema, type EvolveProject } from "../schemas";
import { humanStageEvidence, preferredInternalStage, stepCompleted, stepUnlocked, workflowStepState } from "./real-evolution-workflow";
import { behaviorRepairAttemptLimit, validationRepairCriteria, validationAfterRepair } from "./artifact-loop";

const project = () => EvolveProjectSchema.parse(structuredClone(demoProject));
function markTailPrerequisites(p: EvolveProject) {
  p.acceptanceRubric = [
    AcceptanceCriterionSchema.parse({ id:"TAIL-1",title:"目标",requirement:"目标达成",source:"user-command",weight:40,hardGate:true }),
    AcceptanceCriterionSchema.parse({ id:"TAIL-2",title:"完整",requirement:"成果完整",source:"system-integrity",weight:30,hardGate:true }),
    AcceptanceCriterionSchema.parse({ id:"TAIL-3",title:"改进",requirement:"相对原版改进",source:"source-understanding",weight:30,hardGate:false }),
  ];
  p.acceptanceRubricState = { status:"ready",summary:"ready",version:1,weightTotal:100,uncoveredCriterionIds:[],warnings:[] };
  p.gates = p.gates.map((gate) => gate.id === "target-ready" || gate.id === "experiment-ready" || gate.id === "artifact-ready"
    ? { ...gate, status:"approved" as const }
    : gate);
  p.diagnosis = { problemId:p.selectedProblemId ?? "p1",rootCause:"cause",summary:"summary",affectedComponent:"workflow",confidence:0.9,evidence:["verified trace"],evidenceRefs:[],counterEvidence:[],falsifier:"retest",suggestedScopes:["workflow"],trace:[] };
}

describe("五步流程的证据与前置关系", () => {
  it("切换问题使下游失效，保留原版基线且同问题不重置", () => {
    const p = project(); p.selectedProblemId = "old";
    const next = resetForProblem(p, "new");
    expect(next.baselineRun).toEqual(p.baselineRun);
    expect(next.acceptanceRubric).toEqual(p.acceptanceRubric);
    expect(next.diagnosis).toBeUndefined();
    expect(next.experimentRun.status).toBe("idle");
    expect(next.validationRun.status).toBe("idle");
    expect(resetForProblem(next, "new")).toBe(next);
  });
  it("旧问题诊断不能解锁新问题的生成步骤", () => {
    const p = project(); p.baselineRun.status = "completed"; p.selectedProblemId = "new";
    p.baselineRun.totalCases = p.evalSuite.length;
    p.baselineRun.result = { ...p.baselineRun.result!, demoJudged: false };
    p.baselineRun.runs = p.evalSuite.map((testCase) => ({ testCaseId: testCase.id, output: "usable evidence", latencyMs: 1, cost: 0, trace: [], verificationStatus: "verified" }));
    p.diagnosis = { problemId: "old", rootCause: "cause", summary: "summary", affectedComponent: "prompt", confidence: 0.8, evidence: ["trace"], evidenceRefs: [], counterEvidence: [], falsifier: "test", suggestedScopes: ["prompt"], trace: [] };
    expect(stepUnlocked(p, "evolve")).toBe(false);
    p.diagnosis!.problemId = "new";
    expect(stepUnlocked(p, "evolve")).toBe(true);
    p.diagnosis!.evidence = [];
    expect(stepUnlocked(p, "evolve")).toBe(false);
  });
  it("只有 winner ID 而没有实际实验文件不能进入验证", () => {
    const p = project(); p.experimentRun = { id: "e", status: "completed", winnerId: "C", candidateResults: [] };
    expect(stepUnlocked(p, "verify")).toBe(false);
    expect(workflowStepState(p, "verify").detail).toContain("真实候选文件");
  });
  it("预筛结果与演示评测不能作为完成全量实验", () => {
    const p = project();
    const result = { candidateId: "C", evaluation: { ...p.baselineRun.result!, safety: "PASS" as const, demoJudged: false }, runs: [], artifactSnapshots: [CandidateArtifactSnapshotSchema.parse({ id: "a", sourceArtifactId: "s", name: "x.md", mimeType: "text/markdown", content: "new", createdAt: "now" })], experimentStage: "screened" as "screened" | "finalist" };
    p.experimentRun = { id: "e", status: "completed", winnerId: "C", candidateResults: [result] };
    expect(stepCompleted(p, "evolve")).toBe(false);
    result.experimentStage = "finalist";
    expect(stepCompleted(p, "evolve")).toBe(true);
    result.evaluation.demoJudged = true;
    expect(stepCompleted(p, "evolve")).toBe(false);
  });
  it("有候选但实验未确认时返回方案选择页", () => {
    const p = project(); p.gates = p.gates.map(g => ({ ...g, status: "pending" }));
    expect(preferredInternalStage(p, "evolve")).toBe("plan");
  });
  it("领取成果不以线上发布或经验提炼为前提", () => {
    const p = project(); p.release.status = "promoted";
    expect(preferredInternalStage(p, "deliver")).toBe("release");
  });
  it("fast gate truthfully reports executed coverage and confirmed failures", () => {
    const p = project();
    const candidate=CandidateSchema.parse({id:"candidate",name:"候选",change:"补齐 Git 配置"});
    p.candidates=[candidate];
    p.experimentRun={id:"e",status:"completed",winnerId:candidate.id,candidateResults:[{candidateId:candidate.id,evaluation:p.baselineRun.result!,runs:[],artifactSnapshots:[CandidateArtifactSnapshotSchema.parse({id:"snap",sourceArtifactId:"source",name:"x.html",mimeType:"text/html",content:"changed",createdAt:"now"})],experimentStage:"finalist"}]};
    p.validationRun={id:"v",status:"completed",validationMode:"fast-gate",plannedCases:8,executedCases:4,candidateId:candidate.id,evaluation:{...p.baselineRun.result!,unverifiedCriterionIds:["C2","C3"]},runs:[],baselineRuns:[],checks:[{label:"Hard Gate · Git 配置",status:"fail",detail:"缺少 SSH"}],recommendation:"hold",summary:"快速阻断检查"};
    p.artifactAcceptance={...p.artifactAcceptance,status:"unverified",results:[],hardGatePass:false};
    const evidence=humanStageEvidence(p,"verify");
    expect(evidence.read[0]).toContain("4/8");
    expect(evidence.outputs.join(" ")).toContain("Git 配置");
    expect(evidence.outputs.join(" ")).not.toContain("没有已证实的失败项");
    expect(workflowStepState(p,"verify").label).toBe("尚未达标");
  });
  it("simple TXT behavior repair stops after two targeted attempts instead of repeating three full holdouts", () => {
    const p = project();
    p.objectType = "document";
    p.sourceArtifacts = [{ ...p.sourceArtifacts[0]!, artifactKind:"document", name:"workflow.txt", extension:"txt", mimeType:"text/plain", textContent:"完整文本" }];
    expect(behaviorRepairAttemptLimit(p, 3)).toBe(2);
    expect(behaviorRepairAttemptLimit(project(), 3)).toBe(3);
  });

  it("自动修复只接收已有真实证据的失败标准", () => {
    const p = project();
    p.acceptanceRubric = [
      AcceptanceCriterionSchema.parse({ id: "confirmed", title: "已证实失败", requirement: "正文必须完整", hardGate: true }),
      AcceptanceCriterionSchema.parse({ id: "pending", title: "等待外部证据", requirement: "浏览器中可操作", hardGate: true, validationMethod: "visual-review" }),
    ];
    const [confirmed, pending] = p.acceptanceRubric;
    expect(confirmed).toBeDefined();
    expect(pending).toBeDefined();
    const validation = {
      ...p.validationRun,
      status: "completed" as const,
      recommendation: "hold" as const,
      evaluation: {
        ...p.baselineRun.result!,
        criterionScores: [
          { criterionId: confirmed!.id, score: 60, pass: false, verificationStatus: "verified" as const, evidence: ["已定位缺失内容"], gaps: ["未达标"], testCaseIds: ["h1"] },
          { criterionId: pending!.id, score: 0, pass: false, verificationStatus: "unverified" as const, evidence: [], gaps: ["等待视觉证据"], testCaseIds: ["h2"] },
        ],
      },
    };
    expect(validationRepairCriteria(p, validation).map((criterion) => criterion.id)).toEqual([confirmed!.id]);
  });
  it("offline artifact tasks skip production traffic and continue into Lesson then Next Queue", () => {
    const p = project();
    markTailPrerequisites(p);
    const candidate = CandidateSchema.parse({
      id:"offline-winner", name:"离线成果", change:"完成文档进化", status:"passed", artifactBuildStatus:"ready",
      artifactSnapshots:[CandidateArtifactSnapshotSchema.parse({ id:"snap-offline",sourceArtifactId:"demo-prompt",name:"result.txt",mimeType:"text/plain",content:"final",contentHash:"hash-final",createdAt:"now" })],
    });
    p.targetConnection = { adapter:"artifact", connectionId:"artifact-runtime", status:"connected", label:"AI Artifact Runtime" };
    p.candidates = [candidate];
    p.experimentRun = { id:"exp-offline", status:"completed", winnerId:candidate.id, candidateResults:[] };
    p.validationRun = { id:"val-offline", status:"completed", candidateId:candidate.id, recommendation:"release", checks:[], runs:[], baselineRuns:[] };
    p.artifactAcceptance = { ...p.artifactAcceptance, status:"passed", candidateId:candidate.id, hardGatePass:true, overallScore:96, coverageScore:96, integrityScore:96, pairwiseScore:96 };
    p.outputArtifacts = [{ id:"out",projectId:p.id,round:1,versionLabel:"S1",candidateId:candidate.id,name:"result.txt",mimeType:"text/plain",kind:"primary",content:"final",description:"accepted",sourceArtifactIds:["demo-prompt"],isChampion:true,accepted:true,createdAt:"now",frozenArtifact:{} as never } as EvolveProject["outputArtifacts"][number]];

    const steps = deriveWorkflowSteps(p);
    expect(steps.filter((item)=>["19","20","21"].includes(item.id)).every((item)=>item.state==="skipped")).toBe(true);
    expect(deriveWorkflowGates(p).find((gate)=>gate.id==="D")?.state).toBe("skipped");
    expect(deriveWorkflowGates(p).find((gate)=>gate.id==="E")?.state).toBe("ready");
    expect(deriveNextWorkflowAction(p).id).toBe("distill");

    p.lessons = [{ id:"lesson-offline",title:"离线经验",summary:"有效",reusable:true,effect:"改善",limit:"仅离线验证",trigger:[],method:[],validatedOn:["离线成果"],status:"lesson" }];
    expect(deriveNextWorkflowAction(p).id).toBe("next-queue");
    p.nextQueue = [{ id:"next",title:"下一轮",reason:"继续改善",priority:"P1",source:"lesson",suggestedMetrics:[] }];
    expect(deriveNextWorkflowAction(p).id).toBe("complete");
    expect(deriveWorkflowGates(p).find((gate)=>gate.id==="E")?.state).toBe("passed");
  });

  it("explicit HTTP release target keeps the production release branch after Artifact Ready", () => {
    const p = project();
    markTailPrerequisites(p);
    const candidate = CandidateSchema.parse({ id:"online-winner",name:"线上候选",change:"ready",status:"passed",artifactBuildStatus:"ready",artifactSnapshots:[CandidateArtifactSnapshotSchema.parse({id:"snap-online",sourceArtifactId:"demo-prompt",name:"app.txt",mimeType:"text/plain",content:"ready",contentHash:"hash-online",createdAt:"now"})] });
    p.targetConnection = { adapter:"http", connectionId:"live", status:"connected", label:"Production Runner" };
    p.releaseTarget={provider:"http",mode:"preview-promote",status:"connected",label:"HTTP Release",connectionId:"release-http",healthPath:"/"};
    p.candidates=[candidate];
    p.experimentRun={id:"exp-online",status:"completed",winnerId:candidate.id,candidateResults:[]};
    p.validationRun={id:"val-online",status:"completed",candidateId:candidate.id,recommendation:"release",checks:[],runs:[],baselineRuns:[]};
    p.artifactAcceptance={...p.artifactAcceptance,status:"passed",candidateId:candidate.id,hardGatePass:true,overallScore:96,coverageScore:96,integrityScore:96,pairwiseScore:96};
    p.outputArtifacts=[{id:"out-online",projectId:p.id,round:1,versionLabel:"S1",candidateId:candidate.id,name:"app.txt",mimeType:"text/plain",kind:"primary",content:"ready",description:"accepted",sourceArtifactIds:["demo-prompt"],isChampion:true,accepted:true,createdAt:"now",frozenArtifact:{} as never} as EvolveProject["outputArtifacts"][number]];
    p.gates=p.gates.map((gate)=>gate.id==="release-ready"?{...gate,status:"ready"}:gate);

    expect(deriveWorkflowSteps(p).find((item)=>item.id==="19")?.state).toBe("blocked");
    expect(deriveWorkflowGates(p).find((gate)=>gate.id==="D")?.state).toBe("pending");
    expect(deriveNextWorkflowAction(p).id).toBe("gate-release");
    p.gates=p.gates.map((gate)=>gate.id==="release-ready"?{...gate,status:"approved"}:gate);
    expect(deriveNextWorkflowAction(p).id).toBe("shadow");
  });
});

it("invalidates old validation when the artifact is repaired even if candidate id stays the same", () => {
  const next = validationAfterRepair({ id: "old", status: "completed", recommendation: "release", runs: [], baselineRuns: [], checks: [] }, { id: "same-id" } as Parameters<typeof validationAfterRepair>[1]);
  expect(next.status).toBe("idle");
  expect(next.recommendation).toBe("hold");
  expect(next.evaluation).toBeUndefined();
  expect(next.checks).toEqual([]);
});

it("does not show old holdout completion when the new experiment has no winner", () => {
  const p = project();
  p.experimentRun = { id: "new", status: "completed", candidateResults: [] };
  p.validationRun = { id: "old", candidateId: "old-candidate", status: "completed", recommendation: "release", checks: [], runs: [], baselineRuns: [] };
  const steps = deriveWorkflowSteps(p);
  expect(deriveWorkflowGates(p).find((item) => item.id === "C")?.state).toBe("pending");
  expect(steps.find((item) => item.id === "14")?.state).toBe("blocked");
  expect(steps.find((item) => item.id === "15")?.state).toBe("blocked");
});
