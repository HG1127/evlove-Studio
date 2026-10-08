import { AttentionRequestSchema, type EvolveProject, type Stage } from "@evolution/contracts";
import type { ServerHarnessPlan } from "./server-plan";

/** Retain the failed action's checkpoint; a capability outage is not product failure. */
export function serverControlCapabilityWaitPlan(
  plan: ServerHarnessPlan,
  args: { stage: Stage; reason: string; at: string },
): ServerHarnessPlan {
  const attention = AttentionRequestSchema.parse({
    id: `server-ai-capability-${plan.checkpoint.id}`,
    type: "capability",
    status: "pending",
    title: "Server AI 暂不可用",
    reason: args.reason,
    stage: args.stage,
    riskLevel: "medium",
    blocking: true,
    questions: [],
    suggestedAction: "恢复 Server AI 后运行健康探测，再继续当前任务；保留现有产物和搜索记录。",
    createdAt: args.at,
  });
  return {
    ...plan,
    decision: { action: "wait-human", stage: args.stage, reason: args.reason, attention },
    policy: { ...plan.policy, mode: "human" },
  };
}

/** Match only the pause and pending request written by the server control AI guard. */
export function serverControlAiWait(project: EvolveProject) {
  if (project.campaign.status !== "paused" || !project.campaign.stopReason) return undefined;
  const pending = (project.attentionRequests ?? []).filter((request) => request.status === "pending" && request.blocking);
  if (pending.length !== 1) return undefined;
  const request = pending[0];
  return request.type === "capability" && request.id.startsWith("server-ai-capability-server-checkpoint-")
    && request.reason === project.campaign.stopReason && request.stage === project.stage ? request : undefined;
}

/** Restore capability waiting without granting a fresh budget/time window or changing evidence. */
export function recoverServerControlAiWait(project: EvolveProject, at: string): EvolveProject {
  const request = serverControlAiWait(project);
  if (!request) return project;
  return {
    ...project,
    campaign: { ...project.campaign, status: "idle", stopReason: undefined },
    attentionRequests: project.attentionRequests?.map((item) => item.id === request.id
      ? { ...item, status: "resolved", resolvedAt: at, resolution: "Server AI Runtime Probe 已恢复；继续保留的任务阶段。" }
      : item),
    updatedAt: at,
  };
}
