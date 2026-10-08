import type { EvolveProject } from "@evolution/contracts";
import { serverExperimentJudgeWait } from "@evolution/harness";
import { productionRuntimeMode } from "./production-runtime";
import { startServerEvolutionWorkflow } from "./server-workflow-client";

export function canRetryStoredServerExperiment(project: EvolveProject) {
  return productionRuntimeMode() === "http" && Boolean(serverExperimentJudgeWait(project));
}

/** The same persisted wait always has the same key, including a lost start response or page reload. */
export async function retryStoredServerExperiment(project: EvolveProject) {
  if (!canRetryStoredServerExperiment(project)) throw new Error("当前不是可恢复的后台评审断点，请刷新任务状态后重试。");
  const binding = JSON.stringify(["experiment-judge-retry-v1", project.id, project.experimentRun.id, project.updatedAt]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(binding));
  const sha = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
  return startServerEvolutionWorkflow(project.id, { idempotencyKey: "experiment-judge-retry:" + sha });
}
