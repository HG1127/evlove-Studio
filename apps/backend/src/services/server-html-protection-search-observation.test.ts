// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlProtectionSearchStateRegistrationSchema, HtmlProtectionSearchStateRequestSchema, HtmlProtectionSnapshotRequestSchema, type EvolveProject, type TestCase } from "@evolution/contracts";
const mocked = vi.hoisted(() => ({ observe: vi.fn(), create: vi.fn(), prepare: vi.fn() }));
vi.mock("@evolution/adapters/sandbox", async original => ({ ...await original<typeof import("@evolution/adapters/sandbox")>(),
  runVercelSandboxHtmlProtectionSearchObservation: mocked.observe, createVercelSandboxHtmlProtectionBrowser: mocked.create }));
vi.mock("./server-html-protection-collection-plan", () => ({ prepareServerHtmlProtectionCollectionPlan: mocked.prepare }));
import { createServerHtmlProtectionSearchObserver, collectServerHtmlProtectionSearchPair } from "./server-html-protection-search-observation";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const text = "synthetic fixed deployment runtime", runtime = { version: "html-protection-private-cloud-v1" as const, text, sha256: sha(text), byteLength: Buffer.byteLength(text) };
function input() {
  const physicalHtml = Buffer.from('<input id="search"><output id="count">0</output>'), artifact = { sourceArtifactId: "source", sha256: sha(physicalHtml), byteLength: physicalHtml.byteLength };
  const registry = { schemaVersion: "html-protection-snapshot-registry-v1", projection: "search-membership-v1", originalSha256: artifact.sha256,
    targetId: "search", inputSelector: "#search", countSelector: "#count", cardSelector: ".card", chapterSelector: ".chapter" };
  const registration = HtmlProtectionSearchStateRegistrationSchema.parse({ schemaVersion: "html-protection-search-state-registration-v1", original: artifact,
    registry, registrySha256: "c".repeat(64), policyVersion: "policy", planSha256: "a".repeat(64),
    input: { id: "search", tag: "INPUT", namespace: "http://www.w3.org/1999/xhtml", type: "text", initialValue: "" },
    states: [{ stateKind: "boot", stateId: "boot" }, { stateKind: "query-positive", stateId: "positive", value: "needle" },
      { stateKind: "query-negative", stateId: "negative", value: "absent" }, { stateKind: "clear", stateId: "clear", value: "" }] });
  const common = { binding: { missionId: "mission", testCaseId: "same-paper", criterionId: "protect", paperSha256: "b".repeat(64), original: artifact,
    executed: artifact, subject: { kind: "current", versionId: "v1" } }, sourceRole: "original", policyVersion: registration.policyVersion,
    planSha256: registration.planSha256, registrySha256: registration.registrySha256, execution: { executionId: "execution", jobId: "job", generation: 1 }, batchId: "search" };
  const stateRequests = registration.states.map(state => HtmlProtectionSearchStateRequestSchema.parse({ ...common, schemaVersion: "html-protection-search-state-request-v1", stateId: state.stateId, stateKind: state.stateKind }));
  const snapshotRequests = registration.states.map(state => HtmlProtectionSnapshotRequestSchema.parse({ ...common, schemaVersion: "html-protection-snapshot-request-v1", stateId: state.stateId, registry, documentUrl: "http://127.0.0.1:4173/index.html" }));
  return { registration, stateRequests, snapshotRequests, physicalHtml };
}
beforeEach(() => { mocked.observe.mockReset().mockResolvedValue({ availability: "unavailable", reason: "synthetic-only" }); mocked.create.mockReset(); mocked.prepare.mockReset(); });
describe("owned deployment consecutive-search composition", () => {
  it("uses only the fixed generated runtime and owned factory", async () => {
    const args = input(); await createServerHtmlProtectionSearchObserver({ loadOwnedRuntime: async () => runtime })(args);
    expect(mocked.observe).toHaveBeenCalledExactlyOnceWith(args, { trustedRuntimeBinding: { version: runtime.version, sha256: runtime.sha256, byteLength: runtime.byteLength },
      trustedRuntimeBytes: Buffer.from(text), createPreparedBrowserSandbox: mocked.create }); expect(mocked.create).not.toHaveBeenCalled();
  });
  it("owns all physical bytes, registration and requests before asynchronous module loading", async () => {
    const args = input(), original = input();
    await createServerHtmlProtectionSearchObserver({ loadOwnedRuntime: async () => { args.physicalHtml.fill(0); args.registration.states[1].value = "changed"; args.stateRequests[0]!.execution.generation = 99; return runtime; } })(args);
    expect(mocked.observe.mock.calls[0]?.[0]).toEqual(original);
  });
  it.each([undefined, { ...runtime, env: { KEY: "must-not-enter" } }, { ...runtime, version: "invalid" }, { ...runtime, sha256: "invalid" }])("refuses invalid generated modules without a VM", async value => {
    expect(await createServerHtmlProtectionSearchObserver({ loadOwnedRuntime: async () => value as typeof runtime })(input())).toMatchObject({ availability: "unavailable", reason: "missing-trusted-runtime" });
    expect(mocked.observe).not.toHaveBeenCalled(); expect(mocked.create).not.toHaveBeenCalled();
  });
  it("rejects an extra external action field before loading any deployment module", async () => {
    const args = input(), load = vi.fn().mockResolvedValue(runtime); Object.assign(args.stateRequests[0]!, { script: "untrusted" });
    await expect(createServerHtmlProtectionSearchObserver({ loadOwnedRuntime: load })(args)).rejects.toThrow();
    expect(load).not.toHaveBeenCalled(); expect(mocked.observe).not.toHaveBeenCalled();
  });
  it("pairs exact Original/executed bytes and closed requests under the same preparation", async () => {
    const source = input(), executed = Buffer.from("synthetic changed physical artifact");
    mocked.prepare.mockResolvedValue({ binding: source.snapshotRequests[0]!.binding, planSha256: source.registration.planSha256, searchRegistration: source.registration,
      searchRequests: [...source.stateRequests, ...source.stateRequests.map(request => ({ ...request, sourceRole: "executed" }))], physicalInputs: { original: source.physicalHtml, executed } });
    const observe = vi.fn().mockResolvedValue({ availability: "unavailable", reason: "synthetic-only" });
    const result = await collectServerHtmlProtectionSearchPair({ project: {} as EvolveProject, testCase: {} as TestCase, criterionId: "protect", execution: { executionId: "execution", jobId: "job", generation: 1 } }, observe);
    expect(observe).toHaveBeenCalledTimes(2); expect(observe.mock.calls[0]?.[0].physicalHtml).toEqual(source.physicalHtml); expect(observe.mock.calls[1]?.[0].physicalHtml).toEqual(executed);
    expect(observe.mock.calls[0]?.[0].stateRequests.map((request: { sourceRole: string }) => request.sourceRole)).toEqual(["original", "original", "original", "original"]);
    expect(observe.mock.calls[1]?.[0].snapshotRequests.map((request: { sourceRole: string }) => request.sourceRole)).toEqual(["executed", "executed", "executed", "executed"]);
    expect(result).not.toHaveProperty("proof"); expect(result).not.toHaveProperty("passed");
  });
});