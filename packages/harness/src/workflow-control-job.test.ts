import { describe, expect, it } from "vitest";
import { EvolutionJobSchema, type EvolutionJob } from "@evolution/contracts";
import { buildWorkflowControlJobUpdate, WorkflowControlJobUnavailableError } from "./workflow-control-job";
const at = "2026-10-08T00:00:00.000Z";
const later = "2026-10-08T00:01:00.000Z";
const input = { missionId: "mission", controlJobId: "control", requestedAt: later };
const job = EvolutionJobSchema.parse({ schemaVersion: "job-v1", id: "control", missionId: "mission", type: "campaign", status: "queued", label: "Original control request", idempotencyKey: "workflow-control:mission:request", generation: 1, attempts: 3, priority: 13, createdAt: at, updatedAt: at, inputRef: "original-input", outputRef: "run-original", metadata: { runId: "run-original", extra: true }, checkpointId: "original-checkpoint", startedAt: at });

describe("immutable Workflow Control Job identity", () => {
  it("retains request identity, bindings and counters while updating execution fields", () => {
    const before = structuredClone(job);
    const next = buildWorkflowControlJobUpdate(job, input, { status: "running", startedAt: later, progress: { percent: 40, detail: "continue" } }, later);
    expect(next).toEqual({ ...job, status: "running", progress: { percent: 40, detail: "continue" }, heartbeatAt: later, updatedAt: later });
    expect(next.idempotencyKey).toBe("workflow-control:mission:request");
    expect(next.metadata).toEqual(job.metadata);
    expect(next.createdAt).toBe(at); expect(next.startedAt).toBe(at); expect(next.attempts).toBe(3);
    expect(job).toEqual(before);
  });
  it("preserves old Workflow inputs without requiring a new request-key field", () => {
    const next = buildWorkflowControlJobUpdate({ ...job, startedAt: undefined, attempts: 0 }, input, { status: "waiting", startedAt: later, checkpointId: "next-checkpoint" }, later);
    expect(next).toMatchObject({ idempotencyKey: job.idempotencyKey, attempts: 1, startedAt: later, checkpointId: "next-checkpoint", outputRef: "run-original" });
  });
  it("retains the same identity across waiting, continued execution and completion", () => {
    let current = job;
    for (const status of ["running", "waiting", "running", "completed"] as const) {
      current = buildWorkflowControlJobUpdate(current, input, { status, ...(status === "completed" ? { finishedAt: later } : {}) }, later);
      expect(current.idempotencyKey).toBe(job.idempotencyKey); expect(current.outputRef).toBe(job.outputRef); expect(current.generation).toBe(1);
    }
    expect(current.finishedAt).toBe(later);
    expect(buildWorkflowControlJobUpdate(current, input, { status: "completed", finishedAt: "another-time" }, "another-time")).toBe(current);
  });
  it.each(["completed", "partial", "failed", "cancelled"])("does not reopen a %s Job", (status) => {
    expect(() => buildWorkflowControlJobUpdate({ ...job, status: status as EvolutionJob["status"] }, input, { status: "running" }, later)).toThrow(WorkflowControlJobUnavailableError);
  });
  it.each([undefined, { ...job, id: "other" }, { ...job, missionId: "other" }, { ...job, generation: 2 }, { ...job, type: "parse" as const }, { ...job, idempotencyKey: "foreign-request" }])("rejects missing/replaced identities", (current) => {
    expect(() => buildWorkflowControlJobUpdate(current, input, { status: "waiting" }, later)).toThrow(WorkflowControlJobUnavailableError);
  });
});
