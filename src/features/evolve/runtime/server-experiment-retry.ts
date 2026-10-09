import type { EvolveProject } from "@evolution/contracts";
import { canRemeasureLegacyServerPlan, serverExperimentRecoveryWait, serverMainFlowRecoveryWait, serverMainFlowWaitMarker } from "@evolution/harness";
import { productionRuntimeMode } from "./production-runtime";
import { startServerEvolutionWorkflow } from "./server-workflow-client";

export function serverMainFlowRetryMode(project: EvolveProject) {
  if (productionRuntimeMode() !== "http") return undefined;
  if (project.campaign.serverRecoveryWait) return serverMainFlowRecoveryWait(project) ? "checkpoint" as const : undefined;
  if (serverExperimentRecoveryWait(project)) return "experiment" as const;
  return canRemeasureLegacyServerPlan(project) ? "fresh-baseline" as const : undefined;
}
export function canRetryStoredServerExperiment(project: EvolveProject) {
  return Boolean(serverMainFlowRetryMode(project));
}

export function serverMainFlowRetryUnavailableReason(project: EvolveProject) {
  if (productionRuntimeMode() !== "http" || serverMainFlowRetryMode(project)) return undefined;
  if (project.campaign.serverRecoveryWait) return "此断点的输入、父代、考卷绑定或运行条件需要核对；请查看运行记录后继续。";
  if (serverMainFlowWaitMarker(project) && (project.candidates.length || project.stage === "validation"))
    return "旧断点没有创建时的输入、父代与考卷绑定。当前已有 Candidate 或下游证据，需先核对保存的生成身份。";
  return undefined;
}
/** Keep the stored-version operation stable across page reloads and lost start acknowledgements. */
export async function retryStoredServerExperiment(project: EvolveProject) {
  const mode = serverMainFlowRetryMode(project);
  if (!mode) throw new Error("当前不是可恢复的后台断点；旧 Candidate / 下游缺少生成绑定时请先核对保存的身份。");
  const legacy = mode === "experiment";
  const version = legacy ? "experiment-judge-retry-v1" : "server-main-flow-retry-v1";
  const binding = JSON.stringify([version, project.id, legacy ? project.experimentRun.id : mode, project.updatedAt]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(binding));
  const sha = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
  return startServerEvolutionWorkflow(project.id, { idempotencyKey: (legacy ? "experiment-judge-retry:" : "server-main-flow-retry:") + sha,
    ...(mode === "fresh-baseline" ? { intent: "remeasure-current-input" as const, expectedMissionUpdatedAt: project.updatedAt } : {}) });
}
