// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvolutionJobSchema, type EvolveProject, type EvolutionJob } from "@evolution/contracts";
import { demoProject } from "../data/mock-project";
import { loadServerFailedControlRetry, retryServerFailedControl, ServerFailedControlRetryUnavailableError } from "./server-failed-control-retry";
const m = vi.hoisted(() => ({ mode: vi.fn(), list: vi.fn(), put: vi.fn(), cancel: vi.fn(), save: vi.fn(), fetch: vi.fn() }));
vi.mock("./production-runtime", () => ({
  productionRuntimeMode: m.mode,
  getProductionRuntime: () => ({ jobs: { list: m.list, put: m.put, cancel: m.cancel }, missions: { save: m.save } }),
}));
const at = "2026-10-12T03:00:00.000Z";
const target = { missionId: "mission", jobId: "control-old", runId: "run-old" };
const receipt = { missionId: "mission", controlJobId: "control-new", runId: "run-new", status: "queued" };
function project(): EvolveProject {
  return { ...structuredClone(demoProject), id: "mission", updatedAt: at, stage: "plan", campaign: { ...structuredClone(demoProject.campaign), status: "running" } };
}
function control(overrides: Partial<EvolutionJob> = {}) {
  return EvolutionJobSchema.parse({ schemaVersion: "job-v1", id: target.jobId, missionId: target.missionId,
    type: "campaign", status: "running", label: "Evolution Workflow Control", generation: 1,
    idempotencyKey: "workflow-control:mission:original", outputRef: target.runId, metadata: { runId: target.runId },
    createdAt: at, updatedAt: at, ...overrides });
}
function status(sdkStatus: string | undefined = "failed", job: EvolutionJob | undefined = control(), exists = true) {
  return { workflow: { exists, ...(sdkStatus ? { status: sdkStatus } : {}) }, ...(job ? { job } : {}), events: [] };
}
const json = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code });
beforeEach(() => {
  m.mode.mockReset().mockReturnValue("http"); m.list.mockReset().mockResolvedValue([control()]);
  m.put.mockReset(); m.cancel.mockReset(); m.save.mockReset();
  m.fetch.mockReset().mockImplementation(async (url: RequestInfo | URL) =>
    String(url).startsWith("/api/evolution/status?") ? json(status()) : json(receipt));
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => vi.unstubAllGlobals());
describe("explicit retry of a bound failed backend control", () => {
  it.each(["failed", "cancelled"])("reads actual Job and SDK %s without editing stored running state", async state => {
    const p = project(), snapshot = structuredClone(p);
    m.fetch.mockResolvedValue(json(status(state)));
    expect(await loadServerFailedControlRetry(p)).toEqual(target);
    expect(m.list).toHaveBeenCalledExactlyOnceWith(p.id);
    expect(m.fetch).toHaveBeenCalledExactlyOnceWith("/api/evolution/status?runId=run-old&jobId=control-old", undefined);
    expect(p).toEqual(snapshot); expect(m.put).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
  });
  it.each(["pending", "running", "completed", "unknown", undefined])("does not offer a retry for SDK status %s", async state => {
    m.fetch.mockResolvedValue(json(state === undefined ? { workflow: { exists: true }, job: control(), events: [] } : status(state)));
    expect(await loadServerFailedControlRetry(project())).toBeUndefined();
    expect(m.fetch.mock.calls.every(call => String(call[0]).startsWith("/api/evolution/status?"))).toBe(true);
  });
  it("does not offer a retry for missing SDK metadata or a missing Job", async () => {
    m.fetch.mockResolvedValueOnce(json(status("failed", control(), false))).mockResolvedValueOnce(json({ workflow: { exists: true, status: "failed" }, events: [] }));
    expect(await loadServerFailedControlRetry(project())).toBeUndefined();
    expect(await loadServerFailedControlRetry(project())).toBeUndefined();
  });
  it("selects the newest control and never falls back to an older failure", async () => {
    const newer = control({ id: "control-latest", createdAt: "2026-10-12T03:01:00.000Z", outputRef: "run-latest", metadata: { runId: "run-latest" } });
    m.list.mockResolvedValue([control(), newer]); m.fetch.mockResolvedValue(json(status("running", newer)));
    expect(await loadServerFailedControlRetry(project())).toBeUndefined();
    expect(m.fetch).toHaveBeenCalledExactlyOnceWith("/api/evolution/status?runId=run-latest&jobId=control-latest", undefined);
    m.list.mockResolvedValue([control(), { ...newer, outputRef: undefined, metadata: {} }]); m.fetch.mockClear();
    expect(await loadServerFailedControlRetry(project())).toBeUndefined(); expect(m.fetch).not.toHaveBeenCalled();
  });
  it("rechecks the selected bound Run before issuing a versioned retry", async () => {
    const p = project(), snapshot = structuredClone(p);
    const selected = await loadServerFailedControlRetry(p);
    expect(await retryServerFailedControl(p, selected!)).toEqual(receipt);
    const wire = JSON.stringify(["server-failed-control-retry-v1", p.id, p.updatedAt, target.jobId, target.runId]);
    expect(m.fetch.mock.calls.map(call => String(call[0]))).toEqual([
      "/api/evolution/status?runId=run-old&jobId=control-old", "/api/evolution/status?runId=run-old&jobId=control-old", "/api/evolution/start",
    ]);
    expect(JSON.parse(String(m.fetch.mock.calls[2]![1].body))).toEqual({ missionId: p.id, intent: "retry-failed-control",
      retryOfControlJobId: target.jobId, retryOfRunId: target.runId, expectedMissionUpdatedAt: p.updatedAt,
      idempotencyKey: "server-failed-control-retry:" + createHash("sha256").update(wire).digest("hex") });
    expect(p).toEqual(snapshot); expect(m.put).not.toHaveBeenCalled(); expect(m.cancel).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
  });
  it("does not start when the Run has become active since the button was displayed", async () => {
    const p = project(); expect(await loadServerFailedControlRetry(p)).toEqual(target);
    m.fetch.mockResolvedValue(json(status("running")));
    await expect(retryServerFailedControl(p, target)).rejects.toThrow("状态已变化");
    expect(m.fetch.mock.calls.some(call => call[0] === "/api/evolution/start")).toBe(false);
  });
  it("marks a failed preflight metadata read unavailable before any start request", async () => {
    m.fetch.mockResolvedValue(json({ error: "无法读取后台状态" }, 503));
    await expect(retryServerFailedControl(project(), target)).rejects.toBeInstanceOf(ServerFailedControlRetryUnavailableError);
    expect(m.fetch.mock.calls.some(call => call[0] === "/api/evolution/start")).toBe(false);
  });
  it("keeps exactly the same operation after a lost start acknowledgement", async () => {
    const p = project(); let attempt = 0;
    m.fetch.mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url).startsWith("/api/evolution/status?")) return json(status());
      if (++attempt === 1) throw new Error("connection lost");
      return json({ ...receipt, reused: true });
    });
    await expect(retryServerFailedControl(p, target)).rejects.toThrow("connection lost");
    expect((await retryServerFailedControl(structuredClone(p), target)).reused).toBe(true);
    const posts = m.fetch.mock.calls.filter(call => call[0] === "/api/evolution/start");
    expect(posts).toHaveLength(2); expect(posts[0]![1].body).toBe(posts[1]![1].body);
  });
  it("changes the operation key only with the persisted Mission version", async () => {
    const p = project(); await retryServerFailedControl(p, target);
    await retryServerFailedControl({ ...p, updatedAt: "2026-10-12T03:02:00.000Z" }, target);
    const posts = m.fetch.mock.calls.filter(call => call[0] === "/api/evolution/start");
    expect(JSON.parse(String(posts[0]![1].body)).idempotencyKey).not.toBe(JSON.parse(String(posts[1]![1].body)).idempotencyKey);
  });
  it("keeps the reserved operation version after Mission CAS advances its timestamp", async () => {
    const p = { ...project(), updatedAt: "2026-10-12T03:02:00.000Z" };
    const reservedTarget = { ...target, sourceUpdatedAt: at };
    const snapshot = structuredClone(p);
    await retryServerFailedControl(p, reservedTarget);
    await retryServerFailedControl({ ...p, updatedAt: "2026-10-12T03:03:00.000Z" }, reservedTarget);
    const posts = m.fetch.mock.calls.filter(call => call[0] === "/api/evolution/start");
    const expectedWire = JSON.stringify(["server-failed-control-retry-v1", p.id, at, target.jobId, target.runId]);
    const requests = posts.map(call => JSON.parse(String(call[1].body)));
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0].expectedMissionUpdatedAt).toBe(at);
    expect(requests[0].idempotencyKey).toBe("server-failed-control-retry:" + createHash("sha256").update(expectedWire).digest("hex"));
    expect(p).toEqual(snapshot); expect(m.save).not.toHaveBeenCalled(); expect(m.put).not.toHaveBeenCalled();
  });
  it.each([401, 409, 503])("preserves an HTTP %s rejection and never calls local write ports", async code => {
    m.fetch.mockImplementation(async (url: RequestInfo | URL) => String(url).startsWith("/api/evolution/status?") ? json(status()) : json({ error: "后台请求被拒绝" }, code));
    await expect(retryServerFailedControl(project(), target)).rejects.toThrow("后台请求被拒绝");
    expect(m.put).not.toHaveBeenCalled(); expect(m.cancel).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
  });
  it.each([{ missionId: "foreign" }, { controlJobId: target.jobId }, { runId: target.runId }])("rejects a foreign or old failed receipt %j", async change => {
    m.fetch.mockImplementation(async (url: RequestInfo | URL) => String(url).startsWith("/api/evolution/status?") ? json(status()) : json({ ...receipt, ...change }));
    await expect(retryServerFailedControl(project(), target)).rejects.toThrow(/identity mismatch|new control Job and Run/);
  });
  it("does not read or restart background controls in local mode", async () => {
    m.mode.mockReturnValue("local");
    expect(await loadServerFailedControlRetry(project())).toBeUndefined();
    await expect(retryServerFailedControl(project(), target)).rejects.toThrow("未连接后台");
    expect(m.list).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled();
  });
});
