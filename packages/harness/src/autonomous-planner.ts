import type { AttentionRequest, EvolveProject, Stage } from "@evolution/contracts";
import {hasServerFrozenVerifiedRejection,hasServerNativeHtmlHoldoutRetry} from "./server-frozen-validation-checkpoint";
import {
  campaignGoalSatisfied,
  campaignPreflightStopReason,
  assertDeliverablePackageIdentity,
  reconcileAcceptedOfflineChampion,
  deliveryReadiness,
  evidenceRouteForCriterion,
  experimentNeedsEvidenceRepair,
  goalReadiness,
  currentReleaseCandidate,
  nextDurableReleaseAction,
  productionOutcomeFreshness,
  productionOutcomeTrend,
  productionGoalReadiness,
  projectNeedsProductionLearningRedistill,
  projectHasLiveReleaseDecision,
  projectHasOnlineReleaseTarget,
  projectUsesHttpRelease,
  projectUsesVercelRelease,
  rubricSuiteCoverage,
  rubricValidation,
} from "@evolution/core";
import { autonomousClarificationPlan } from "./autonomy-policy";
import {serverExperimentRecoveryWait} from "./server-experiment-wait";

export type AutonomousAction =
  | "understand"
  | "adopt-defaults"
  | "compile-contract"
  | "approve-contract"
  | "build-eval"
  | "revalidate"
  | "run-campaign"
  | "package"
  | "run-release"
  | "reconcile-release"
  | "distill"
  | "next-queue"
  | "complete"
  | "wait-human";

/** Bump when local Judge settlement semantics change; stale persisted fuse states get one fresh retry. */
export const LOCAL_REVIEW_CONTRACT_VERSION = "judge-contract-v4";

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
      if (criterion && evidenceRouteForCriterion(project, criterion) !== "local") ids.add(result.criterionId);
    }
  }
  return [...ids];
}

function incompleteLocalEvidenceCriterionIds(project: EvolveProject) {
  if (project.validationRun.status !== "completed") return [];
  const pending = new Set(pendingEvidenceCriterionIds(project));
  const incompleteRuns = new Set(project.validationRun.runs.filter((run) => run.verificationStatus !== "verified").map((run) => run.testCaseId));
  return project.acceptanceRubric.filter((criterion) => pending.has(criterion.id) && (
    (project.validationRun.evaluation?.criterionScores?.find((score) => score.criterionId === criterion.id)?.testCaseIds ?? []).some((id) => incompleteRuns.has(id))
    || project.hiddenEvalSuite.some((testCase) => incompleteRuns.has(testCase.id) && testCase.criterionIds.includes(criterion.id))
  ))
    .map((criterion) => criterion.id);
}

function looksLikeEvidencePause(project: EvolveProject) {
  if (project.artifactAcceptance.status === "unverified") return true;
  const reason = project.campaign.stopReason ?? "";
  return /(?:只剩|缺少|待补|等待).{0,24}(?:验证|证据)|真实验证|验证能力|UNVERIFIED|unverified/i.test(reason);
}

/** A measured Baseline without diagnosis-ready evidence is a capability pause, not a campaign limit. */
export function isLocalBaselineEvidencePause(project: EvolveProject): boolean {
  return project.campaign.status === "paused"
    && project.stage === "baseline"
    && (project.campaign.stopReason ?? "").startsWith("当前版本基线不足以进入自动诊断");
}

export function isLocalDemoBaselinePause(project: EvolveProject): boolean {
  return isLocalBaselineEvidencePause(project) && project.baselineRun.result?.demoJudged === true;
}

/** A Baseline Judge error may occur before a new Baseline result is persisted. */
export function isLocalBaselineJudgePause(project: EvolveProject): boolean {
  return isLocalDemoBaselinePause(project)
    || (project.campaign.status === "paused" && (project.campaign.stopReason ?? "").startsWith("Baseline 评审未完成，已保留断点："));
}
/** Retryable generation failures take precedence over unrelated pending verification items. */
export function artifactRepairNeedsRecovery(project: EvolveProject): boolean {
  const acceptance = project.artifactAcceptance;
  const currentId = project.experimentRun.winnerId ?? project.experimentRun.pendingEvidenceCandidateId;
  if (!acceptance.error || acceptance.status === "passed" || !currentId || acceptance.candidateId !== currentId
    || !project.candidates.some((candidate) => candidate.id === currentId)) return false;
  // Compatibility for saved checkpoints created before failurePhase was introduced.
  return acceptance.failurePhase === "repair" || (!acceptance.failurePhase
    && /repair-artifact生成未完成|自动修复第\s*\d+\s*次未完成/.test(`${acceptance.summary} ${acceptance.error}`));
}

export function deriveAttentionRequest(project: EvolveProject): AttentionRequest | undefined {
  if(project.campaign.status==="paused"&&(project.campaign.stopReason??"").startsWith("[server-campaign-final-holdout-")){
    return attention({type:"evidence",title:"独立终验尚未完成",reason:project.campaign.stopReason!,stage:"validation",riskLevel:"medium",blocking:true,questions:[],criterionIds:[],
      suggestedAction:"已有预留题集时恢复验证能力并复验同一冻结候选；历史修复候选未预留题集时需启动新的受控轮次，不能事后补造盲测通过证据。"});
  }
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

  if (artifactRepairNeedsRecovery(project)) {
    return attention({
      type: "capability", diagnosticCode: "artifact-repair-recovery",
      title: "AI 自动修复未完成，当前成果与验证断点已保留",
      reason: project.artifactAcceptance.summary || project.artifactAcceptance.error!,
      stage: "validation", riskLevel: "medium", blocking: true, questions: [], criterionIds: [],
      suggestedAction: "重试自动修复，或在 AI 模型与连接中切换修复模型。系统会复用同一成果的验证证据，修复成功后验证新快照，再检查其余证据要求。",
    });
  }

  const pendingEvidenceIds = pendingEvidenceCriterionIds(project);
  const pendingEvidence = pendingEvidenceIds.flatMap((id) => {
    const criterion = project.acceptanceRubric.find((item) => item.id === id);
    return criterion ? [criterion] : [];
  });
  const externalEvidence = pendingEvidence.filter((criterion) => evidenceRouteForCriterion(project, criterion) !== "local");
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

  const incompleteLocalIds = incompleteLocalEvidenceCriterionIds(project);
  if (incompleteLocalIds.length) {
    return attention({
      type: "capability",
      diagnosticCode: "local-evidence-incomplete",
      title: "当前成果的本地证据不完整，不能完成全量验收",
      reason: `当前 Candidate 的 ${incompleteLocalIds.length} 项验收仅取得局部证据或执行未完成：${incompleteLocalIds.join("、")}。重复调用 AI 评审不会把不完整证据变成完整证据。`,
      stage: "validation",
      riskLevel: "medium",
      blocking: true,
      questions: [],
      suggestedAction: "检查当前 Candidate 是否是完整成果而非修改片段，并查看技术运行记录中的测试输出与证据截取范围；需补齐完整快照或相应真实验证能力后复验。当前成果和断点已保留。",
      criterionIds: incompleteLocalIds,
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

  const staleServerBaselinePause = project.campaign.status === "paused"
    && (project.campaign.stopReason ?? "").includes("[server-campaign-baseline-pending]");
  if (staleServerBaselinePause) return undefined;

  const staleServerExperimentPause = project.campaign.status === "paused"
    && (project.campaign.stopReason ?? "").includes("[server-campaign-experiment-pending]");
  if (staleServerExperimentPause) return undefined;

  const staleServerHoldoutPause = project.campaign.status === "paused"
    && (project.campaign.stopReason ?? "").includes("[server-campaign-holdout-pending]");
  if (staleServerHoldoutPause) return undefined;

  const staleServerArtifactAcceptancePause = project.campaign.status === "paused"
    && (project.campaign.stopReason ?? "").includes("[server-campaign-artifact-acceptance-pending]");
  if (staleServerArtifactAcceptancePause) return undefined;

  const frozenExperimentJudgeWait=serverExperimentRecoveryWait(project);
  if(frozenExperimentJudgeWait?.startsWith("[server-campaign-experiment-judge-pending]")){
    return attention({
      type:"capability",diagnosticCode:"judge-recovery",
      title:"候选文件已冻结，等待独立 AI 评审",
      reason:frozenExperimentJudgeWait,
      stage:"experiment",riskLevel:"medium",blocking:true,questions:[],
      suggestedAction:"实际 Candidate 文件和已记录的实验观察均已保留。请检查或切换支持完整 JSON 结构化输出的评审模型，然后从当前 Experiment 断点重试；系统会先核验冻结文件字节与测试指纹，不应重新生成候选文件。",
      criterionIds:[],
    });
  }

  const serverCampaignCapabilityPending = project.campaign.status === "paused"
    && /\[server-campaign-(?:ai-pending|baseline-evidence-pending|baseline-judge-pending|contract-pending|diagnosis-pending|plan-grounding-pending|planning-context-pending|experiment-build-pending|experiment-judge-pending|holdout-contract-pending|holdout-artifact-pending|holdout-judge-pending|holdout-review-pending|holdout-evidence-pending|artifact-acceptance-candidate-pending|artifact-acceptance-evidence-pending|artifact-acceptance-integrity-failed|artifact-repair-pending)\]/.test(project.campaign.stopReason ?? "");
  if (serverCampaignCapabilityPending) {
    return attention({
      type: "capability",
      title: "Server Campaign 已保存断点，等待后续执行能力",
      reason: project.campaign.stopReason ?? "Durable Workflow 已保存 Campaign 断点，但下一执行面尚未就绪。",
      stage: project.stage,
      riskLevel: "medium",
      blocking: true,
      questions: [],
      suggestedAction: "当前 Baseline / Problem / Diagnosis / Candidate / Holdout 断点会保留；补齐对应执行、评审或 Artifact Acceptance 能力后从断点继续，无需重新开始。",
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
      diagnosticCode: "judge-recovery",
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

  if (isLocalBaselineJudgePause(project) && !isLocalBaselineEvidencePause(project)) {
    return attention({
      type: "capability",
      title: "Baseline 评审连接未能完成",
      reason: project.campaign.stopReason ?? "当前版本的 Baseline 评审未完成。",
      stage: "baseline", riskLevel: "medium", blocking: true, questions: [],
      suggestedAction: "检查并测试真实 AI 评审连接，再从保留的断点重新测量 Baseline。",
      criterionIds: [],
    });
  }
  if (isLocalBaselineEvidencePause(project)) {
    const demoJudge = isLocalDemoBaselinePause(project);
    return attention({
      type: "capability",
      title: demoJudge ? "当前版本基线缺少真实 AI 评审" : "当前版本基线缺少可靠验证证据",
      reason: project.campaign.stopReason ?? "当前版本的 Baseline 尚不足以支持自动诊断。",
      stage: "baseline",
      riskLevel: "medium",
      blocking: true,
      questions: [],
      suggestedAction: demoJudge
        ? "在 AI 模型与连接中配置并测试真实评审模型，再从当前轮次重新测量 Baseline；演示评分不会被复用。"
        : "检查 Target Runner 或文件验证能力，再从当前轮次补测缺少证据的验收题；不需要增加进化轮数。",
      criterionIds: [],
    });
  }

  // A stale pause caused only by locally re-checkable evidence must not be misclassified as a
  // budget/safety limit. The orchestrator can clear this pause and continue into validation itself.
  if (project.campaign.status === "paused" && looksLikeEvidencePause(project)) return undefined;

  // Candidate construction failure is a retryable execution failure, not a budget or safety
  // boundary. Keep the checkpoint and show Resume; the failed build still needs a real model
  // result and must never be treated as an accepted artifact.
  if (project.campaign.status === "paused" && /^(?:候选文件构造未完成|上次本地进化已中断)；已保留本轮断点/.test(project.campaign.stopReason ?? "")) return undefined;

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

function evidenceCanWaitDuringRepair(project:EvolveProject,request:AttentionRequest|undefined){
  return request?.type==="evidence"&&request.stage==="validation"&&request.criterionIds.length>0
    &&request.criterionIds.every(id=>project.validationRun.evaluation?.criterionScores?.find(score=>score.criterionId===id)?.verificationStatus!=="verified")
    &&hasServerFrozenVerifiedRejection(project);
}

export function reconcileAttentionRequest(project: EvolveProject, next?: AttentionRequest): EvolveProject {
  const at = new Date().toISOString();
  const existing = project.attentionRequests ?? [];
  if(!next&&existing.some(item=>item.status==="pending"&&item.type==="evidence"&&item.stage==="validation")
    &&project.validationRun.status==="completed"){
    const stillNeeded=deriveAttentionRequest(project);
    if(evidenceCanWaitDuringRepair(project,stillNeeded))next=stillNeeded;
  }
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
  // A later unsuccessful search round must not erase a prior, fully accepted
  // Search Champion. Delivery remains bound to the champion's own immutable
  // Hidden/Gate F receipts rather than the losing last attempt's idle validation.
  // This only applies to offline Artifact Target packages; no online release
  // authorization or production evidence is inferred from a historical version.
  let exactPriorChampionPackage=false;
  if(acceptedOutput&&project.targetConnection.adapter==="artifact"
    &&project.release.status==="idle"&&project.searchChampion?.candidate){
    try{
      exactPriorChampionPackage=assertDeliverablePackageIdentity(project)===project.searchChampion.candidate.id;
    }catch{
      // Missing/tampered metadata or frozen bytes stay blocked, never repaired
      // by treating a stale artifact's accepted flag as authoritative.
    }
  }
  if(acceptedOutput&&(deliveryReadiness(project).ready||exactPriorChampionPackage)) {
    const onlineRelease = projectHasOnlineReleaseTarget(project);
    const liveReleaseDecision=projectHasLiveReleaseDecision(project);
    if(onlineRelease&&liveReleaseDecision){
      const freshness=productionOutcomeFreshness(project);
      if(freshness.status!=="fresh"){
        if(projectUsesVercelRelease(project)||projectUsesHttpRelease(project)){
          return {
            action:"reconcile-release",
            reason:`${freshness.reason} 先只读刷新 Production Outcome，再继续 Learning / Complete。`,
            stage:"release",
          };
        }
        const request=attention({
          type:"capability",title:"Production Outcome 已过期，需要重新观测",
          reason:freshness.reason,
          stage:"release",riskLevel:"high",blocking:true,questions:[],criterionIds:[],
          suggestedAction:"刷新真实 Production Health / Outcome 后再继续经验提炼；旧 healthy 结果不会被当作当前线上证据。",
        });
        return {action:"wait-human",reason:request.reason,stage:request.stage,attention:request};
      }
      const trend=productionOutcomeTrend(project);
      if(trend.status==="healthy-insufficient"||trend.status==="unknown"){
        if(projectUsesVercelRelease(project)||projectUsesHttpRelease(project)){
          return {
            action:"reconcile-release",
            reason:`${trend.reason} 先补充只读 Production Observation，再判断是否足以进入 Learning。`,
            stage:"release",
          };
        }
      }
      if(trend.status==="degrading"||trend.status==="flapping"){
        const request=attention({
          type:"capability",
          title:trend.status==="flapping"?"Production Outcome 出现波动":"Production Outcome 正在恶化",
          reason:trend.reason,
          stage:"release",riskLevel:"high",blocking:true,questions:[],criterionIds:[],
          suggestedAction:"先核对最新 Production Outcome 与最近 Observation Timeline；连续异常或健康/异常反复不会被当作稳定线上证据。",
        });
        return {action:"wait-human",reason:request.reason,stage:request.stage,attention:request};
      }
      const goal=productionGoalReadiness(project);
      if(!goal.ready){
        if(!project.release.goalEvidence&&project.release.deploymentId&&project.release.stableDeploymentId&&(projectUsesVercelRelease(project)||projectUsesHttpRelease(project))){
          return {action:"reconcile-release",stage:"release",reason:"发布健康已观测；只读获取与本次发布绑定的目标收益统计。"};
        }
        const request=attention({type:"evidence",diagnosticCode:"production-goal-evidence",title:"需要验证真实目标收益",reason:goal.reason,
          stage:"release",riskLevel:"medium",blocking:true,questions:[],criterionIds:[],
          suggestedAction:"配置目标指标的真实 Telemetry，补齐 Stable / Candidate 对照样本后刷新线上观测；健康检查不会代替业务改进证据。"});
        return {action:"wait-human",reason:request.reason,stage:"release",attention:request};
      }
    }
    if (onlineRelease && !liveReleaseDecision) {
      const vercelRelease=projectUsesVercelRelease(project);
      const httpRelease=projectUsesHttpRelease(project);
      if(project.release.recovery?.status==="pending"&&vercelRelease){
        return {
          action:"reconcile-release",
          reason:"Release 上一步结果需要恢复；先只读核对 Vercel 当前 Production / Preview 真相，再决定是否继续生产动作。",
          stage:"release",
        };
      }
      if(project.release.recovery?.status==="pending"&&httpRelease){
        return {
          action:"reconcile-release",
          reason:"HTTP Release 上一步写操作结果不确定；只读调用 Target Observe 核对真实外部状态，绝不自动重放生产副作用。",
          stage:"release",
        };
      }
      if(project.release.recovery?.status==="manual-check"){
        const request=attention({
          type:"capability",title:"线上 Release 需要人工核对后再继续",
          reason:project.release.recovery.reason,
          stage:"release",riskLevel:"high",blocking:true,questions:[],criterionIds:[],
          suggestedAction:"在发布控制中查看当前 Production / Preview 实际状态；可再次执行“核对线上状态”，或在确认目标后手动完成对应 Release 动作。系统不会自动猜测未知 Deployment。",
        });
        return {action:"wait-human",reason:request.reason,stage:request.stage,attention:request};
      }
      const releaseGate=project.gates.find((gate)=>gate.id==="release-ready");
      if(releaseGate?.status!=="approved"){
        const request = attention({
          type:"capability",
          title:"需要授权 Release Ready",
          reason:"线上 Target 已完成 Gate F 与打包，但生产发布必须先由用户明确授权 Release Ready。",
          stage:"release",riskLevel:"high",blocking:true,questions:[],criterionIds:[],
          suggestedAction:"在最终验收确认“授权进入上线流程”。授权仅允许进入 Preview/Health/Promote 治理，不会绕过 Health Gate 或回滚保护。",
        });
        return {action:"wait-human",reason:request.reason,stage:request.stage,attention:request};
      }
      if(!vercelRelease&&!httpRelease){
        const request=attention({
          type:"capability",title:"当前线上 Release Target 尚未接入 Durable 编排",
          reason:"当前 Release Target 不是已支持的 Vercel 或 HTTP Target。",
          stage:"release",riskLevel:"high",blocking:true,questions:[],criterionIds:[],
          suggestedAction:"连接 Vercel Release Target 或真实 HTTP Target Runner 后继续。",
        });
        return {action:"wait-human",reason:request.reason,stage:request.stage,attention:request};
      }
      const candidate=currentReleaseCandidate(project);
      if(vercelRelease&&candidate&&project.release.candidateId===candidate.id&&!project.release.deploymentId&&project.release.sourceGitCommitSha){
        return {
          action:"reconcile-release",
          reason:`当前 exact Candidate 已发布到 Git commit ${project.release.sourceGitCommitSha}；自动按 exact SHA 发现并绑定唯一 Vercel Preview，不按时间或分支名猜测。`,
          stage:"release",
        };
      }
      if(vercelRelease&&(!candidate||project.release.candidateId!==candidate.id||!project.release.deploymentId)){
        const request=attention({
          type:"capability",title:"需要显式绑定 Preview Deployment",
          reason:"Release Ready 已授权，但当前 exact Candidate 尚未绑定 READY Preview Deployment；系统禁止自动猜测 Deployment。",
          stage:"release",riskLevel:"high",blocking:true,questions:[],criterionIds:[],
          suggestedAction:"在发布控制中选择与当前 Candidate 对应的 READY Preview Deployment，然后继续自主进化。",
        });
        return {action:"wait-human",reason:request.reason,stage:request.stage,attention:request};
      }
      if(httpRelease&&(!candidate||project.release.candidateId!==candidate.id)){
        const request=attention({
          type:"capability",title:"HTTP Release Candidate 未绑定",
          reason:"Release Ready 已授权，但当前 HTTP Target 没有绑定 exact Candidate；禁止对未知版本执行生产写操作。",
          stage:"release",riskLevel:"high",blocking:true,questions:[],criterionIds:[],
          suggestedAction:"确认当前 Winner / Search Champion 与 Release Candidate 一致后再继续。",
        });
        return {action:"wait-human",reason:request.reason,stage:request.stage,attention:request};
      }
      if(nextDurableReleaseAction(project)){
        return {action:"run-release",reason:httpRelease
          ?"Release Ready 已授权且 exact Candidate 已绑定；Durable Workflow 通过 HTTP Target live receipt 推进 Shadow/Canary/Promote/Rollback。"
          :"Release Ready 已授权且 exact Candidate/Deployment 已绑定；Durable Workflow 自动推进 Preview/Health/Promote/Rollback。",stage:"release"};
      }
      const request = attention({
        type: "capability",
        title: "线上成果已验收，等待真实 Release 决策",
        reason: "当前 Candidate 已通过 Gate F 并完成打包，但线上 Target 尚无 live Promote / Rollback 证据；不能把“已打包”冒充“已上线闭环”。",
        stage: "release",
        riskLevel: "high",
        blocking: true,
        questions: [],
        suggestedAction: httpRelease
          ?"查看 HTTP Target 的 live release receipt / Production 状态；未知写操作结果不会自动重放。"
          :"查看 Preview/Production Health 与 rollback baseline；异常状态不会自动猜测或伪造成功，处理后可从同一 Release Candidate 继续。",
        criterionIds: [],
      });
      return { action: "wait-human", reason: request.reason, stage: request.stage, attention: request };
    }
    if (onlineRelease&&projectNeedsProductionLearningRedistill(project)) return {action:"distill",reason:"Production Outcome 已重新稳定；重新提炼一次线上经验，只有新证据再次成立才恢复 Verified Skill。",stage:"learning"};
    if (project.lessons.length === 0) return { action: "distill", reason: onlineRelease ? "真实 Release 决策已完成，自动沉淀本轮 Lesson" : "离线成果已通过完整验收，自动沉淀本轮 Lesson", stage: "learning" };
    if (project.nextQueue.length === 0) return { action: "next-queue", reason: "Lesson 已形成，自动生成下一轮 Evolve Queue", stage: "learning" };
    return { action: "complete", reason: onlineRelease ? "线上 Release 决策、经验与下一轮建议均已完成" : "离线成果、经验与下一轮建议均已准备完成", stage: "learning" };
  }
  if(acceptedOutput&&project.targetConnection.adapter==="artifact"
    &&project.searchChampion?.candidate&&!exactPriorChampionPackage
    &&!deliveryReadiness(project).ready){
    const request=attention({
      type:"capability",title:"已交付文件需要重新核对",
      reason:"已持久化的离线成果与当前通过验收的 Search Champion、冻结文件或验收指纹不一致；禁止重复打包覆盖历史结果。",
      stage:"release",riskLevel:"high",blocking:true,questions:[],criterionIds:[],
      suggestedAction:"核对 exact Champion 文件哈希、冻结 Blob 和验收版本，再恢复离线交付。",
    });
    return {action:"wait-human",reason:request.reason,stage:request.stage,attention:request};
  }

  // Prior Gate F versions may have persisted a passed, fully measured offline
  // round while omitting the Champion projection. Restore only that exact
  // evidence-bound state; never launch another search or bypass a safety pause.
  if (reconcileAcceptedOfflineChampion(project, project.artifactAcceptance.acceptedAt)) {
    return {
      action:"run-campaign",
      reason:"已有完整 Hidden Holdout、Gate F 与冻结成果，恢复遗漏的 Search Champion；禁止重新生成或发布",
      stage:"validation",
    };
  }
  // A verified Champion is a reusable intermediate search state, NOT itself a
  // stop signal. In multi-round mode (stopWhenAcceptanceMet=false), continue
  // measuring the next round against that Champion until the configured budget,
  // patience, safety or score policy actually terminates exploration.
  // Do not package an older Champion while a round checkpoint is still active
  // or a safety/evidence stop requires manual intervention.
  const acceptedStopReason=campaignPreflightStopReason(project);
  const safeToPackage=campaignGoalSatisfied(project)
    && !project.campaign.checkpoint
    && project.campaign.status!=="paused"
    && (project.campaign.status==="completed" || Boolean(acceptedStopReason))
    && project.artifactAcceptance.status==="passed"
    && project.validationRun.evaluation?.safety!=="FAIL"
    && !(project.validationRun.evaluation?.unverifiedCriterionIds?.length);
  if (safeToPackage) return {
    action:"package",
    reason:acceptedStopReason
      ? "已达到配置的进化停止条件（"+acceptedStopReason+"），打包已验收 Search Champion"
      : "已完成搜索，冻结并打包已验收 Search Champion",
    stage:"release",
  };
  if (project.inputUnderstanding?.status !== "ready") return { action: "understand", reason: "先完整理解输入与隐含约束", stage: "target" };

  const clarifications = autonomousClarificationPlan(project);
  if (clarifications.auto.length) return { action: "adopt-defaults", reason: `自动采用 ${clarifications.auto.length} 条低风险默认假设`, stage: "target", autoClarifications: clarifications.auto };

  if(hasServerNativeHtmlHoldoutRetry(project))return {
    action:"run-campaign",stage:"validation",reason:"明确恢复后重测同一冻结 HTML 的原生证据；保留旧判定，不生成 Candidate 或推断通过。",
  };

  const request = deriveAttentionRequest(project);
  if(evidenceCanWaitDuringRepair(project,request)){
    return {action:"run-campaign",stage:"validation",reason:"先处理同一冻结候选已证实的失败；其他标准的证据请求保持待补，不因此进入发布。"};
  }
  if (request) return { action: "wait-human", reason: request.reason, stage: request.stage, attention: request };

  const currentCandidateId = project.experimentRun.winnerId ?? project.experimentRun.pendingEvidenceCandidateId;
  const hasCurrentCandidate = Boolean(currentCandidateId && project.candidates.some((candidate) => candidate.id === currentCandidateId));
  // A durable Campaign with an exact completed Hidden paper must resume the
  // frozen Gate F checkpoint before generic local revalidation. Gate F itself
  // re-reads every frozen Blob and re-checks the original evidence fingerprint;
  // routing to "revalidate" here strands a verified Candidate in a capability wait.
  // A paused Campaign still goes through the Attention gate above, and may only
  // reach this branch after an explicit, governed resume.
  if (project.stage === "validation"
    && project.campaign.status !== "paused"
    && project.campaign.checkpoint?.round === project.campaign.currentRound + 1
    && project.campaign.checkpoint.completedPhase === "validation"
    && hasCurrentCandidate
    && project.validationRun.status === "completed"
    && project.validationRun.candidateId === currentCandidateId
    && Boolean(project.validationRun.evaluation)
    && project.artifactAcceptance.status === "unverified") {
    return {
      action: "run-campaign",
      reason: "恢复已有 Hidden Validation 的 Artifact Acceptance 断点；直接复核冻结文件与原始证据，不生成新 Candidate、不重写评分",
      stage: "validation",
    };
  }
  const hasVerifiedValidationFailure = project.validationRun.checks.some((item) => item.status === "fail")
    || Boolean(project.validationRun.evaluation?.criterionScores?.some((item) => item.verificationStatus === "verified" && !item.pass));
  const pendingIdsForDecision = pendingEvidenceCriterionIds(project);
  const hasLocalEvidencePending = pendingIdsForDecision.length > 0 && pendingIdsForDecision.every((id) => {
    const criterion = project.acceptanceRubric.find((item) => item.id === id);
    return Boolean(criterion && evidenceRouteForCriterion(project, criterion) === "local");
  });
  if (hasCurrentCandidate && project.validationRun.status === "completed" && !hasVerifiedValidationFailure
    && (hasLocalEvidencePending || (project.artifactAcceptance.status === "unverified" && looksLikeEvidencePause(project)))) {
    return { action: "revalidate", reason: "当前候选没有已证实失败，只需用现有成果自动补齐本地验证", stage: "validation" };
  }

  const rubricCheck = rubricValidation(project.acceptanceRubric,project.sourceArtifacts);
  if (!rubricCheck.ready) return { action: "compile-contract", reason: "编译项目专属验收标准", stage: "target" };
  const suiteCoverage = rubricSuiteCoverage(project.acceptanceRubric, project.evalSuite, project.hiddenEvalSuite);
  if (!suiteCoverage.ready) {
    const missing = [...suiteCoverage.uncovered, ...suiteCoverage.hiddenHardGateMissing.map((criterion) => criterion.id)];
    return { action: "build-eval", reason: `Eval Suite 与最新验收标准不一致，自动补齐：${[...new Set(missing)].join(", ")}`, stage: "target" };
  }
  if (project.gates.find((gate) => gate.id === "target-ready")?.status !== "approved") return { action: "approve-contract", reason: "安全地自动批准离线目标契约", stage: "target" };
  return { action: "run-campaign", reason: "继续诊断、生成、比较、验证和修复循环", stage: project.stage };
}

