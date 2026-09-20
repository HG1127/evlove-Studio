import type { AttentionRequest, EvolveProject, Stage } from "@evolution/contracts";
import {
  campaignGoalSatisfied,
  criterionCanUseLocalSnapshotEvidence,
  deliveryReadiness,
  experimentNeedsEvidenceRepair,
  goalReadiness,
  rubricSuiteCoverage,
  rubricValidation,
} from "@evolution/core";
import { autonomousClarificationPlan } from "./autonomy-policy";

export type AutonomousAction =
  | "understand"
  | "adopt-defaults"
  | "compile-contract"
  | "approve-contract"
  | "build-eval"
  | "revalidate"
  | "run-campaign"
  | "package"
  | "distill"
  | "next-queue"
  | "complete"
  | "wait-human";

/** Bump when local Judge settlement semantics change; stale persisted fuse states get one fresh retry. */
export const LOCAL_REVIEW_CONTRACT_VERSION = "judge-contract-v2";

export type AutonomousDecision = {
  action: AutonomousAction;
  reason: string;
  stage: Stage;
  attention?: AttentionRequest;
  autoClarifications?: ReturnType<typeof autonomousClarificationPlan>["auto"];
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function attention(args: Omit<AttentionRequest, "id" | "status" | "createdAt">): AttentionRequest {
  const signature = `${args.type}|${args.stage}|${args.title}|${args.reason}|${(args.criterionIds ?? []).join(",")}`;
  return {
    ...args,
    id: `attention-${stableHash(signature)}`,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

function readinessBlockersWithoutAutoClarifications(project: EvolveProject) {
  return goalReadiness(project).blockers.filter((item) => !/会影响方向的问题需要确认|请先完成材料与意图理解/.test(item));
}

function pendingEvidenceCriterionIds(project: EvolveProject) {
  const ids = new Set(project.validationRun.evaluation?.unverifiedCriterionIds ?? []);
  if (project.artifactAcceptance.status === "unverified") {
    for (const result of project.artifactAcceptance.results.filter((item) => !item.pass)) {
      const criterion = project.acceptanceRubric.find((item) => item.id === result.criterionId);
      if (criterion && !criterionCanUseLocalSnapshotEvidence(project, criterion)) ids.add(result.criterionId);
    }
  }
  return [...ids];
}

function looksLikeEvidencePause(project: EvolveProject) {
  if (project.artifactAcceptance.status === "unverified") return true;
  const reason = project.campaign.stopReason ?? "";
  return /(?:只剩|缺少|待补|等待).{0,24}(?:验证|证据)|真实验证|验证能力|UNVERIFIED|unverified/i.test(reason);
}

export function deriveAttentionRequest(project: EvolveProject): AttentionRequest | undefined {
  const clarificationPlan = autonomousClarificationPlan(project);
  if (clarificationPlan.human.length) {
    return attention({
      type: "clarification",
      title: `需要确认 ${clarificationPlan.human.length} 个高影响问题`,
      reason: clarificationPlan.human.map((item) => item.question).join("；"),
      stage: "target",
      riskLevel: "high",
      blocking: true,
      questions: clarificationPlan.human.map((item) => ({ question: item.question, whyItMatters: item.whyItMatters, defaultAnswer: item.defaultAnswer })),
      suggestedAction: "一次确认这些会改变结果的口径，提交后系统自动继续。",
      criterionIds: [],
    });
  }

  const blockers = readinessBlockersWithoutAutoClarifications(project);
  if (blockers.length) {
    return attention({
      type: "input",
      title: "需要补充或修正输入",
      reason: blockers.join("；"),
      stage: "target",
      riskLevel: "medium",
      blocking: true,
      questions: [],
      suggestedAction: "补充缺失材料或修正无法读取的输入；系统会从断点继续。",
      criterionIds: [],
    });
  }

  const pendingEvidenceIds = pendingEvidenceCriterionIds(project);
  const pendingEvidence = pendingEvidenceIds.flatMap((id) => {
    const criterion = project.acceptanceRubric.find((item) => item.id === id);
    return criterion ? [criterion] : [];
  });
  const externalEvidence = pendingEvidence.filter((criterion) => !criterionCanUseLocalSnapshotEvidence(project, criterion));
  if (externalEvidence.length) {
    return attention({
      type: "evidence",
      title: `需要补充 ${externalEvidence.length} 项系统无法自行取得的验证`,
      reason: project.campaign.stopReason || externalEvidence.map((criterion) => criterion.title).join("；"),
      stage: "validation",
      riskLevel: "medium",
      blocking: true,
      questions: [],
      suggestedAction: "按页面提供的截图、真人验收或 Runner 入口补证；补完后自动复验并继续。",
      criterionIds: externalEvidence.map((criterion) => criterion.id),
    });
  }

  if (project.campaign.status === "paused" && project.experimentRun.status === "completed" && !project.experimentRun.winnerId && !project.experimentRun.pendingEvidenceCandidateId && experimentNeedsEvidenceRepair(project.experimentRun)) {
    return attention({
      type: "capability",
      title: "当前候选只缺真实验证能力",
      reason: project.campaign.stopReason || "候选没有已证实的产品失败，但缺少真实运行、视觉或人工证据。",
      stage: "experiment",
      riskLevel: "medium",
      blocking: true,
      questions: [],
      suggestedAction: "补齐验证能力后复用当前候选，不重新生成成果。",
      criterionIds: [],
    });
  }

  const serverReleaseReviewRequired = project.campaign.status === "paused"
    && (project.campaign.stopReason ?? "").includes("[server-release-review-required]");
  if (serverReleaseReviewRequired) {
    return attention({
      type: "capability",
      title: "确定性证据已补齐，等待独立 Release Review",
      reason: project.campaign.stopReason ?? "Durable Workflow 已补齐当前 Candidate 的确定性证据，但最终发布判断尚未完成。",
      stage: "validation",
      riskLevel: "medium",
      blocking: true,
      questions: [],
      suggestedAction: "当前 Candidate 与已验证 Roundtrip 证据均已保留。补齐 Server AI / 最终评审能力后从断点继续，无需重新生成成果。",
      criterionIds: [],
    });
  }

  const serverCampaignCapabilityPending = project.campaign.status === "paused"
    && /\[server-campaign-(?:ai-pending|baseline-pending|contract-pending|diagnosis-pending|plan-grounding-pending|experiment-pending)\]/.test(project.campaign.stopReason ?? "");
  if (serverCampaignCapabilityPending) {
    return attention({
      type: "capability",
      title: "Server Campaign 已保存断点，等待后续执行能力",
      reason: project.campaign.stopReason ?? "Durable Workflow 已保存 Campaign 断点，但下一执行面尚未就绪。",
      stage: project.stage,
      riskLevel: "medium",
      blocking: true,
      questions: [],
      suggestedAction: "当前 Baseline / Problem / Diagnosis / Candidate 断点会保留；补齐对应 Server AI、Baseline 或 Experiment 能力后从断点继续，无需重新开始。",
      criterionIds: [],
    });
  }

  const localReviewExhausted = project.campaign.status === "paused" && /本地评审自动重试已耗尽/.test(project.campaign.stopReason ?? "");
  // A persisted fuse from an older Judge contract must not survive a runtime contract upgrade.
  // Give the same Candidate one automatic settlement pass under the new rules, then stamp the new
  // version only if it really exhausts again.
  if (localReviewExhausted && !(project.campaign.stopReason ?? "").includes(`[${LOCAL_REVIEW_CONTRACT_VERSION}]`)) return undefined;
  if (localReviewExhausted) {
    return attention({
      type: "capability",
      title: "AI 评审连接未能完成结构化验收",
      reason: project.campaign.stopReason ?? "系统已取得当前成果的本地证据，但所有自动评审重试都未返回完整逐标准判断。",
      stage: "validation",
      riskLevel: "medium",
      blocking: true,
      questions: [],
      suggestedAction: "当前 Candidate 已保留。请检查或切换 AI 评审模型后重试；无需重新生成成果、补截图或连接 Runner。",
      criterionIds: [],
    });
  }

  // A stale pause caused only by locally re-checkable evidence must not be misclassified as a
  // budget/safety limit. The orchestrator can clear this pause and continue into validation itself.
  if (project.campaign.status === "paused" && looksLikeEvidencePause(project)) return undefined;

  if (project.campaign.status === "paused" && project.campaign.stopReason && !/用户暂停|重新验收已经排队/.test(project.campaign.stopReason)) {
    return attention({
      type: "limit",
      title: "自动进化到达安全边界",
      reason: project.campaign.stopReason,
      stage: project.stage,
      riskLevel: "medium",
      blocking: true,
      questions: [],
      suggestedAction: "确认是否放宽轮数、预算或时间边界，或者接受当前最佳成果。",
      criterionIds: [],
    });
  }
  return undefined;
}

export function activeAttentionRequest(project: EvolveProject) {
  return [...(project.attentionRequests ?? [])].reverse().find((item) => item.status === "pending");
}

export function reconcileAttentionRequest(project: EvolveProject, next?: AttentionRequest): EvolveProject {
  const at = new Date().toISOString();
  const existing = project.attentionRequests ?? [];
  const normalized = existing.map((item) => item.status === "pending" && item.id !== next?.id
    ? { ...item, status: "resolved" as const, resolvedAt: at, resolution: item.resolution ?? "系统状态变化后自动解除阻塞" }
    : item);
  if (!next) return { ...project, attentionRequests: normalized };
  if (normalized.some((item) => item.id === next.id && item.status === "pending")) return { ...project, attentionRequests: normalized };
  return { ...project, attentionRequests: [...normalized, next].slice(-50) };
}

/**
 * Pure state-machine decision. It never calls AI, writes storage, or touches React.
 * The executor may loop over this function until it reaches wait-human or complete.
 */
export function deriveAutonomousDecision(project: EvolveProject): AutonomousDecision {
  const hasTarget = project.sourceArtifacts.some((artifact) => artifact.role === "target");
  if (!hasTarget) {
    const request = attention({
      type: "input", title: "需要输入进化对象", reason: "当前没有可进化的目标内容。", stage: "target",
      riskLevel: "low", blocking: true, questions: [], criterionIds: [], suggestedAction: "上传、粘贴或选择至少一个进化对象。",
    });
    return { action: "wait-human", reason: request.reason, stage: request.stage, attention: request };
  }

  const acceptedOutput = project.outputArtifacts.some((artifact) => artifact.accepted && artifact.kind === "primary");
  const offlineDelivery = project.targetConnection.adapter !== "http";
  if (deliveryReadiness(project).ready && acceptedOutput) {
    if (offlineDelivery && project.lessons.length === 0) return { action: "distill", reason: "离线成果已通过完整验收，自动沉淀本轮 Lesson", stage: "learning" };
    if (offlineDelivery && project.nextQueue.length === 0) return { action: "next-queue", reason: "Lesson 已形成，自动生成下一轮 Evolve Queue", stage: "learning" };
    return { action: "complete", reason: offlineDelivery ? "离线成果、经验与下一轮建议均已准备完成" : "最终成果已通过验收并准备完成", stage: offlineDelivery ? "learning" : "release" };
  }
  if (campaignGoalSatisfied(project)) return { action: "package", reason: "完整验收已通过，冻结并打包最终成果", stage: "release" };
  if (project.inputUnderstanding?.status !== "ready") return { action: "understand", reason: "先完整理解输入与隐含约束", stage: "target" };

  const clarifications = autonomousClarificationPlan(project);
  if (clarifications.auto.length) return { action: "adopt-defaults", reason: `自动采用 ${clarifications.auto.length} 条低风险默认假设`, stage: "target", autoClarifications: clarifications.auto };

  const request = deriveAttentionRequest(project);
  if (request) return { action: "wait-human", reason: request.reason, stage: request.stage, attention: request };

  const currentCandidateId = project.experimentRun.winnerId ?? project.experimentRun.pendingEvidenceCandidateId;
  const hasCurrentCandidate = Boolean(currentCandidateId && project.candidates.some((candidate) => candidate.id === currentCandidateId));
  const hasVerifiedValidationFailure = project.validationRun.checks.some((item) => item.status === "fail")
    || Boolean(project.validationRun.evaluation?.criterionScores?.some((item) => item.verificationStatus === "verified" && !item.pass));
  const pendingIdsForDecision = pendingEvidenceCriterionIds(project);
  const hasLocalEvidencePending = pendingIdsForDecision.length > 0 && pendingIdsForDecision.every((id) => {
    const criterion = project.acceptanceRubric.find((item) => item.id === id);
    return Boolean(criterion && criterionCanUseLocalSnapshotEvidence(project, criterion));
  });
  if (hasCurrentCandidate && project.validationRun.status === "completed" && !hasVerifiedValidationFailure
    && (hasLocalEvidencePending || (project.artifactAcceptance.status === "unverified" && looksLikeEvidencePause(project)))) {
    return { action: "revalidate", reason: "当前候选没有已证实失败，只需用现有成果自动补齐本地验证", stage: "validation" };
  }

  const rubricCheck = rubricValidation(project.acceptanceRubric);
  if (!rubricCheck.ready) return { action: "compile-contract", reason: "编译项目专属验收标准", stage: "target" };
  const suiteCoverage = rubricSuiteCoverage(project.acceptanceRubric, project.evalSuite, project.hiddenEvalSuite);
  if (!suiteCoverage.ready) {
    const missing = [...suiteCoverage.uncovered, ...suiteCoverage.hiddenHardGateMissing.map((criterion) => criterion.id)];
    return { action: "build-eval", reason: `Eval Suite 与最新验收标准不一致，自动补齐：${[...new Set(missing)].join(", ")}`, stage: "target" };
  }
  if (project.gates.find((gate) => gate.id === "target-ready")?.status !== "approved") return { action: "approve-contract", reason: "安全地自动批准离线目标契约", stage: "target" };
  return { action: "run-campaign", reason: "继续诊断、生成、比较、验证和修复循环", stage: project.stage };
}

