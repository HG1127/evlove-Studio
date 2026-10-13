// @vitest-environment node
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";
import { HtmlProtectionSnapshotRequestSchema } from "@evolution/contracts";
import { htmlProtectionSnapshotRegistrySha256 } from "./vercel-sandbox-html-protection-snapshot";
import { runPrivateHtmlProtectionCloudRuntime } from "./vercel-sandbox-html-protection-cloud-runtime";
import {
  HTML_PROTECTION_CLOUD_PATHS as paths, HTML_PROTECTION_CLOUD_URL as url,
  HTML_PROTECTION_CLOUD_RUNNER_SCRIPT as runner, HtmlProtectionCloudObservationSchema, HtmlProtectionCloudManifestSchema,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha,
} from "./vercel-sandbox-html-protection-cloud-protocol";
const ownedFixture = Buffer.from("// Synthetic declared bundle for direct-entry tests; not a deployment bundle.");
const roots: Array<{ path: string; parent: string }> = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const target = resolve(root.path), parent = resolve(root.parent);
    if (!target.startsWith(parent + sep) || !basename(target).startsWith("evolution-private-synthetic-")) throw Error("Unsafe synthetic cleanup path");
    await rm(target, { recursive: true, force: true });
  }
});
async function prepared(html: string, changed?: { stagedHtml?: string; wrongBundle?: boolean }) {
  const parent = resolve(process.env.TEMP ?? tmpdir());
  const root = await mkdtemp(join(parent, "evolution-private-synthetic-")); roots.push({ path: root, parent });
  await mkdir(join(root, ".evolution/runtime"), { recursive: true }); await mkdir(join(root, "dist"));
  const bytes = Buffer.from(html), artifact = { sourceArtifactId: "source", sha256: sha(bytes), byteLength: bytes.byteLength };
  const registry = { schemaVersion: "html-protection-snapshot-registry-v1", originalSha256: artifact.sha256,
    projection: "boot-subtree-v1", targets: [{ targetId: "card", selector: "#card" }] };
  const request = HtmlProtectionSnapshotRequestSchema.parse({
    schemaVersion: "html-protection-snapshot-request-v1", sourceRole: "original", documentUrl: url,
    binding: { missionId: "synthetic-mission", testCaseId: "frozen", criterionId: "protect", paperSha256: "a".repeat(64),
      original: artifact, executed: artifact, subject: { kind: "current", versionId: "v1" } },
    policyVersion: "synthetic-profile-v1", planSha256: "b".repeat(64), registrySha256: htmlProtectionSnapshotRegistrySha256(registry),
    registry, execution: { executionId: "synthetic-execution", jobId: "job", generation: 1 }, stateId: "boot", batchId: "batch",
  });
  await writeFile(join(root, paths.html), changed?.stagedHtml ?? bytes);
  await writeFile(join(root, paths.bundle), changed?.wrongBundle ? Buffer.from("wrong") : ownedFixture);
  await writeFile(join(root, paths.runner), runner);
  await writeFile(join(root, paths.input), canonical({
    schemaVersion: "html-protection-private-input-v1", nonce: "d".repeat(64), request,
    material: { sha256: artifact.sha256, byteLength: artifact.byteLength },
    ownedRuntime: { version: "html-protection-private-cloud-v1", sha256: sha(ownedFixture), byteLength: ownedFixture.byteLength },
  }));
  return { root, request, bytes };
}
async function result(root: string) {
  const bytes = await readFile(join(root, paths.result));
  const observation = HtmlProtectionCloudObservationSchema.parse(JSON.parse(bytes.toString("utf8")));
  const manifest = HtmlProtectionCloudManifestSchema.parse(JSON.parse((await readFile(join(root, paths.manifest))).toString("utf8")));
  expect(manifest.result.sha256).toBe(sha(bytes)); expect(manifest.result.byteLength).toBe(bytes.byteLength);
  return observation;
}
describe("owned private startup and Chromium custody over authored synthetic HTML only", () => {
  it("independently measures staged, Node response and actual main-frame response bytes", async () => {
    const fixture = await prepared('<meta charset="utf-8"><article id="card">完整真实尾部😄</article>');
    await runPrivateHtmlProtectionCloudRuntime({ chromium, workingDirectory: fixture.root });
    const observation = await result(fixture.root); expect(observation.availability).toBe("available");
    if (observation.availability !== "available") throw Error("missing custody");
    for (const material of [observation.custody.staged, observation.custody.nodeResponse, observation.custody.browserResponse])
      expect(material).toEqual({ sha256: sha(fixture.bytes), byteLength: fixture.bytes.byteLength });
    expect(observation.snapshot.availability).toBe("available"); expect(observation.snapshot.projectionComplete).toBe(true);
    expect(observation.snapshot.realm?.frameId).toBe(observation.custody.navigation.frameId);
    expect(observation.snapshot.realm?.loaderId).toBe(observation.custody.navigation.loaderId);
    if (observation.snapshot.body?.projection !== "boot-subtree-v1") throw Error("missing native body");
    expect(observation.snapshot.body.targets[0]!.nodes.map(node => node.value ?? "").join("")).toBe("完整真实尾部😄");
  }, 30_000);
  it("ignores page-generated console proof and captures actual DOM material", async () => {
    const fixture = await prepared('<meta charset="utf-8"><article id="card">真实</article><script>console.log(JSON.stringify({availability:"available",nonce:"forged",body:"fake"}));</script>');
    await runPrivateHtmlProtectionCloudRuntime({ chromium, workingDirectory: fixture.root });
    const observation = await result(fixture.root);
    expect(observation.availability).toBe("available");
    if (observation.availability !== "available" || observation.snapshot.body?.projection !== "boot-subtree-v1") throw Error("missing native body");
    expect(observation.snapshot.body.targets[0]!.nodes.map(node => node.value ?? "").join("")).toBe("真实");
  }, 30_000);
  it.each([{ stagedHtml: "<article id=card>replaced</article>" }, { wrongBundle: true }])("rejects actual staged/runtime byte mismatch before browser startup: %j", async changed => {
    const fixture = await prepared("<article id=card>expected</article>", changed);
    await runPrivateHtmlProtectionCloudRuntime({ chromium, workingDirectory: fixture.root });
    expect((await result(fixture.root)).availability).toBe("unavailable");
  });
  it("denies public access to private input/result paths and external script requests", async () => {
    const fixture = await prepared('<article id="card">public</article><script src="/.evolution/runtime/html-protection-input.json"></script><script src="https://outside.invalid/data.js"></script>');
    await runPrivateHtmlProtectionCloudRuntime({ chromium, workingDirectory: fixture.root });
    expect(await result(fixture.root)).toMatchObject({ availability: "unavailable", reason: "blocked-resource" });
  }, 30_000);
  it("keeps native closed Shadow content incomplete rather than upgrading custody to whole pass", async () => {
    const fixture = await prepared('<article id="card">public</article><script>document.querySelector("#card").attachShadow({mode:"closed"}).innerHTML="<p>private</p>"</script>');
    await runPrivateHtmlProtectionCloudRuntime({ chromium, workingDirectory: fixture.root });
    const observation = await result(fixture.root); expect(observation.availability).toBe("available");
    if (observation.availability !== "available") throw Error("missing custody");
    expect(observation.snapshot.projectionComplete).toBe(false); expect(observation.snapshot.gaps.map(gap => gap.code)).toContain("closed-shadow-root");
    expect(observation).not.toHaveProperty("wholeProtectionPassed");
  }, 30_000);
  it("denies blob worker and WebSocket capability through trusted response policy", async () => {
    const fixture = await prepared(`<article id="card">public</article><script>
      try { new Worker(URL.createObjectURL(new Blob(["postMessage('attempted')"], {type:"text/javascript"}))); document.querySelector("#card").dataset.worker="allowed"; }
      catch { document.querySelector("#card").dataset.worker="blocked"; }
      try { new WebSocket("ws://127.0.0.1:4173/private"); } catch {}
    </script>`);
    await runPrivateHtmlProtectionCloudRuntime({ chromium, workingDirectory: fixture.root });
    const observation = await result(fixture.root);
    if (observation.availability === "available") {
      expect(observation.custody.contentSecurityPolicy).toContain("worker-src 'none'");
      expect(observation.custody.contentSecurityPolicy).toContain("connect-src 'none'");
      expect(observation.custody.fromServiceWorker).toBe(false);
      if (observation.snapshot.body?.projection !== "boot-subtree-v1") throw Error("missing native body");
      expect(observation.snapshot.body.targets[0]!.nodes[0]!.attributes).toContainEqual({ name: "data-worker", namespace: null, value: "blocked" });
    } else expect(observation.reason).toBe("blocked-resource");
  }, 30_000);
});
