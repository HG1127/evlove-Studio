// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockEvent, readRawBody } from "nitro/h3";
import { EvolutionJobSchema, type EvolutionJob } from "@evolution/contracts";
import { startServerParseFile } from "../../../../src/features/evolve/runtime/server-source-client";
import route from "../../server/api/evolution/parse-start.post";
import evolutionSecurity from "../../server/middleware/evolution-security";
const m = vi.hoisted(() => ({ blobs: new Map<string, Blob>(), job: undefined as EvolutionJob | undefined, put: vi.fn(), jobPut: vi.fn(), start: vi.fn(), getRun: vi.fn() }));
vi.mock("workflow/api", () => ({ start: m.start, getRun: m.getRun }));
vi.mock("../../../../workflows/source-parse", () => ({ sourceParseWorkflow: vi.fn() }));
vi.mock("./security-policy", () => ({ requireGovernedEvolutionPermission: async () => undefined, requireEvolutionPermission: () => undefined }));
vi.mock("../server-env", async original => ({ ...await original<typeof import("../server-env")>(), serverSupabaseSecureConfigured: () => true }));
vi.mock("./artifact-runtime", () => ({ getServerArtifactStore: () => ({ get: async (id: string) => m.blobs.get(id), put: m.put }) }));
vi.mock("./production-runtime", async original => ({ ...await original<typeof import("./production-runtime")>(),
  getServerJobByIdempotencyKey: async (key: string) => m.job?.idempotencyKey === key ? m.job : undefined,
  getServerProductionRuntime: () => ({ jobs: { get: async () => m.job, put: m.jobPut } }),
  bindServerJobWorkflowRun: async (_id: string, _generation: number, runId: string) => m.job = EvolutionJobSchema.parse({ ...m.job!, metadata: { ...m.job!.metadata, runId } }),
}));
beforeEach(() => {
  m.blobs.clear(); m.job = undefined;
  m.put.mockReset().mockImplementation(async (id: string, blob: Blob) => { m.blobs.set(id, blob); });
  m.jobPut.mockReset().mockImplementation(async (j: EvolutionJob) => { m.job = j; });
  m.start.mockReset().mockResolvedValue({ runId: "parse-run" }); m.getRun.mockReset();
  vi.unstubAllGlobals();
});
afterEach(() => vi.unstubAllGlobals());
function form(role = "target") {
  const f = new FormData(); f.append("file", new File(["原始证据\nsynthetic exact bytes"], "source.txt", { type: "text/plain", lastModified: 1 }));
  f.append("role", role); f.append("artifactId", "source"); f.append("lastModified", "1"); return f;
}
describe("actual multipart intake with capped Request body", () => {
  it("reads a real FormData upload, stores exact bytes, and binds one idempotent parse run", async () => {
    const fetch = vi.fn(async (path: string, init: RequestInit) => {
      const event = mockEvent(new Request("http://localhost" + path, init));
      await evolutionSecurity(event);
      return new Response(JSON.stringify(await route(event)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const file = form().get("file") as File;
    const first = await startServerParseFile(file, "target", "source");
    const second = await startServerParseFile(file, "target", "source");
    expect(first).toMatchObject({ artifactId: "source", runId: "parse-run", status: "queued" });
    expect(second).toMatchObject({ jobId: first.jobId, reused: true });
    expect(m.put).toHaveBeenCalledOnce(); expect(m.start).toHaveBeenCalledOnce();
    const bytes = Buffer.from(await m.blobs.get(m.job!.inputRef!)!.arrayBuffer());
    expect(bytes.equals(Buffer.from(await file.arrayBuffer()))).toBe(true);
    expect(m.job!.metadata?.contentSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(m.start.mock.calls[0]![1][0]).toMatchObject({ contentSha256: m.job!.metadata?.contentSha256, size: bytes.length });
  });
  it("returns 400 for malformed multipart without leaking bytes or writing a Job", async () => {
    const event = mockEvent(new Request("http://localhost/api/evolution/parse-start", { method: "POST", headers: { "content-type": "application/json" }, body: "private malformed content" }));
    const error = await route(event).catch(e => e);
    expect(error).toMatchObject({ status: 400 }); expect(JSON.stringify(error)).not.toContain("private malformed content");
    expect(m.put).not.toHaveBeenCalled(); expect(m.jobPut).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
  });
  it.each([25, 27, 33])("retains file and route limits for an unknown-length %s MiB upload", async mib => {
    const prefix = new TextEncoder().encode('--limit-test\r\nContent-Disposition: form-data; name="file"; filename="large.txt"\r\nContent-Type: text/plain\r\n\r\n');
    let emitted = -1;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (emitted === -1) controller.enqueue(prefix);
      else if (emitted < mib) controller.enqueue(new Uint8Array(1024 * 1024 + (mib === 25 ? 1 : 0)));
      else { controller.enqueue(new TextEncoder().encode('\r\n--limit-test--\r\n')); controller.close(); }
      emitted++;
    } });
    const event = mockEvent(new Request("http://localhost/api/evolution/parse-start", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=limit-test" }, body, duplex: "half" } as RequestInit & { duplex: "half" }));
    await evolutionSecurity(event);
    await expect(route(event)).rejects.toMatchObject({ status: 413 });
    expect(m.put).not.toHaveBeenCalled(); expect(m.jobPut).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
  });
  it("retains the global middleware cap for unknown-length bodies", async () => {
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (emitted++ < 33) controller.enqueue(new Uint8Array(1024 * 1024)); else controller.close();
    } });
    const event = mockEvent(new Request("http://localhost/api/evolution/git-webhook", { method: "POST", body, duplex: "half" } as RequestInit & { duplex: "half" }));
    await evolutionSecurity(event);
    await expect(readRawBody(event, false)).rejects.toMatchObject({ status: 413 });
    expect(m.put).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
  });
  it("rejects invalid role after actual multipart parsing and before any writes", async () => {
    await expect(route(mockEvent(new Request("http://localhost/api/evolution/parse-start", { method: "POST", body: form("invalid") })))).rejects.toMatchObject({ status: 400 });
    expect(m.put).not.toHaveBeenCalled(); expect(m.jobPut).not.toHaveBeenCalled(); expect(m.start).not.toHaveBeenCalled();
  });
});
