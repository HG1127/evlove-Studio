import { describe, expect, it } from "vitest";
import type { EvolveProject } from "../schemas";
import { demoProject } from "../data/mock-project";
import { createHarnessActionExecutor, type HarnessActionHandlers } from "@evolution/harness";
import { inspectEvolutionHarness, type HarnessPlan } from "./evolution-harness";
import type { EvolutionEvent } from "./event-contract";
import type { EvolutionJob } from "./job-contract";
import type { ProductionRuntimePorts } from "./production-ports";

function memoryPorts(events: EvolutionEvent[], jobs: EvolutionJob[]): ProductionRuntimePorts {
  return {
    missions: {
      initialize: async () => undefined,
      list: async () => [],
      get: async () => undefined,
      save: async () => undefined,
      delete: async () => undefined,
      flush: async () => undefined,
    },
    jobs: {
      list: async () => jobs,
      get: async (id) => jobs.find((job) => job.id === id),
      put: async (job) => { const index=jobs.findIndex((item)=>item.id===job.id); if(index>=0)jobs[index]=job; else jobs.push(job); },
      cancel: async () => undefined,
    },
    events: {
      append: async (event) => { events.push(event); },
      list: async () => events,
    },
    artifacts: {
      put: async () => undefined,
      get: async () => undefined,
      delete: async () => undefined,
    },
  };
}

function handlers(run: HarnessActionHandlers<HarnessPlan>["understand"]): HarnessActionHandlers<HarnessPlan> {
  const noop = async () => ({ control: "continue" as const });
  return {
    understand: run,
    "adopt-defaults": noop,
    "compile-contract": noop,
    "approve-contract": noop,
    "build-eval": noop,
    revalidate: noop,
    "run-campaign": noop,
    "run-release": noop,
    "reconcile-release": noop,
    package: noop,
    distill: noop,
    "next-queue": noop,
    complete: noop,
    "wait-human": noop,
  };
}

describe("harness action executor", () => {
  it("records a unified job plus planned/checkpoint/action lifecycle events", async () => {
    const events: EvolutionEvent[] = [];
    const jobs: EvolutionJob[] = [];
    const runtime = memoryPorts(events,jobs);
    const project = { ...demoProject, inputUnderstanding: undefined, attentionRequests: [] } as EvolveProject;
    const plan = inspectEvolutionHarness(project);
    const executor = createHarnessActionExecutor<HarnessPlan>(project.id, handlers(async () => ({ control: "continue" })), runtime);
    await executor.execute(plan);
    expect(events.map((event) => event.type)).toEqual(["ActionPlanned","CheckpointCreated","JobStarted","ActionStarted","ActionCompleted","JobCompleted"]);
    expect(events[0]?.checkpointId).toBe(plan.checkpoint.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({schemaVersion:"job-v1",missionId:project.id,type:"mission-action",status:"completed",checkpointId:plan.checkpoint.id,attempts:1});
  });

  it("marks the unified job failed and emits failure evidence", async () => {
    const events: EvolutionEvent[] = [];
    const jobs: EvolutionJob[] = [];
    const runtime = memoryPorts(events,jobs);
    const project = { ...demoProject, inputUnderstanding: undefined, attentionRequests: [] } as EvolveProject;
    const plan = inspectEvolutionHarness(project);
    const executor = createHarnessActionExecutor<HarnessPlan>(project.id, handlers(async () => { throw new Error("boom"); }), runtime);
    await expect(executor.execute(plan)).rejects.toThrow("boom");
    expect(events.map((event) => event.type)).toEqual(["ActionPlanned","CheckpointCreated","JobStarted","ActionStarted","ActionFailed","JobFailed"]);
    expect(jobs[0]).toMatchObject({status:"failed",error:"boom"});
  });
});
