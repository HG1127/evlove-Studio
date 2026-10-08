import { AttentionRequestSchema, type Stage } from "@evolution/contracts";
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
