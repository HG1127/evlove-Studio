import { HtmlProtectionPrivateFileGap, readOwnedHtmlProtectionPrivateFile as boundedPhysicalFile, writeOwnedHtmlProtectionPrivateFile as atomicPrivateFile } from "./html-protection-private-files";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { BrowserType, Browser } from "@playwright/test";
import { withOwnedHtmlProtectionDocument, OwnedHtmlProtectionDocumentGap } from "./html-protection-owned-document";
import { collectVercelSandboxHtmlProtectionSnapshot, type HtmlProtectionSnapshotCdpPort } from "./vercel-sandbox-html-protection-snapshot";
import {
  HTML_PROTECTION_CLOUD_PATHS as paths,
  HTML_PROTECTION_CLOUD_LIMITS as limits,
  HtmlProtectionCloudInputSchema, HtmlProtectionCloudObservationSchema, HtmlProtectionCloudManifestSchema,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha,
  type HtmlProtectionCloudInput, type HtmlProtectionCloudObservation,
} from "./vercel-sandbox-html-protection-cloud-protocol";

class MaterialGap extends Error {
  readonly code: "staged-material-mismatch" | "served-material-mismatch" | "blocked-resource" | "runtime-integrity";
  constructor(code: MaterialGap["code"]) { super(code); this.code = code; }
}
function material(bytes: Uint8Array) { return { sha256: sha(bytes), byteLength: bytes.byteLength }; }
function sameMaterial(actual: ReturnType<typeof material>, expected: ReturnType<typeof material>) {
  return actual.sha256 === expected.sha256 && actual.byteLength === expected.byteLength;
}
async function observeOwnedRuntime(chromium: BrowserType<Browser>, input: HtmlProtectionCloudInput, html: Buffer) {
  return withOwnedHtmlProtectionDocument({ chromium, physicalHtml: html, expectedMaterial: input.material, consume: async owned => {
    const snapshot = await collectVercelSandboxHtmlProtectionSnapshot({ request: input.request, physicalHtml: html,
      createSession: async () => await owned.context.newCDPSession(owned.page) as unknown as HtmlProtectionSnapshotCdpPort });
    await owned.assertCurrent();
    if (snapshot.realm && (snapshot.realm.frameId !== owned.custody.navigation.frameId || snapshot.realm.loaderId !== owned.custody.navigation.loaderId)) {
      throw new OwnedHtmlProtectionDocumentGap("served-material-mismatch");
    }
    return HtmlProtectionCloudObservationSchema.parse({ schemaVersion: "html-protection-private-observation-v1", nonce: input.nonce,
      request: input.request, ownedRuntime: input.ownedRuntime, availability: "available", custody: owned.custody, snapshot });
  } });
}
/**
 * Build this owned entry together with the existing snapshot primitive into a fixed ESM
 * bundle in the trusted deployment pipeline. Never run user HTML here on the host.
 * chromium/workingDirectory are supplied only by the fixed Sandbox loader, not requests.
 * No console/page output is observed, and this function makes no whole-protection verdict.
 */
async function executePrivateRuntime(args: { chromium: BrowserType<Browser>; workingDirectory: string }) {
  const privateRoot = join(args.workingDirectory, dirname(paths.input));
  await mkdir(privateRoot, { recursive: true, mode: 0o700 });
  const input = HtmlProtectionCloudInputSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
    await boundedPhysicalFile(join(args.workingDirectory, paths.input), limits.inputBytes))));
  const runtime = await boundedPhysicalFile(join(args.workingDirectory, paths.bundle), limits.runtimeBytes);
  const runner = await boundedPhysicalFile(join(args.workingDirectory, paths.runner), limits.inputBytes);
  let observation: HtmlProtectionCloudObservation;
  try {
    if (!sameMaterial(material(runtime), input.ownedRuntime)) throw new MaterialGap("runtime-integrity");
    const html = await boundedPhysicalFile(join(args.workingDirectory, paths.html), limits.htmlBytes);
    if (!sameMaterial(material(html), input.material)) throw new MaterialGap("staged-material-mismatch");
    observation = await observeOwnedRuntime(args.chromium, input, html);
  } catch (error) {
    observation = HtmlProtectionCloudObservationSchema.parse({
      schemaVersion: "html-protection-private-observation-v1", nonce: input.nonce, request: input.request, ownedRuntime: input.ownedRuntime,
      availability: "unavailable", reason: error instanceof MaterialGap || error instanceof HtmlProtectionPrivateFileGap || error instanceof OwnedHtmlProtectionDocumentGap ? error.code : "observation-unavailable",
    });
  }
  const bytes = Buffer.from(canonical(observation), "utf8");
  if (bytes.byteLength > limits.resultBytes) throw new Error("Private result limit exceeded");
  await atomicPrivateFile(join(args.workingDirectory, paths.result), bytes);
  const manifest = HtmlProtectionCloudManifestSchema.parse({
    schemaVersion: "html-protection-private-manifest-v1", nonce: input.nonce, requestSha256: sha(canonical(input.request)),
    ownedRuntimeSha256: sha(runtime), runnerSha256: sha(runner),
    result: { path: paths.result, sha256: sha(bytes), byteLength: bytes.byteLength },
  });
  await atomicPrivateFile(join(args.workingDirectory, paths.manifest), Buffer.from(canonical(manifest), "utf8"));
}

export async function runPrivateHtmlProtectionCloudRuntime(args: { chromium: BrowserType<Browser>; workingDirectory: string }) {
  try { await executePrivateRuntime(args); } catch { throw new Error("Private observation runtime unavailable"); }
}

export { runPrivateHtmlProtectionSearchCloudRuntime } from "./vercel-sandbox-html-protection-search-cloud-runtime";
