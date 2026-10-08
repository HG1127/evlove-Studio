// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockEvent } from "nitro/h3";
import { EvolutionJobSchema, type EvolutionJob, type EvolveProject, type EvolutionWorkflowStartResponse, type EvolutionEvent } from "@evolution/contracts";
import type { ServerHarnessPlan } from "@evolution/harness";
import { demoProject } from "../../../../src/features/evolve/data/mock-project";
import route from "../../server/api/evolution/start.post";
import { initializeWorkflowControlStep, executeServerControlStep } from "../../../../workflows/evolution-mission/steps";

const mocks = vi.hoisted(() => ({ jobs: new Map<string, EvolutionJob>(), events: new Map<string, EvolutionEvent>(), start: vi.fn(), create: vi.fn(), bind: vi.fn(), runtime: vi.fn() }));
vi.mock("workflow/api", () => ({ start: mocks.start, getRun: vi.fn() }));
vi.mock("../../../../workflows/evolution-mission", () => ({ evolutionMissionWorkflow: vi.fn() }));
vi.mock("./security-policy", () => ({ requireGovernedEvolutionPermission: vi.fn(async () => undefined) }));
vi.mock("./production-runtime", async (original) => ({ ...await original<typeof import("./production-runtime")>(),
  getServerProductionRuntime: mocks.runtime, createServerJobIdempotentReceipt: mocks.create, bindServerJobWorkflowRun: mocks.bind,
}));
let mission: EvolveProject;
const key = "workflow-control:identity-mission:request-one";
function request() {
  return mockEvent(new Request("http://localhost/api/evolution/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ missionId: mission.id, idempotencyKey: "request-one" }) }));
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.jobs.clear(); mocks.events.clear(); vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(new Date("2026-10-08T00:00:00Z")); mission = { ...structuredClone(demoProject), id: "identity-mission" };
  mocks.runtime.mockReturnValue({ missions: { get: async () => mission, save: async (value: EvolveProject) => { mission = value; } }, jobs: {
    get: async (id: string) => mocks.jobs.get(id),
    // Model the deployed monotonic RPC's key update and same-generation run-binding retention.
    put: async (value: EvolutionJob) => { const previous = mocks.jobs.get(value.id); mocks.jobs.set(value.id, EvolutionJobSchema.parse({ ...value, outputRef: value.outputRef ?? previous?.outputRef, metadata: { ...previous?.metadata, ...value.metadata } })); },
  }, events: { append: async (event: EvolutionEvent) => {
    const existing=mocks.events.get(event.id);
    if(existing && JSON.stringify(existing)!==JSON.stringify(event))throw new Error("Event identity changed on replay");
    mocks.events.set(event.id,event);
  } } });
  mocks.create.mockImplementation(async (value: EvolutionJob) => {
    const previous = [...mocks.jobs.values()].find((job) => job.idempotencyKey === value.idempotencyKey);
    if (previous) return { job: previous, reused: true };
    mocks.jobs.set(value.id, value); return { job: value, reused: false };
  });
  mocks.start.mockImplementation(async () => ({ runId: `run-${mocks.start.mock.calls.length}` }));
  mocks.bind.mockImplementation(async (id: string, generation: number, runId: string) => {
    const saved = EvolutionJobSchema.parse({ ...mocks.jobs.get(id), generation, outputRef: runId }); mocks.jobs.set(id, saved); return saved;
  });
});
async function startRequest() { return await route(request()) as EvolutionWorkflowStartResponse; }
afterEach(()=>vi.useRealTimers());
function startedInput() { return mocks.start.mock.calls[0][1][0]; }

describe("start -> control writes -> same-request retry", () => {
  it("reuses the original request before control initialization", async () => {
    const first = await startRequest(); const repeated = await startRequest();
    expect(repeated).toMatchObject({ controlJobId: first.controlJobId, runId: first.runId, reused: true });
    expect(mocks.start).toHaveBeenCalledOnce();
  });
  it("retains the start request identity after initialization", async () => {
    const first = await startRequest(); await initializeWorkflowControlStep(startedInput());
    expect(mocks.jobs.get(first.controlJobId!)?.idempotencyKey).toBe(key);
    const repeated = await startRequest();
    expect(repeated).toMatchObject({ controlJobId: first.controlJobId, runId: first.runId, reused: true });
    expect(mocks.start).toHaveBeenCalledOnce();
  });
  it("replays initialization without changing the original JobStarted evidence", async () => {
    await startRequest();await initializeWorkflowControlStep(startedInput());
    const original=[...mocks.events.values()][0];
    vi.setSystemTime(new Date("2026-10-08T00:01:00Z"));
    await initializeWorkflowControlStep(startedInput());
    expect([...mocks.events.values()]).toEqual([original]);
    expect(mocks.start).toHaveBeenCalledOnce();
  });
  it("retains it after a persisted attention wait without starting another run", async () => {
    const first = await startRequest(); await initializeWorkflowControlStep(startedInput());
    const plan: ServerHarnessPlan = { decision: { action: "wait-human", stage: mission.stage, reason: "approval pending" }, checkpoint: { id: "server-checkpoint-test", stage: mission.stage, round: 1 }, policy: { mode: "human" }, sourceRevision: "revision" };
    await executeServerControlStep(startedInput(), plan, 0);
    expect(mocks.jobs.get(first.controlJobId!)).toMatchObject({ status: "waiting", idempotencyKey: key, outputRef: first.runId });
    const repeated = await startRequest();
    expect(repeated).toMatchObject({ controlJobId: first.controlJobId, runId: first.runId, reused: true });
    expect(mocks.start).toHaveBeenCalledOnce();
  });
});
