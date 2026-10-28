import { describe, expect, it } from "vitest";
import { BaselineRunSchema } from "./evolve-schemas";
import { CompletedBaselineFailureSchema, PlannedBaselineRefreshSchema } from "./planned-baseline-refresh-contract";

const at = "2026-10-28T01:00:00.000Z";
const ref = { schemaVersion: "original-artifact-reference-v1" as const, missionId: "m", sourceArtifactId: "s", blobId: "b", sha256: "a".repeat(64), sizeBytes: 42 };
const refreshing = () => ({ schemaVersion: "planned-baseline-refresh-v1", missionId: "m", round: 1, checkpointAt: at,
  sourceBaselineId: "baseline", measurementFingerprint: "measurement", planFingerprint: "plan", candidateIds: ["c"], paperHash: "paper",
  originalReferences: [ref], createdAt: at, attemptStartedAt: at, status: "refreshing" });

describe("planned Baseline refresh continuation", () => {
  it("round-trips a known failed attempt without implying a measured pass", () => {
    const receipt = PlannedBaselineRefreshSchema.parse({ ...refreshing(), status: "retryable", failedAt: at, failureKind: "judge" });
    const baseline = BaselineRunSchema.parse(JSON.parse(JSON.stringify({ id: "b2", status: "failed", suiteName: "Visible", totalCases: 1, plannedRefresh: receipt })));
    expect(baseline.plannedRefresh).toEqual(receipt);
    expect(baseline.result).toBeUndefined();
    expect(baseline.runs).toEqual([]);
  });
  it("keeps legacy Baseline records free of invented continuations", () => {
    const baseline = BaselineRunSchema.parse({ id: "b", status: "idle", suiteName: "Visible", totalCases: 1 });
    expect(baseline.plannedRefresh).toBeUndefined();
    expect(JSON.stringify(baseline)).not.toContain("plannedRefresh");
  });
  it("does not mistake transport failure or a gateway timeout for a completed request", () => {
    for (const error of [Error("unknown"), { code: "SERVER_AI_PROVIDER_TIMEOUT" }, { code: "SERVER_AI_PROVIDER_NETWORK_ERROR" },
      { code: "AI_OUTPUT_MISSING_FINAL" }, { httpStatus: 408 }, { httpStatus: 409 }, { httpStatus: 499 }, { httpStatus: 502 }, { httpStatus: 503 }, { httpStatus: 504 }])
      expect(CompletedBaselineFailureSchema.safeParse(error).success).toBe(false);
    expect(CompletedBaselineFailureSchema.safeParse({ httpStatus: 429 }).success).toBe(true);
    expect(CompletedBaselineFailureSchema.safeParse({ code: "AI_OUTPUT_INVALID_JSON" }).success).toBe(true);
    expect(CompletedBaselineFailureSchema.safeParse({ httpStatus: 429, code: "SERVER_AI_PROVIDER_TIMEOUT" }).success).toBe(false);
    expect(CompletedBaselineFailureSchema.safeParse(Object.assign(new DOMException("unknown", "AbortError"), { httpStatus: 429 })).success).toBe(false);
    expect(PlannedBaselineRefreshSchema.safeParse({ ...refreshing(), status: "unsettled", failedAt: at, failureKind: "judge" }).success).toBe(true);
  });
  it.each([
    { schemaVersion: "unsupported" }, { round: 0 }, { candidateIds: [] }, { candidateIds: ["c", "c"] },
    { planFingerprint: "" }, { status: "retryable" }, { status: "retryable", failedAt: at },
    { failedAt: at, failureKind: "judge" }, { attemptStartedAt: "2026-10-27T01:00:00.000Z" },
    { status: "retryable", failureKind: "judge", failedAt: "2026-10-27T01:00:00.000Z" },
    { originalReferences: [{ ...ref, missionId: "other" }] }, { originalReferences: [ref, ref] },
    { originalReferences: [{ ...ref, sha256: "not-a-digest" }] }, { independentFinalQuestions: ["must not be stored here"] },
  ])("rejects an invalid or ambiguous continuation %#", change => {
    expect(PlannedBaselineRefreshSchema.safeParse({ ...refreshing(), ...change }).success).toBe(false);
  });
});
