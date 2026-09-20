import { afterEach, describe, expect, it } from "vitest";
import { demoProject } from "../data/mock-project";
import type { EvolveProject } from "../schemas";
import {
  EVOLUTION_HARNESS_COMPONENTS,
  buildHarnessBudget,
  buildHarnessCheckpoint,
  inspectEvolutionHarness,
  routeHarnessFailure,
} from "./evolution-harness";

afterEach(() => localStorage.clear());

function project(patch: Partial<EvolveProject> = {}): EvolveProject {
  return { ...demoProject, ...patch } as EvolveProject;
}

describe("Evolution Harness", () => {
  it("wraps the domain decision with context, policy, tools, budget and checkpoint", () => {
    const plan = inspectEvolutionHarness(project({ inputUnderstanding: undefined, attentionRequests: [] }));
    expect(plan.version).toBe("evolution-harness-v1");
    expect(plan.decision.action).toBe("understand");
    expect(plan.context.totalArtifacts).toBeGreaterThan(0);
    expect(plan.context.usedChars).toBeLessThanOrEqual(plan.context.budgetChars);
    expect(plan.tools.map((tool) => tool.id)).toEqual(expect.arrayContaining(["context-builder", "model-router", "target-adapter", "evidence-runtime", "state-checkpoint"]));
    expect(plan.checkpoint.projectId).toBe(demoProject.id);
  });

  it("blocks a campaign step before it can exceed the configured budget", () => {
    const p = project({
      campaign: {
        ...demoProject.campaign,
        status: "idle",
        currentRound: 0,
        estimatedCost: 0.99,
        stopCriteria: { ...demoProject.campaign.stopCriteria, maxEstimatedCost: 1, stopWhenAcceptanceMet: false, stopWhenMetricTargetsMet: false },
      },
    });
    const budget = buildHarnessBudget(p, { action: "run-campaign", reason: "test", stage: "plan" });
    expect(budget.preflightStopReason).toContain("预算");
    expect(budget.exhausted).toBe(true);
  });

  it("routes transient failures to retry and capability gaps to acquire-capability", () => {
    expect(routeHarnessFailure(new Error("503 service unavailable")).action).toBe("retry");
    expect(routeHarnessFailure(new Error("Browser Runner 未连接")).action).toBe("acquire-capability");
    expect(routeHarnessFailure(new Error("生产发布权限不足")).action).toBe("request-human");
  });

  it("changes checkpoint identity when the mission state changes", () => {
    const first = buildHarnessCheckpoint(demoProject);
    const second = buildHarnessCheckpoint({ ...demoProject, stage: "validation", campaign: { ...demoProject.campaign, currentRound: demoProject.campaign.currentRound + 1 } });
    expect(second.id).not.toBe(first.id);
  });

  it("declares all Phase 1 harness responsibilities", () => {
    expect(EVOLUTION_HARNESS_COMPONENTS.map((item) => item.id)).toEqual(expect.arrayContaining([
      "mission-state", "context-builder", "planner-loop", "tool-router", "policy", "budget", "failure", "checkpoint", "observability",
    ]));
  });
});
