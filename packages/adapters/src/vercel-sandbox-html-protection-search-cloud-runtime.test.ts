// @vitest-environment node
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HtmlProtectionSearchStateRegistrationSchema, HtmlProtectionSearchStateRequestSchema, HtmlProtectionSnapshotRequestSchema } from "@evolution/contracts";
import { HTML_PROTECTION_CLOUD_PATHS as paths, HTML_PROTECTION_CLOUD_URL as url,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha } from "./vercel-sandbox-html-protection-cloud-protocol";
import { HTML_PROTECTION_SEARCH_CLOUD_RUNNER_SCRIPT as runner } from "./vercel-sandbox-html-protection-search-cloud-transport";
import { HtmlProtectionSearchCloudInputSchema, HtmlProtectionSearchCloudObservationSchema, HtmlProtectionSearchCloudManifestSchema,
  htmlProtectionSearchCloudInputSha256 } from "./vercel-sandbox-html-protection-search-cloud-protocol";
import * as snapshotProducer from "./vercel-sandbox-html-protection-snapshot";
import { runPrivateHtmlProtectionSearchCloudRuntime } from "./vercel-sandbox-html-protection-search-cloud-runtime";
const bundle = Buffer.from("// Authored synthetic direct entry fixture, not deployment runtime bytes.");
const roots: Array<{ path: string; parent: string }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { path, parent } of roots.splice(0)) {
    const target = resolve(path);
    if (!target.startsWith(resolve(parent) + sep) || !basename(target).startsWith("evolution-search-synthetic-")) throw Error("Unsafe synthetic cleanup");
    await rm(target, { recursive: true, force: true });
  }
});
const html = (extra = "") => `<meta charset="utf-8"><input id="search" type="search"><output id="count">2</output><section class="chapter" id="chapter">
<article class="card" id="one" data-search="needle">one</article><article class="card" id="two" data-search="different">two</article></section>
<script>document.querySelector('#search').addEventListener('input',event=>{
const query=event.target.value;let n=0;document.querySelectorAll('.card').forEach(card=>{card.hidden=!card.dataset.search.includes(query);if(!card.hidden)n++});
document.querySelector('#count').textContent=String(n);${extra}
});</script>`;
async function prepared(source = html(), staged = source) {
  const parent = resolve(process.env.TEMP ?? tmpdir()), root = await mkdtemp(join(parent, "evolution-search-synthetic-")); roots.push({ path: root, parent });
  await mkdir(join(root, ".evolution/runtime"), { recursive: true }); await mkdir(join(root, "dist"));
  const physical = Buffer.from(source), artifact = { sourceArtifactId: "synthetic-source", sha256: sha(physical), byteLength: physical.byteLength };
  const registry = { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: artifact.sha256, projection: "search-membership-v1",
    targetId: "search", inputSelector: "#search", countSelector: "#count", cardSelector: ".card", chapterSelector: ".chapter" };
  const registration = HtmlProtectionSearchStateRegistrationSchema.parse({ schemaVersion: "html-protection-search-state-registration-v1", original: artifact,
    policyVersion: "synthetic-v1", planSha256: "a".repeat(64), registrySha256: sha(canonical(registry)), registry,
    input: { id: "search", tag: "INPUT", namespace: "http://www.w3.org/1999/xhtml", type: "search", initialValue: "" },
    states: [{ stateKind: "boot", stateId: "boot" }, { stateKind: "query-positive", stateId: "positive", value: "needle" },
      { stateKind: "query-negative", stateId: "negative", value: "absent-query" }, { stateKind: "clear", stateId: "clear", value: "" }] });
  const common = { binding: { missionId: "synthetic-mission", testCaseId: "same-hidden", criterionId: "protect", paperSha256: "b".repeat(64),
    original: artifact, executed: artifact, subject: { kind: "current", versionId: "v1" } }, sourceRole: "original",
    policyVersion: registration.policyVersion, planSha256: registration.planSha256, registrySha256: registration.registrySha256,
    execution: { executionId: "synthetic-execution", jobId: "synthetic-job", generation: 1 }, batchId: "search" };
  const stateRequests = registration.states.map(state => HtmlProtectionSearchStateRequestSchema.parse({ ...common,
    schemaVersion: "html-protection-search-state-request-v1", stateKind: state.stateKind, stateId: state.stateId }));
  const snapshotRequests = registration.states.map(state => HtmlProtectionSnapshotRequestSchema.parse({ ...common,
    schemaVersion: "html-protection-snapshot-request-v1", stateId: state.stateId, registry, documentUrl: url }));
  const input = HtmlProtectionSearchCloudInputSchema.parse({ schemaVersion: "html-protection-private-search-input-v1", nonce: "c".repeat(64),
    request: snapshotRequests[0], registration, stateRequests, snapshotRequests, material: { sha256: artifact.sha256, byteLength: artifact.byteLength },
    ownedRuntime: { version: "html-protection-private-cloud-v1", sha256: sha(bundle), byteLength: bundle.byteLength } });
  for (const [path, bytes] of [[paths.html, Buffer.from(staged)], [paths.input, Buffer.from(canonical(input))], [paths.bundle, bundle], [paths.runner, Buffer.from(runner)]] as const) await writeFile(join(root, path), bytes);
  return { root, input, physical };
}
async function result(root: string) {
  const bytes = await readFile(join(root, paths.result));
  const manifest = HtmlProtectionSearchCloudManifestSchema.parse(JSON.parse((await readFile(join(root, paths.manifest))).toString("utf8")));
  const observation = HtmlProtectionSearchCloudObservationSchema.parse(JSON.parse(bytes.toString("utf8")));
  expect(manifest.result).toEqual({ path: paths.result, sha256: sha(bytes), byteLength: bytes.byteLength });
  expect(manifest.batchRequestSha256).toBe(htmlProtectionSearchCloudInputSha256(observation.input));
  return observation;
}
describe("continuous owned private search over authored synthetic HTML only", () => {
  it("observes boot, positive, negative and clear on one actual frame/loader, preserving native result membership", async () => {
    const f = await prepared(); await runPrivateHtmlProtectionSearchCloudRuntime({ chromium, workingDirectory: f.root });
    const actual = await result(f.root); expect(actual.availability).toBe("available");
    if (actual.availability !== "available") throw Error("missing continuous native sequence: " + actual.reason);
    expect(actual.steps.map(step => step.status)).toEqual(["observed", "observed", "observed", "observed"]);
    const values: Array<string | null> = [], counts: Array<string | null> = [], visible: number[] = [];
    for (const step of actual.steps) {
      if (step.status !== "observed" || step.snapshot.body?.projection !== "search-membership-v1") throw Error("missing native membership");
      expect(step.snapshot.realm?.frameId).toBe(actual.custody.navigation.frameId);
      expect(step.snapshot.realm?.loaderId).toBe(actual.custody.navigation.loaderId);
      expect(step.actionFacts.fillCalls).toBe(step.stateRequest.stateKind === "boot" ? 0 : 1);
      expect(step.linkFacts.linked).toBe(true); values.push(step.snapshot.body.input.value); counts.push(step.snapshot.body.count.text);
      visible.push(step.snapshot.body.cards.filter(card => !card.hidden && card.display !== "none" && !card.ancestorDisplayNone).length);
    }
    expect(values).toEqual(["", "needle", "absent-query", ""]); expect(counts).toEqual(["2", "1", "0", "2"]); expect(visible).toEqual([2, 1, 0, 2]);
    expect(actual).not.toHaveProperty("wholeProtectionPassed"); expect(actual).not.toHaveProperty("proof");
  }, 45_000);
  it("retains real boot/action failure and explicitly unexecuted future states when the input is replaced", async () => {
    const f = await prepared(html('if(query==="needle")event.target.outerHTML=\'<input id="search" type="search" value="needle">\';'));
    await runPrivateHtmlProtectionSearchCloudRuntime({ chromium, workingDirectory: f.root });
    const actual = await result(f.root); expect(actual).toMatchObject({ availability: "unavailable", phase: "after-startup" });
    if (actual.availability === "available" || actual.phase !== "after-startup") throw Error("missing actual prefix");
    expect(actual.steps.map(step => step.status)).toEqual(["observed", "action-failed", "not-executed", "not-executed"]);
    const failed = actual.steps[1]; if (failed.status !== "action-failed") throw Error("missing failed dispatch");
    expect(failed.actionFacts.fillCalls).toBe(1); expect(failed.actionFacts.fillSettled).toBe(true); expect(failed.actionFacts.executionRecorded).toBe(false);
    expect(failed.actionFacts.gaps).toContain("input-identity-mismatch");
  }, 45_000);
  it("keeps partial native scope and stops rather than inventing later states", async () => {
    const f = await prepared(html().replace('<input id="search" type="search">', '<input id="search" type="search"><div id="shadowHost"></div><script>document.querySelector("#shadowHost").attachShadow({mode:"closed"}).innerHTML="hidden"</script>'));
    await runPrivateHtmlProtectionSearchCloudRuntime({ chromium, workingDirectory: f.root });
    const actual = await result(f.root); expect(actual.availability).toBe("unavailable");
    if (actual.availability === "available" || actual.phase !== "after-startup") throw Error("missing partial prefix");
    expect(actual.steps.map(step => step.status)).toEqual(["observed", "not-executed", "not-executed", "not-executed"]);
    const step = actual.steps[0]; if (step.status !== "observed") throw Error("missing native partial attempt");
    expect(step.actionFacts.executionRecorded).toBe(true); expect(step.snapshot.projectionComplete).toBe(false); expect(step.linkFacts.linked).toBe(false);
  }, 45_000);
  it("refuses mismatched staged bytes before producing any state observations", async () => {
    const f = await prepared(html(), html('document.title="different";'));
    await runPrivateHtmlProtectionSearchCloudRuntime({ chromium, workingDirectory: f.root });
    expect(await result(f.root)).toMatchObject({ availability: "unavailable", phase: "before-startup", reason: "staged-material-mismatch" });
    expect(await result(f.root)).not.toHaveProperty("steps");
  });
});
it("retains the real complete action when an aggregate native body is refused without cropping it", async () => {
  const f = await prepared(), collect = snapshotProducer.collectVercelSandboxHtmlProtectionSnapshot;
  vi.spyOn(snapshotProducer, "collectVercelSandboxHtmlProtectionSnapshot").mockImplementation(async args => {
    const actual = await collect(args);
    if (actual.availability !== "available" || actual.body?.projection !== "search-membership-v1") return actual;
    // Authored synthetic transfer-size stress; no page/model claims and no production content.
    actual.body.cards = Array.from({ length: 6_000 }, (_, index) => ({ id: "card-" + index, tag: "ARTICLE", namespace: "http://www.w3.org/1999/xhtml",
      classAttribute: "card-" + "x".repeat(80), hidden: false, display: "block", ancestorDisplayNone: false, chapterId: "chapter" }));
    actual.body.counters.collectedNodes = 6_003;
    actual.body.counters.textUtf8Bytes = actual.body.cards.reduce((sum, card) => sum + Buffer.byteLength(card.id! + card.classAttribute! + card.chapterId!), 0)
      + Buffer.byteLength(actual.body.input.value ?? "") + Buffer.byteLength(actual.body.count.text ?? "") + Buffer.byteLength(actual.body.chapters.map(chapter => (chapter.id ?? "") + (chapter.classAttribute ?? "") + (chapter.chapterId ?? "")).join(""));
    actual.bodySha256 = sha(canonical(actual.body)); actual.bodyUtf8Bytes = Buffer.byteLength(canonical(actual.body)); return actual;
  });
  await runPrivateHtmlProtectionSearchCloudRuntime({ chromium, workingDirectory: f.root });
  const actual = await result(f.root); expect(actual.availability).toBe("unavailable");
  if (actual.availability === "available" || actual.phase !== "after-startup") throw Error("false startup classification");
  const rejected = actual.steps.find(step => step.status === "observation-rejected");
  expect(rejected?.status).toBe("observation-rejected");
  if (rejected?.status !== "observation-rejected") throw Error("missing whole-material rejection");
  expect(rejected.actionFacts.executionRecorded).toBe(true); expect(rejected.rejectedSnapshot.reason).toBe("aggregate-private-file-limit");
  expect(rejected).not.toHaveProperty("snapshot"); expect(rejected).not.toHaveProperty("body");
  expect(actual.reason).toBe("private-file-limit");
}, 45_000);