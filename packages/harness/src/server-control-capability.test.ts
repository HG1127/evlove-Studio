import { describe, expect, it } from "vitest";
import { serverControlCapabilityWaitPlan } from "./server-control-capability";
import type { ServerHarnessPlan } from "./server-plan";

const plan: ServerHarnessPlan = {
  decision: { action: "run-campaign", stage: "experiment", reason: "next round" },
  checkpoint: { id: "checkpoint-1", stage: "experiment", round: 2 },
  policy: { mode: "auto" },
  sourceRevision: "revision-1",
};
const args = { stage: "diagnosis" as const, reason: "provider unavailable", at: "2026-10-08T00:00:00.000Z" };

describe("server control capability wait", () => {
  it("preserves checkpoint and revision instead of advancing to the planned future stage", () => {
    const wait = serverControlCapabilityWaitPlan(plan, args);
    expect(wait.checkpoint).toEqual(plan.checkpoint);
    expect(wait.sourceRevision).toBe(plan.sourceRevision);
    expect(wait.decision).toMatchObject({ action: "wait-human", stage: "diagnosis" });
    expect(wait.policy.mode).toBe("human");
  });
  it("creates a blocking capability request without claiming product or evidence failure", () => {
    const wait = serverControlCapabilityWaitPlan(plan, args);
    expect(wait.decision.attention).toMatchObject({ type: "capability", status: "pending", blocking: true, questions: [], reason: args.reason });
    expect(wait.decision.attention?.suggestedAction).toContain("保留现有产物");
  });
  it("keeps retry identity stable and leaves its input unchanged", () => {
    const before = structuredClone(plan);
    const first = serverControlCapabilityWaitPlan(plan, args);
    const retry = serverControlCapabilityWaitPlan(plan, { ...args, at: "2026-10-09T00:00:00.000Z", reason: "another outage" });
    expect(first.decision.attention?.id).toBe(retry.decision.attention?.id);
    expect(plan).toEqual(before);
  });
});
