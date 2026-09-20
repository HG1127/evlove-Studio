import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginEvidenceJob,
  clearEvidenceJobs,
  ensureEvidenceJob,
  evidenceJobOutcome,
  finishEvidenceJob,
  getEvidenceJob,
  retryEvidenceJob,
} from "./evidence-job-store";

afterEach(async () => {
  await clearEvidenceJobs("p");
  vi.unstubAllGlobals();
});

describe("evidence job store", () => {
  it("prevents a stale generation from overwriting a newer retry", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const job = await ensureEvidenceJob({ projectId: "p", kind: "e2e", scope: "case-1", label: "E2E", fingerprint: "v1" });
    const first = await beginEvidenceJob(job.id);
    await retryEvidenceJob(job.id);
    const second = await beginEvidenceJob(job.id);
    expect(first?.generation).toBe(1);
    expect(second?.generation).toBe(2);
    expect(await finishEvidenceJob(job.id, first!.generation, { status: "ready", summary: "old" })).toBe(false);
    expect(await finishEvidenceJob(job.id, second!.generation, { status: "ready", summary: "new" })).toBe(true);
    expect((await getEvidenceJob(job.id))?.summary).toBe("new");
  });

  it("maps runner verification truthfully", () => {
    expect(evidenceJobOutcome({ testCaseId: "a", output: "ok", latencyMs: 1, cost: 0, trace: [], verificationStatus: "verified" }).status).toBe("ready");
    expect(evidenceJobOutcome({ testCaseId: "a", output: "partial", latencyMs: 1, cost: 0, trace: [], verificationStatus: "partial" }).status).toBe("partial");
    expect(evidenceJobOutcome({ testCaseId: "a", output: "missing", latencyMs: 1, cost: 0, trace: [], verificationStatus: "unverified" }).status).toBe("unavailable");
    expect(evidenceJobOutcome({ testCaseId: "a", output: "bad", latencyMs: 1, cost: 0, trace: [], verificationStatus: "failed" }).status).toBe("failed");
  });
});
