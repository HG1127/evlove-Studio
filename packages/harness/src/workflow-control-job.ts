import { EvolutionJobSchema, type EvolutionJob, type EvolutionWorkflowRunInput } from "@evolution/contracts";

export type WorkflowControlJobUpdate = {
  status: "queued" | "running" | "waiting" | "completed" | "failed";
  startedAt?: string;
  finishedAt?: string;
  progress?: EvolutionJob["progress"];
  error?: string;
  checkpointId?: string;
};

export class WorkflowControlJobUnavailableError extends Error {
  readonly reason: "missing" | "identity-conflict" | "terminal";

  constructor(reason: "missing" | "identity-conflict" | "terminal") {
    super("控制 Job 不存在、身份已变化或已结束；本次控制写入已停止。");
    this.name = "WorkflowControlJobUnavailableError";
    this.reason = reason;
  }
}

/** Every Step updates the original request Job, including old persisted Workflow inputs. */
export function buildWorkflowControlJobUpdate(
  current: EvolutionJob | undefined,
  input: EvolutionWorkflowRunInput,
  update: WorkflowControlJobUpdate,
  at: string,
): EvolutionJob {
  if (!current) throw new WorkflowControlJobUnavailableError("missing");
  if (current.id !== input.controlJobId || current.missionId !== input.missionId || current.type !== "campaign"
    || current.generation !== 1 || !current.idempotencyKey.startsWith("workflow-control:")) {
    throw new WorkflowControlJobUnavailableError("identity-conflict");
  }
  if (["completed", "partial", "failed", "cancelled"].includes(current.status)) {
    if (current.status === update.status) return current;
    throw new WorkflowControlJobUnavailableError("terminal");
  }
  return EvolutionJobSchema.parse({
    ...current,
    status: update.status,
    attempts: Math.max(current.attempts, 1),
    progress: update.progress ?? current.progress,
    checkpointId: update.checkpointId ?? current.checkpointId,
    error: update.error,
    startedAt: current.startedAt ?? update.startedAt,
    finishedAt: update.finishedAt,
    heartbeatAt: at,
    updatedAt: at,
  });
}
