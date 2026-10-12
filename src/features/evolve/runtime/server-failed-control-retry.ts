import type { EvolveProject } from "@evolution/contracts";
import {
  serverFailedControlRetryEligibility,
  serverFailedControlRetryTarget,
  serverFailedControlRetryWire,
  type ServerFailedControlRetryTarget,
} from "@evolution/harness";
import { getProductionRuntime, productionRuntimeMode } from "./production-runtime";
import { getServerEvolutionWorkflowStatus, startServerEvolutionWorkflow } from "./server-workflow-client";

export class ServerFailedControlRetryUnavailableError extends Error {
  constructor(message = "后台执行状态已变化或无法确认失败，请刷新运行记录后重试。") {
    super(message); this.name = "ServerFailedControlRetryUnavailableError";
  }
}

/** Read the current control Job and SDK metadata; a stored running label is insufficient. */
export async function loadServerFailedControlRetry(project: EvolveProject): Promise<ServerFailedControlRetryTarget | undefined> {
  if (productionRuntimeMode() !== "http") return undefined;
  const jobs = await getProductionRuntime().jobs.list(project.id);
  const target = serverFailedControlRetryTarget(project, jobs);
  if (!target) return undefined;
  const status = await getServerEvolutionWorkflowStatus({ jobId: target.jobId, runId: target.runId });
  return serverFailedControlRetryEligibility(project, status, target) ? target : undefined;
}

/** Recheck the bound failed Run on every explicit attempt, including a lost acknowledgement. */
export async function retryServerFailedControl(project: EvolveProject, target: ServerFailedControlRetryTarget) {
  if (productionRuntimeMode() !== "http") throw new ServerFailedControlRetryUnavailableError("当前未连接后台执行，无法重试后台任务。");
  const status = await getServerEvolutionWorkflowStatus({ jobId: target.jobId, runId: target.runId }).catch(cause => {
    throw new ServerFailedControlRetryUnavailableError(cause instanceof Error ? cause.message : "无法核验后台执行状态。");
  });
  if (!serverFailedControlRetryEligibility(project, status, target))
    throw new ServerFailedControlRetryUnavailableError();
  const sourceUpdatedAt = target.sourceUpdatedAt ?? project.updatedAt;
  const wire = serverFailedControlRetryWire(project.id, sourceUpdatedAt, target.jobId, target.runId);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(wire));
  const sha = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  return startServerEvolutionWorkflow(project.id, {
    intent: "retry-failed-control",
    retryOfControlJobId: target.jobId,
    retryOfRunId: target.runId,
    expectedMissionUpdatedAt: sourceUpdatedAt,
    idempotencyKey: "server-failed-control-retry:" + sha,
  });
}
