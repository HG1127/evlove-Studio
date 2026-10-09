import { describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { CandidateArtifactSnapshotSchema, CandidateSchema } from "../schemas";
import { evidenceFingerprint } from "./evidence-binding";
import type { EvolveProject } from "../schemas";
import { deriveAttentionRequest, deriveAutonomousDecision, LOCAL_REVIEW_CONTRACT_VERSION, reconcileAttentionRequest } from "./autonomous-orchestrator";
import { buildServerHarnessPlan } from "@evolution/harness";
import { describeArtifact } from "@evolution/core";

function frozenFor(candidate:EvolveProject["candidates"][number]){
  const snapshot=candidate.artifactSnapshots[0]!;
  return [{sourceArtifactId:snapshot.sourceArtifactId,snapshotHash:"tested-content",blobId:"frozen-tested-content",
    name:snapshot.name,mimeType:snapshot.mimeType,sha256:"verified-bytes",size:snapshot.content.length,
    verifiedAt:"2026-09-20T00:00:00Z",checks:["roundtrip"],limitations:[]}];
}
function project(patch: Partial<EvolveProject> = {}): EvolveProject {
  return { ...demoProject, ...patch } as EvolveProject;
}

describe("autonomous orchestrator", () => {
  it("classifies a Demo-judged Baseline pause as model capability instead of a budget limit", () => {
    const p = project({
      stage: "baseline",
      inputUnderstanding: { status: "ready", intentRestatement: "优化", implicitRequirements: [], assumptions: [], acceptanceFocus: [], confidence: 0.9, clarifications: [] },
      baselineRun: { ...demoProject.baselineRun, result: { ...demoProject.baselineRun.result!, demoJudged: true } },
      campaign: { ...demoProject.campaign, status: "paused", stopReason: "当前版本基线不足以进入自动诊断：评审使用了演示兜底，不能作为问题诊断依据" },
      attentionRequests: [],
    });
    const request = deriveAttentionRequest(p);
    expect(request?.type).toBe("capability");
    expect(request?.stage).toBe("baseline");
    expect(request?.suggestedAction).toContain("真实评审模型");
    expect(request?.title).not.toContain("安全边界");
  });
  it("classifies incomplete non-Demo Baseline evidence as capability rather than a budget limit", () => {
    const p = project({
      stage: "baseline",
      inputUnderstanding: { status: "ready", intentRestatement: "优化", implicitRequirements: [], assumptions: [], acceptanceFocus: [], confidence: 0.9, clarifications: [] },
      baselineRun: { ...demoProject.baselineRun, result: { ...demoProject.baselineRun.result!, demoJudged: false } },
      campaign: { ...demoProject.campaign, status: "paused", stopReason: "当前版本基线不足以进入自动诊断：可用证据覆盖仅 20%，至少需要 60%" },
      attentionRequests: [],
    });
    const request = deriveAttentionRequest(p);
    expect(request?.type).toBe("capability");
    expect(request?.stage).toBe("baseline");
    expect(request?.title).toContain("可靠验证证据");
    expect(request?.suggestedAction).toContain("Target Runner");
  });
  it("classifies a failed Baseline Judge call as a model capability even before a new result persists", () => {
    const p = project({
      stage: "target",
      inputUnderstanding: { status: "ready", intentRestatement: "优化", implicitRequirements: [], assumptions: [], acceptanceFocus: [], confidence: 0.9, clarifications: [] },
      campaign: { ...demoProject.campaign, status: "paused", stopReason: "Baseline 评审未完成，已保留断点：模型返回无效结果" },
      attentionRequests: [],
    });
    const request = deriveAttentionRequest(p);
    expect(request?.type).toBe("capability");
    expect(request?.stage).toBe("baseline");
    expect(request?.title).toContain("评审连接");
    expect(request?.suggestedAction).toContain("真实 AI 评审");
  });
  it("asks the engine to understand input before any downstream workflow", () => {
    const p = project({ inputUnderstanding: undefined, attentionRequests: [] });
    expect(deriveAutonomousDecision(p).action).toBe("understand");
  });

  it("adopts low-risk defaults without interrupting the user", () => {
    const p = project({
      inputUnderstanding: {
        status: "ready", intentRestatement: "优化文档", implicitRequirements: [], assumptions: [], acceptanceFocus: [], confidence: 0.9,
        clarifications: [{ question: "标题结构保持不变？", whyItMatters: "保持兼容", defaultAnswer: "保持" }],
      },
      inputClarifications: [],
      attentionRequests: [],
    });
    const decision = deriveAutonomousDecision(p);
    expect(decision.action).toBe("adopt-defaults");
    expect(decision.autoClarifications).toHaveLength(1);
  });

  it("creates one durable attention request for a high-impact decision", () => {
    const p = project({
      inputUnderstanding: {
        status: "ready", intentRestatement: "优化系统", implicitRequirements: [], assumptions: [], acceptanceFocus: [], confidence: 0.9,
        clarifications: [{ question: "是否直接覆盖生产文件？", whyItMatters: "不可逆", defaultAnswer: "直接覆盖" }],
      },
      inputClarifications: [],
      attentionRequests: [],
    });
    const decision = deriveAutonomousDecision(p);
    expect(decision.action).toBe("wait-human");
    expect(decision.attention?.type).toBe("clarification");
    const saved = reconcileAttentionRequest(p, decision.attention);
    expect(saved.attentionRequests?.filter((item) => item.status === "pending")).toHaveLength(1);
  });

  it("classifies a real evidence gap as evidence instead of a generic safety limit", () => {
    const visualCriterion = {
      id: "VIS", title: "视觉检查", requirement: "实际页面层级清晰", source: "user-command" as const,
      weight: 20, hardGate: true, judgeType: "llm" as const, validationMethod: "visual-review" as const,
      minScore: 80, evidenceExpected: ["截图"], protectedConstraint: false, artifactIds: [], category: "ux" as const,
    };
    const p = project({
      inputUnderstanding: { status: "ready", intentRestatement: "优化界面", implicitRequirements: [], assumptions: [], acceptanceFocus: [], confidence: 0.9, clarifications: [] },
      acceptanceRubric: [visualCriterion],
      validationRun: {
        ...demoProject.validationRun,
        status: "completed",
        recommendation: "hold",
        evaluation: { ...demoProject.baselineRun.result!, unverifiedCriterionIds: ["VIS"] },
      },
      artifactAcceptance: {
        ...demoProject.artifactAcceptance,
        status: "unverified",
        results: [{ criterionId: "VIS", score: 0, pass: false, evidence: [], gaps: ["缺少实际截图"], note: "待补视觉证据" }],
        summary: "当前只剩缺少与验收项匹配的真实验证证据",
      },
      campaign: { ...demoProject.campaign, status: "paused", stopReason: "当前只剩缺少与各验收项验证方式匹配的证据，Hidden Validation 尚未通过" },
    });
    const decision = deriveAutonomousDecision(p);
    expect(decision.action).toBe("wait-human");
    expect(decision.attention?.type).toBe("evidence");
    expect(decision.attention?.criterionIds).toEqual(["VIS"]);
  });

  it("does not misclassify a locally re-checkable evidence pause as a limit", () => {
    const localCriterion = {
      id: "TXT", title: "文本完整", requirement: "正文完整", source: "user-command" as const,
      weight: 20, hardGate: true, judgeType: "llm" as const, validationMethod: "semantic-judge" as const,
      minScore: 80, evidenceExpected: ["当前文本"], protectedConstraint: false,
      artifactIds: [demoProject.sourceArtifacts[0]!.id], category: "outcome" as const,
    };
    const p = project({
      inputUnderstanding: { status: "ready", intentRestatement: "优化文档", implicitRequirements: [], assumptions: [], acceptanceFocus: [], confidence: 0.9, clarifications: [] },
      acceptanceRubric: [localCriterion],
      acceptanceRubricState: { status: "ready", summary: "ready", version: 1, weightTotal: 20, uncoveredCriterionIds: [], warnings: [] },
      gates: demoProject.gates.map((gate) => gate.id === "target-ready" ? { ...gate, status: "approved" as const } : gate),
      candidates: [{
        id: "C", name: "待复验文档", change: "补强文本完整性", status: "passed", artifactBuildStatus: "ready",
        artifactSnapshots: [{ id: "snap-C", sourceArtifactId: demoProject.sourceArtifacts[0]!.id, name: "result.txt", mimeType: "text/plain", content: "当前候选文本", contentHash: "hash-C", createdAt: new Date().toISOString() }],
      } as EvolveProject["candidates"][number]],
      experimentRun: { ...demoProject.experimentRun, status: "completed", pendingEvidenceCandidateId: "C" },
      validationRun: {
        ...demoProject.validationRun,
        status: "completed",
        recommendation: "hold",
        evaluation: { ...demoProject.baselineRun.result!, unverifiedCriterionIds: ["TXT"] },
      },
      artifactAcceptance: { ...demoProject.artifactAcceptance, status: "unverified", summary: "等待系统重新检查当前文本" },
      campaign: { ...demoProject.campaign, status: "paused", stopReason: "当前只剩缺少验证证据，系统可自动复验" },
    });
    expect(deriveAutonomousDecision(p).action).toBe("revalidate");
  });

  it("rechecks a DOCX SOP locally instead of asking for outside evidence", () => {
    const source = {
      ...demoProject.sourceArtifacts[0]!, id:"sop", name:"sop.docx", extension:"docx", artifactKind:"document" as const,
      mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", textContent:"旧版配置流程",
      structuredContent:{kind:"document",subtype:"docx",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"旧版配置流程"}]}]},
    };
    const criterion = {
      id:"DOC-CONFIG", title:"配置流程可理解性", requirement:"配置步骤编号、示例和注意事项清晰", source:"user-command" as const,
      weight:100, hardGate:true, judgeType:"llm" as const, validationMethod:"user-scenario" as const, minScore:85,
      evidenceExpected:["步骤编号","示例","注意事项"], protectedConstraint:false, artifactIds:[source.id], category:"outcome" as const,
    };
    const candidate = CandidateSchema.parse({ id:"DOC-C", name:"SOP 新版", change:"补齐配置流程", artifactSnapshots:[{
      id:"doc-snapshot", sourceArtifactId:source.id, name:source.name, mimeType:source.mimeType,
      content:JSON.stringify({kind:"document",subtype:"docx",parts:[{path:"word/document.xml",textRuns:[{index:0,text:"1. 配置地址。示例：输入网址。注意事项：保存后检测。"}]}]}),
      createdAt:"2026-09-27T00:00:00.000Z",
    }] });
    const p = project({
      inputUnderstanding:{status:"ready",intentRestatement:"优化 SOP",implicitRequirements:[],assumptions:[],acceptanceFocus:[],confidence:0.9,clarifications:[]},
      sourceArtifacts:[{...source,artifactDescriptor:describeArtifact(source)}], acceptanceRubric:[criterion], candidates:[candidate],
      experimentRun:{...demoProject.experimentRun,status:"completed",pendingEvidenceCandidateId:candidate.id},
      validationRun:{...demoProject.validationRun,status:"completed",candidateId:candidate.id,recommendation:"hold",evaluation:{...demoProject.baselineRun.result!,unverifiedCriterionIds:[criterion.id]}},
      artifactAcceptance:{...demoProject.artifactAcceptance,status:"unverified",candidateId:candidate.id,summary:"等待重新检查 SOP"},
      campaign:{...demoProject.campaign,status:"paused",stopReason:"当前只剩缺少验证证据"},
    });
    expect(deriveAttentionRequest(p)?.type).not.toBe("evidence");
    expect(deriveAutonomousDecision(p).action).toBe("revalidate");
  });

  it("rechecks an uploaded HTML tutorial locally instead of asking for a DOCX", () => {
    const source = {
      ...demoProject.sourceArtifacts[0]!, id:"tutorial", name:"tutorial.html", extension:"html", artifactKind:"document" as const,
      mimeType:"text/html", textContent:"<!doctype html><html><body>旧版说明</body></html>",
    };
    const criterion = {
      id:"HTML-READ", title:"理解难度降低", requirement:"概念解释直白、示例贴近实际", source:"user-command" as const,
      weight:100, hardGate:true, judgeType:"llm" as const, validationMethod:"user-scenario" as const, minScore:85,
      evidenceExpected:["直白解释","具体示例"], protectedConstraint:false, artifactIds:[source.id], category:"outcome" as const,
    };
    const candidate = CandidateSchema.parse({ id:"HTML-C", name:"教程新版", change:"降低理解难度", artifactSnapshots:[{
      id:"html-snapshot", sourceArtifactId:source.id, name:source.name, mimeType:source.mimeType,
      content:"<!doctype html><html><body><h2>概念解释</h2><p>用真实项目举例。</p></body></html>",
      createdAt:"2026-09-27T00:00:00.000Z",
    }] });
    const p = project({
      inputUnderstanding:{status:"ready",intentRestatement:"优化教程",implicitRequirements:[],assumptions:[],acceptanceFocus:[],confidence:0.9,clarifications:[]},
      sourceArtifacts:[{...source,artifactDescriptor:describeArtifact(source)}], acceptanceRubric:[criterion], candidates:[candidate],
      experimentRun:{...demoProject.experimentRun,status:"completed",pendingEvidenceCandidateId:candidate.id},
      validationRun:{...demoProject.validationRun,status:"completed",candidateId:candidate.id,recommendation:"hold",evaluation:{...demoProject.baselineRun.result!,unverifiedCriterionIds:[criterion.id]}},
      artifactAcceptance:{...demoProject.artifactAcceptance,status:"unverified",candidateId:candidate.id,summary:"等待重新检查 HTML"},
      campaign:{...demoProject.campaign,status:"paused",stopReason:"当前只剩缺少验证证据"},
    });
    expect(deriveAttentionRequest(p)?.type).not.toBe("evidence");
    expect(deriveAutonomousDecision(p).action).toBe("revalidate");
  });

  it("rebuilds a stale non-empty Eval Suite before Baseline instead of surfacing a coverage error", () => {
    const primary = {
      id: "USER-PRIMARY-INTENT", title: "核心目标", requirement: "落实核心目标", source: "user-command" as const,
      weight: 45, hardGate: true, judgeType: "llm" as const, validationMethod: "semantic-judge" as const,
      minScore: 80, evidenceExpected: ["完整结果"], protectedConstraint: false, artifactIds: [], category: "outcome" as const,
    };
    const format = {
      ...primary, id: "ART-1-FORMAT", title: "原格式交付", requirement: "保持原格式", weight: 35,
      validationMethod: "format-roundtrip" as const, evidenceExpected: ["roundtrip"], category: "artifact-specific" as const,
      artifactIds: [demoProject.sourceArtifacts[0]!.id],
    };
    const covered = {
      ...primary, id: "OTHER", title: "其他要求", requirement: "保持其他要求", weight: 20, hardGate: false,
      evidenceExpected: ["其他要求"],
    };
    const staleCase = { ...demoProject.evalSuite[0]!, id: "stale", criterionIds: ["OTHER"] };
    const p = project({
      inputUnderstanding: { status: "ready", intentRestatement: "优化", implicitRequirements: [], assumptions: [], acceptanceFocus: [], confidence: 0.9, clarifications: [] },
      acceptanceRubric: [primary, format, covered],
      acceptanceRubricState: { status: "ready", summary: "旧状态误认为 ready", version: 1, weightTotal: 100, uncoveredCriterionIds: [], warnings: [] },
      evalSuite: [staleCase],
      hiddenEvalSuite: [staleCase],
      gates: demoProject.gates.map((gate) => gate.id === "target-ready" ? { ...gate, status: "approved" as const } : gate),
      attentionRequests: [],
    });
    const decision = deriveAutonomousDecision(p);
    expect(decision.action).toBe("build-eval");
    expect(decision.reason).toContain("USER-PRIMARY-INTENT");
    expect(decision.reason).toContain("ART-1-FORMAT");
  });

  it("keeps locally re-checkable judge omissions inside automation until the internal retry budget is exhausted", () => {
    const criterion = {
      id: "TXT", title: "核心目标", requirement: "满足核心目标", source: "user-command" as const,
      weight: 100, hardGate: true, judgeType: "llm" as const, validationMethod: "semantic-judge" as const,
      minScore: 90, evidenceExpected: ["当前成果"], protectedConstraint: false, artifactIds: [], category: "outcome" as const,
    };
    const candidate = {
      id: "C-local", name: "当前文本", change: "细化流程", status: "passed" as const, artifactBuildStatus: "ready" as const,
      artifactSnapshots: [{ id: "snap-local", sourceArtifactId: demoProject.sourceArtifacts[0]!.id, name: "workflow.txt", mimeType: "text/plain", content: "当前候选文本", contentHash: "hash-local", createdAt: new Date().toISOString() }],
    } as EvolveProject["candidates"][number];
    const base = project({
      inputUnderstanding: { status: "ready", intentRestatement: "优化", implicitRequirements: [], assumptions: [], acceptanceFocus: [], confidence: 0.9, clarifications: [] },
      acceptanceRubric: [criterion],
      candidates: [candidate],
      experimentRun: { ...demoProject.experimentRun, status: "completed", pendingEvidenceCandidateId: candidate.id },
      validationRun: { ...demoProject.validationRun, status: "completed", candidateId: candidate.id, recommendation: "hold", evaluation: { ...demoProject.baselineRun.result!, unverifiedCriterionIds: [criterion.id] } },
      artifactAcceptance: { ...demoProject.artifactAcceptance, status: "unverified", candidateId: candidate.id, summary: "等待系统补评" },
      campaign: { ...demoProject.campaign, status: "paused", stopReason: `自动复验后仍有本地验收项未结算：${criterion.id}` },
    });
    expect(deriveAutonomousDecision(base).action).toBe("revalidate");

    const staleExhausted = project({ ...base, campaign: { ...base.campaign, status: "paused", stopReason: `本地评审自动重试已耗尽：仍未结算：${criterion.id}` } });
    expect(deriveAutonomousDecision(staleExhausted).action).toBe("revalidate");

    const exhausted = project({ ...base, campaign: { ...base.campaign, status: "paused", stopReason: `本地评审自动重试已耗尽[${LOCAL_REVIEW_CONTRACT_VERSION}]：仍未结算：${criterion.id}` } });
    const decision = deriveAutonomousDecision(exhausted);
    expect(decision.action).toBe("wait-human");
    expect(decision.attention?.type).toBe("capability");
    expect(decision.attention?.title).toContain("AI 评审连接");
    expect(decision.attention?.criterionIds).toEqual([]);

    const partialCase = { ...demoProject.hiddenEvalSuite[0]!, id: "H-LOCAL-PARTIAL", criterionIds: [criterion.id] };
    const partial = project({
      ...exhausted,
      hiddenEvalSuite: [partialCase],
      validationRun: {
        ...exhausted.validationRun,
        runs: [{ testCaseId: partialCase.id, output: "retrieved context", latencyMs: 0, cost: 0, trace: [], verificationStatus: "partial" }],
      },
    });
    const partialDecision = deriveAutonomousDecision(partial);
    expect(partialDecision.action).toBe("wait-human");
    expect(partialDecision.attention?.title).toContain("本地证据不完整");
    expect(partialDecision.attention?.criterionIds).toEqual([criterion.id]);
    const missingExecution = project({ ...partial, validationRun: {
      ...partial.validationRun,
      runs: partial.validationRun.runs.map((run) => ({ ...run, verificationStatus: "unverified" as const })),
    } });
    expect(deriveAutonomousDecision(missingExecution).attention?.title).toContain("本地证据不完整");
  });

  it("classifies a scripted HTML protection gap as Runner evidence, not local document evidence", () => {
    const criterion = { ...demoProject.acceptanceRubric[0]!, id:"PROTECT-ALL", title:"保护交互", validationMethod:"semantic-judge" as const,
      protectedConstraint:true, artifactIds:["html"], requirement:"原有点击交互可用" };
    const testCase = { ...demoProject.hiddenEvalSuite[0]!, id:"H-PROTECT", criterionIds:[criterion.id],
      executionMode:"external-runner" as const, evidenceScope:"product-behavior" as const };
    const p = project({
      acceptanceRubric:[criterion], hiddenEvalSuite:[testCase],
      sourceArtifacts:[{ ...demoProject.sourceArtifacts[0]!, id:"html", name:"guide.html", extension:"html", mimeType:"text/html", artifactKind:"document", role:"target",
        textContent:"<html><body><button>下一步</button><script>window.next = true</script></body></html>" }],
      validationRun:{...demoProject.validationRun,status:"completed",evaluation:{...demoProject.baselineRun.result!,unverifiedCriterionIds:[criterion.id]},
        runs:[{testCaseId:testCase.id,output:"Runner 未完成",latencyMs:0,cost:0,trace:[],verificationStatus:"unverified"}]},
      campaign:{...demoProject.campaign,status:"paused",stopReason:"保护交互缺少真实执行证据"},
    });
    const request=deriveAttentionRequest(p);
    expect(request?.type).toBe("evidence");
    expect(request?.diagnosticCode).not.toBe("local-evidence-incomplete");
    expect(request?.criterionIds).toEqual([criterion.id]);
  });

  it("does not reopen a campaign after server deterministic revalidation pauses for Release Review", () => {
    const p = project({
      campaign: {
        ...demoProject.campaign,
        status: "paused",
        stopReason: "[server-release-review-required] Durable Workflow 已补齐全部确定性 Roundtrip 证据；最终 Release Review 仍需独立评审能力。",
      },
      attentionRequests: [],
    });
    const request = deriveAttentionRequest(p);
    expect(request?.type).toBe("capability");
    expect(request?.title).toContain("Release Review");
    expect(request?.stage).toBe("validation");
    expect(request?.suggestedAction).toContain("无需重新生成成果");
  });

  it("automatically retries the legacy Server Experiment migration boundary", () => {
    const p = project({
      campaign: {
        ...demoProject.campaign,
        status: "paused",
        stopReason: "[server-campaign-experiment-pending] Problem → Diagnosis → Plan 已完成；等待 Experiment Server Step。",
      },
      stage: "plan",
      attentionRequests: [],
    });
    expect(deriveAttentionRequest(p)).toBeUndefined();
  });

  it("classifies a Server Experiment build failure as capability instead of a generic limit", () => {
    const p = project({
      campaign: {
        ...demoProject.campaign,
        status: "paused",
        stopReason: "[server-campaign-experiment-build-pending] Candidate Builder 暂不能生成实际文件",
      },
      stage: "experiment",
      attentionRequests: [],
    });
    const request = deriveAttentionRequest(p);
    expect(request?.type).toBe("capability");
    expect(request?.reason).toContain("experiment-build-pending");
  });

  it("automatically retries the legacy Hidden Holdout migration boundary", () => {
    const p = project({
      campaign: {
        ...demoProject.campaign,
        status: "paused",
        stopReason: "[server-campaign-holdout-pending] Server Experiment 已完成；等待 Hidden Holdout",
      },
      stage: "experiment",
      attentionRequests: [],
    });
    expect(deriveAttentionRequest(p)).toBeUndefined();
  });

  it("classifies a real Hidden Holdout evidence gap as capability", () => {
    const p = project({
      campaign: {
        ...demoProject.campaign,
        status: "paused",
        stopReason: "[server-campaign-holdout-evidence-pending] H-UX 需要真实浏览器证据",
      },
      stage: "validation",
      attentionRequests: [],
    });
    const request = deriveAttentionRequest(p);
    expect(request?.type).toBe("capability");
    expect(request?.reason).toContain("holdout-evidence-pending");
  });

  it("automatically retries the legacy Artifact Acceptance migration boundary", () => {
    const p = project({
      campaign: {
        ...demoProject.campaign,
        status: "paused",
        stopReason: "[server-campaign-artifact-acceptance-pending] Hidden Holdout 已完成；等待 Gate F",
      },
      stage: "validation",
      attentionRequests: [],
    });
    expect(deriveAttentionRequest(p)).toBeUndefined();
  });

  it("classifies a real Artifact Acceptance evidence gap as capability", () => {
    const p = project({
      campaign: {
        ...demoProject.campaign,
        status: "paused",
        stopReason: "[server-campaign-artifact-acceptance-evidence-pending] frozen blob unavailable",
      },
      stage: "validation",
      attentionRequests: [],
    });
    const request = deriveAttentionRequest(p);
    expect(request?.type).toBe("capability");
    expect(request?.reason).toContain("artifact-acceptance-evidence-pending");
  });

  it("automatically retries the legacy server baseline migration pause under the new server baseline capability", () => {
    const criteria: EvolveProject["acceptanceRubric"] = [
      { id:"GOAL", title:"核心目标", requirement:"落实既有进化目标", source:"user-command", weight:60, hardGate:true, judgeType:"llm", validationMethod:"semantic-judge", minScore:85, evidenceExpected:["当前成果"], protectedConstraint:false, artifactIds:[], category:"outcome" },
      { id:"FORMAT", title:"格式保持", requirement:"保持目标成果可交付格式", source:"system-integrity", weight:25, hardGate:true, judgeType:"integrity", validationMethod:"format-roundtrip", minScore:90, evidenceExpected:["roundtrip"], protectedConstraint:true, artifactIds:[demoProject.sourceArtifacts[0]!.id], category:"artifact-specific" },
      { id:"STRUCT", title:"结构完整", requirement:"成果结构完整可读", source:"system-integrity", weight:15, hardGate:false, judgeType:"structural", validationMethod:"static-structure", minScore:80, evidenceExpected:["结构"], protectedConstraint:false, artifactIds:[], category:"integrity" },
    ];
    const visible = [
      { ...demoProject.evalSuite[0]!, id:"V-GOAL", criterionIds:["GOAL"], hidden:false, executionMode:"artifact-runtime" as const, evidenceScope:"product-behavior" as const },
      { ...demoProject.evalSuite[0]!, id:"V-FORMAT", criterionIds:["FORMAT"], hidden:false, executionMode:"roundtrip" as const, evidenceScope:"format" as const },
      { ...demoProject.evalSuite[0]!, id:"V-STRUCT", criterionIds:["STRUCT"], hidden:false, executionMode:"static-evidence" as const, evidenceScope:"implementation" as const },
    ];
    const hidden = [
      { ...visible[0]!, id:"H-GOAL", hidden:true },
      { ...visible[1]!, id:"H-FORMAT", hidden:true },
    ];
    const p = project({
      inputUnderstanding: {
        status: "ready",
        intentRestatement: "继续既有进化目标",
        implicitRequirements: [],
        assumptions: [],
        acceptanceFocus: [],
        confidence: 0.9,
        clarifications: [],
      },
      acceptanceRubric: criteria,
      acceptanceRubricState: { status:"ready", summary:"ready", version:1, weightTotal:100, uncoveredCriterionIds:[], warnings:[] },
      evalSuite: visible,
      hiddenEvalSuite: hidden,
      gates: demoProject.gates.map((gate) => gate.id === "target-ready"
        ? { ...gate, status: "approved" as const }
        : gate),
      campaign: {
        ...demoProject.campaign,
        status: "paused",
        stopReason: "[server-campaign-baseline-pending] Campaign Planning 已迁到 Server，但 Baseline 执行仍需先完成",
      },
      attentionRequests: [],
    });
    expect(deriveAttentionRequest(p)).toBeUndefined();
    expect(deriveAutonomousDecision(p).action).toBe("run-campaign");
  });

  it("keeps a new server baseline evidence gap classified as capability", () => {
    const p = project({
      campaign: {
        ...demoProject.campaign,
        status: "paused",
        stopReason: "[server-campaign-baseline-evidence-pending] V1 尚未获得真实 Runner 证据",
      },
      stage: "baseline",
      attentionRequests: [],
    });
    const request = deriveAttentionRequest(p);
    expect(request?.type).toBe("capability");
    expect(request?.reason).toContain("baseline-evidence-pending");
  });

  it("continues old offline completed artifacts through Lesson and Next Queue before declaring complete", () => {
    const candidate = CandidateSchema.parse({
      id:"offline-complete",name:"离线成果",change:"完成",status:"passed",artifactBuildStatus:"ready",
      artifactSnapshots:[CandidateArtifactSnapshotSchema.parse({id:"snap-offline-complete",sourceArtifactId:demoProject.sourceArtifacts[0]!.id,name:"result.md",mimeType:"text/markdown",content:"final",contentHash:"hash-offline-complete",createdAt:"now"})],
    });
    const base = project({
      targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"AI Artifact Runtime"},
      candidates:[candidate],
      experimentRun:{...demoProject.experimentRun,status:"completed",winnerId:candidate.id},
      validationRun:{...demoProject.validationRun,status:"completed",validationMode:"full",candidateId:candidate.id,recommendation:"release",evaluation:{...demoProject.baselineRun.result!,demoJudged:false},checks:[],runs:demoProject.hiddenEvalSuite.map((testCase)=>({testCaseId:testCase.id,output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified" as const})),baselineRuns:demoProject.hiddenEvalSuite.map((testCase)=>({testCaseId:testCase.id,output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified" as const})),baselineEvaluation:demoProject.baselineRun.result,baselineSuiteIds:demoProject.hiddenEvalSuite.map((testCase)=>testCase.id),baselineContextFingerprint:"same-paper",baselineObservedAt:123456},
      artifactAcceptance:{...demoProject.artifactAcceptance,status:"passed",candidateId:candidate.id,hardGatePass:true,overallScore:96,coverageScore:96,integrityScore:96,pairwiseScore:96,frozenArtifacts:frozenFor(candidate)},
      outputArtifacts:[{id:"out-offline-complete",projectId:demoProject.id,round:1,versionLabel:"S1",candidateId:candidate.id,name:"result.md",mimeType:"text/markdown",kind:"primary",content:"final",description:"accepted",sourceArtifactIds:[demoProject.sourceArtifacts[0]!.id],isChampion:true,accepted:true,createdAt:"now"} as EvolveProject["outputArtifacts"][number]],
      lessons:[],nextQueue:[],
    });
    const binding = evidenceFingerprint(base, candidate);
    base.validationRun.evidenceFingerprint = binding;
    base.artifactAcceptance.evidenceFingerprint = binding;
    expect(deriveAutonomousDecision(base).action).toBe("distill");

    base.lessons=[{id:"lesson",title:"经验",summary:"有效",reusable:true,effect:"改善",limit:"离线",trigger:[],method:[],validatedOn:["offline"],status:"lesson"}];
    expect(deriveAutonomousDecision(base).action).toBe("next-queue");
    base.nextQueue=[{id:"next",title:"下一轮",reason:"继续",priority:"P1",source:"lesson",suggestedMetrics:[]}];
    expect(deriveAutonomousDecision(base).action).toBe("complete");
  });

  it("blocks online completion until a real live Release decision exists, then closes learning", () => {
    const candidate = CandidateSchema.parse({
      id:"online-complete",name:"线上成果",change:"完成",status:"passed",artifactBuildStatus:"ready",
      artifactSnapshots:[CandidateArtifactSnapshotSchema.parse({id:"snap-online-complete",sourceArtifactId:demoProject.sourceArtifacts[0]!.id,name:"result.md",mimeType:"text/markdown",content:"final",contentHash:"hash-online-complete",createdAt:"now"})],
    });
    const base = project({
      targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Artifact"},
      releaseTarget:{provider:"vercel",mode:"preview-promote",status:"connected",label:"Vercel",healthPath:"/"},
      candidates:[candidate],
      experimentRun:{...demoProject.experimentRun,status:"completed",winnerId:candidate.id},
      validationRun:{...demoProject.validationRun,status:"completed",validationMode:"full",candidateId:candidate.id,recommendation:"release",evaluation:{...demoProject.baselineRun.result!,demoJudged:false},checks:[],runs:demoProject.hiddenEvalSuite.map((testCase)=>({testCaseId:testCase.id,output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified" as const})),baselineRuns:demoProject.hiddenEvalSuite.map((testCase)=>({testCaseId:testCase.id,output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified" as const})),baselineEvaluation:demoProject.baselineRun.result,baselineSuiteIds:demoProject.hiddenEvalSuite.map((testCase)=>testCase.id),baselineContextFingerprint:"same-paper",baselineObservedAt:123456},
      artifactAcceptance:{...demoProject.artifactAcceptance,status:"passed",candidateId:candidate.id,hardGatePass:true,overallScore:96,coverageScore:96,integrityScore:96,pairwiseScore:96,frozenArtifacts:frozenFor(candidate)},
      outputArtifacts:[{id:"out-online-complete",projectId:demoProject.id,round:1,versionLabel:"S1",candidateId:candidate.id,name:"result.md",mimeType:"text/markdown",kind:"primary",content:"final",description:"accepted",sourceArtifactIds:[demoProject.sourceArtifacts[0]!.id],isChampion:true,accepted:true,createdAt:"now"} as EvolveProject["outputArtifacts"][number]],
      release:{...demoProject.release,status:"idle",evidenceMode:"none"},
      lessons:[],nextQueue:[],
      attentionRequests:[],
    });
    const binding=evidenceFingerprint(base,candidate);
    base.validationRun.evidenceFingerprint=binding;
    base.artifactAcceptance.evidenceFingerprint=binding;

    const blocked=deriveAutonomousDecision(base);
    expect(blocked.action).toBe("wait-human");
    expect(blocked.stage).toBe("release");
    expect(blocked.attention?.type).toBe("capability");

    base.gates=base.gates.map((gate)=>gate.id==="release-ready"?{...gate,status:"approved" as const}:gate);
    const needsBinding=deriveAutonomousDecision(base);
    expect(needsBinding.action).toBe("wait-human");
    expect(needsBinding.attention?.title).toContain("Preview Deployment");
    base.release={...base.release,candidateId:candidate.id,sourceGitCommitSha:"sha-exact"};
    const autoBinding=deriveAutonomousDecision(base);
    expect(autoBinding.action).toBe("reconcile-release");
    expect(autoBinding.reason).toContain("sha-exact");
    expect(autoBinding.reason).toContain("exact SHA");
    base.releaseTarget={...base.releaseTarget!,mode:"progressive"};
    base.release={...base.release,deploymentId:"dpl-preview",recovery:undefined};
    expect(deriveAutonomousDecision(base).action).toBe("run-release");
    base.releaseTarget={...base.releaseTarget!,mode:"preview-promote"};
    base.release={...base.release,candidateId:candidate.id,deploymentId:"dpl-preview",recovery:{status:"pending",action:"promote",reason:"provider timeout",at:"2026-09-20T15:00:00Z"}};
    base.campaign={...base.campaign,status:"paused",stopReason:"[server-release-provider-pending] promote 结果不确定"};
    expect(deriveAutonomousDecision(base).action).toBe("reconcile-release");
    base.release={...base.release,recovery:{status:"manual-check",action:"promote",reason:"Production unknown",at:"2026-09-20T15:00:00Z",lastObservedAt:"2026-09-20T15:05:00Z"}};
    expect(deriveAutonomousDecision(base).action).toBe("wait-human");
    base.release={...base.release,recovery:undefined};
    base.campaign={...base.campaign,status:"idle",stopReason:undefined};
    expect(deriveAutonomousDecision(base).action).toBe("run-release");
    const previewPlan=buildServerHarnessPlan(base);
    expect(previewPlan.decision.action).toBe("run-release");
    base.release={...base.release,status:"shadow",evidenceMode:"live",healthy:true,observationStatus:"healthy",stableDeploymentId:"dpl-stable"};
    expect(deriveAutonomousDecision(base).action).toBe("run-release");
    const promotePlan=buildServerHarnessPlan(base);
    expect(promotePlan.decision.action).toBe("run-release");
    expect(promotePlan.checkpoint.id).not.toBe(previewPlan.checkpoint.id);
    expect(promotePlan.sourceRevision).not.toBe(previewPlan.sourceRevision);
    const firstHealthyAt=new Date().toISOString();
    base.release={...base.release,status:"promoted",evidenceMode:"live",healthy:true,observationStatus:"healthy",environment:"production",observedAt:firstHealthyAt,observations:[{
      id:"prod-h1",at:firstHealthyAt,source:"release-action",action:"promote",candidateId:candidate.id,deploymentId:"dpl-preview",
      evidenceMode:"live",environment:"production",healthy:true,observationStatus:"healthy",reason:"promote health",
    }]};
    expect(deriveAutonomousDecision(base).action).toBe("reconcile-release");
    const secondHealthyAt=new Date(Date.now()+1000).toISOString();
    base.release={...base.release,observedAt:secondHealthyAt,observations:[...(base.release.observations??[]),{
      id:"prod-h2",at:secondHealthyAt,source:"reconcile",action:"reconcile",candidateId:candidate.id,deploymentId:"dpl-preview",
      evidenceMode:"live",environment:"production",healthy:true,observationStatus:"healthy",reason:"refresh health",
    }]};
    expect(deriveAutonomousDecision(base).action).toBe("distill");
    const stablePlan=buildServerHarnessPlan(base);
    const sameObservedAt=base.release.observedAt;
    base.release={...base.release,observedAt:sameObservedAt,observations:[...(base.release.observations??[]),{
      id:"prod-h3",at:secondHealthyAt,source:"reconcile",action:"reconcile",candidateId:candidate.id,deploymentId:"dpl-preview",
      evidenceMode:"live",environment:"production",healthy:true,observationStatus:"healthy",reason:"same-time extra observation",
    }]};
    const observationChangedPlan=buildServerHarnessPlan(base);
    expect(observationChangedPlan.decision.action).toBe("distill");
    expect(observationChangedPlan.sourceRevision).not.toBe(stablePlan.sourceRevision);
    expect(observationChangedPlan.checkpoint.id).not.toBe(stablePlan.checkpoint.id);
    base.release={...base.release,observedAt:new Date(Date.now()-31*60*1000).toISOString()};
    expect(deriveAutonomousDecision(base).action).toBe("reconcile-release");
    base.release={...base.release,observedAt:new Date().toISOString()};
    base.lessons=[{id:"lesson-live",title:"线上经验",summary:"有效",reusable:true,effect:"改善",limit:"线上",trigger:[],method:[],validatedOn:["production"],status:"verified-skill"}];
    expect(deriveAutonomousDecision(base).action).toBe("next-queue");
    base.nextQueue=[{id:"next-live",title:"下一轮",reason:"继续",priority:"P1",source:"lesson",suggestedMetrics:[]}];
    expect(deriveAutonomousDecision(base).action).toBe("complete");
  });

  it("uses read-only HTTP observe instead of replaying an uncertain HTTP production write", () => {
    const candidate = CandidateSchema.parse({
      id:"http-release",name:"HTTP Release Candidate",change:"完成",status:"passed",artifactBuildStatus:"ready",
      artifactSnapshots:[CandidateArtifactSnapshotSchema.parse({id:"snap-http-release",sourceArtifactId:demoProject.sourceArtifacts[0]!.id,name:"result.md",mimeType:"text/markdown",content:"final",contentHash:"hash-http-release",createdAt:"now"})],
    });
    const base=project({
      targetConnection:{adapter:"http",connectionId:"http-prod",status:"connected",label:"HTTP Target"},
      releaseTarget:{provider:"http",mode:"preview-promote",status:"connected",label:"HTTP Release",healthPath:"/"},
      candidates:[candidate],
      experimentRun:{...demoProject.experimentRun,status:"completed",winnerId:candidate.id},
      validationRun:{...demoProject.validationRun,status:"completed",validationMode:"full",candidateId:candidate.id,recommendation:"release",evaluation:{...demoProject.baselineRun.result!,demoJudged:false},checks:[],runs:demoProject.hiddenEvalSuite.map((testCase)=>({testCaseId:testCase.id,output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified" as const})),baselineRuns:demoProject.hiddenEvalSuite.map((testCase)=>({testCaseId:testCase.id,output:"ok",latencyMs:1,cost:0,trace:[],verificationStatus:"verified" as const})),baselineEvaluation:demoProject.baselineRun.result,baselineSuiteIds:demoProject.hiddenEvalSuite.map((testCase)=>testCase.id),baselineContextFingerprint:"same-paper",baselineObservedAt:123456},
      artifactAcceptance:{...demoProject.artifactAcceptance,status:"passed",candidateId:candidate.id,hardGatePass:true,overallScore:96,coverageScore:96,integrityScore:96,pairwiseScore:96,frozenArtifacts:frozenFor(candidate)},
      outputArtifacts:[{id:"out-http-release",projectId:demoProject.id,round:1,versionLabel:"S1",candidateId:candidate.id,name:"result.md",mimeType:"text/markdown",kind:"primary",content:"final",description:"accepted",sourceArtifactIds:[demoProject.sourceArtifacts[0]!.id],isChampion:true,accepted:true,createdAt:"now"} as EvolveProject["outputArtifacts"][number]],
      gates:demoProject.gates.map((gate)=>gate.id==="release-ready"?{...gate,status:"approved" as const}:gate),
      release:{...demoProject.release,status:"idle",candidateId:candidate.id,evidenceMode:"none",recovery:{status:"pending",action:"shadow",reason:"network lost after HTTP release request",at:"2026-09-22T01:00:00Z"}},
      campaign:{...demoProject.campaign,status:"paused",stopReason:"[server-release-provider-pending] HTTP shadow result unknown"},
      attentionRequests:[],lessons:[],nextQueue:[],
    });
    const binding=evidenceFingerprint(base,candidate);
    base.validationRun.evidenceFingerprint=binding;
    base.artifactAcceptance.evidenceFingerprint=binding;
    const decision=deriveAutonomousDecision(base);
    expect(decision.action).toBe("reconcile-release");
    expect(decision.reason).toContain("Target Observe");
    expect(decision.reason).toContain("绝不自动重放");
  });

  it("resolves a stale attention request automatically after the blocker disappears", () => {
    const base = project({ attentionRequests: [] });
    const blocked = reconcileAttentionRequest(base, {
      id: "attention-test", type: "limit", status: "pending", title: "边界", reason: "轮数上限", stage: "validation",
      riskLevel: "medium", blocking: true, criterionIds: [], questions: [], createdAt: new Date().toISOString(),
    });
    const resolved = reconcileAttentionRequest(blocked);
    expect(resolved.attentionRequests?.[0]?.status).toBe("resolved");
  });
});

