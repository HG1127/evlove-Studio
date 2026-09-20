import { describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import { CandidateArtifactSnapshotSchema, CandidateSchema } from "../schemas";
import { evidenceFingerprint } from "./evidence-binding";
import type { EvolveProject } from "../schemas";
import { deriveAttentionRequest, deriveAutonomousDecision, LOCAL_REVIEW_CONTRACT_VERSION, reconcileAttentionRequest } from "./autonomous-orchestrator";

function project(patch: Partial<EvolveProject> = {}): EvolveProject {
  return { ...demoProject, ...patch } as EvolveProject;
}

describe("autonomous orchestrator", () => {
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

  it("continues old offline completed artifacts through Lesson and Next Queue before declaring complete", () => {
    const candidate = CandidateSchema.parse({
      id:"offline-complete",name:"离线成果",change:"完成",status:"passed",artifactBuildStatus:"ready",
      artifactSnapshots:[CandidateArtifactSnapshotSchema.parse({id:"snap-offline-complete",sourceArtifactId:demoProject.sourceArtifacts[0]!.id,name:"result.txt",mimeType:"text/plain",content:"final",contentHash:"hash-offline-complete",createdAt:"now"})],
    });
    const base = project({
      targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"AI Artifact Runtime"},
      candidates:[candidate],
      experimentRun:{...demoProject.experimentRun,status:"completed",winnerId:candidate.id},
      validationRun:{...demoProject.validationRun,status:"completed",candidateId:candidate.id,recommendation:"release",evaluation:{...demoProject.baselineRun.result!,demoJudged:false},checks:[],runs:[],baselineRuns:[]},
      artifactAcceptance:{...demoProject.artifactAcceptance,status:"passed",candidateId:candidate.id,hardGatePass:true,overallScore:96,coverageScore:96,integrityScore:96,pairwiseScore:96},
      outputArtifacts:[{id:"out-offline-complete",projectId:demoProject.id,round:1,versionLabel:"S1",candidateId:candidate.id,name:"result.txt",mimeType:"text/plain",kind:"primary",content:"final",description:"accepted",sourceArtifactIds:[demoProject.sourceArtifacts[0]!.id],isChampion:true,accepted:true,createdAt:"now"} as EvolveProject["outputArtifacts"][number]],
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

