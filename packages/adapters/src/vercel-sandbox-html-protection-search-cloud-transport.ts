import { randomBytes } from "node:crypto";
import type { HtmlProtectionSnapshotRequest, HtmlProtectionSearchStateRegistration, HtmlProtectionSearchStateRequest } from "@evolution/contracts";
import { readBoundedHtmlProtectionPrivateFile as read, validateHtmlProtectionSnapshotMaterial as validateSnapshot, type HtmlProtectionPreparedBrowserFactory } from "./vercel-sandbox-html-protection-cloud-transport";
import { HTML_PROTECTION_CLOUD_PATHS as paths, HTML_PROTECTION_CLOUD_LIMITS as limits,
  HtmlProtectionOwnedRuntimeBindingSchema, htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha } from "./vercel-sandbox-html-protection-cloud-protocol";
import { HtmlProtectionSearchCloudInputSchema, HtmlProtectionSearchCloudObservationSchema, HtmlProtectionSearchCloudManifestSchema,
  htmlProtectionSearchCloudInputSha256, type HtmlProtectionSearchCloudObservation, type HtmlProtectionSearchCloudGapSchema } from "./vercel-sandbox-html-protection-search-cloud-protocol";
import type { z } from "zod";

export const HTML_PROTECTION_SEARCH_CLOUD_RUNNER_SCRIPT = String.raw`import { chromium } from "../browser/node_modules/playwright/index.mjs";
import { runPrivateHtmlProtectionSearchCloudRuntime } from "./html-protection-owned-runtime.mjs";
await runPrivateHtmlProtectionSearchCloudRuntime({ chromium, workingDirectory: process.cwd() });
`;
export type HtmlProtectionSearchObservationArgs = {
  registration: HtmlProtectionSearchStateRegistration;
  stateRequests: HtmlProtectionSearchStateRequest[];
  snapshotRequests: HtmlProtectionSnapshotRequest[];
  physicalHtml: Uint8Array;
};
export type HtmlProtectionSearchObservationResult = {
  /** Private transport succeeded. Inspect observation.availability and every step independently. */
  availability: "available"; observation: HtmlProtectionSearchCloudObservation; resultSha256: string; resultByteLength: number;
} | { availability: "unavailable"; reason: z.infer<typeof HtmlProtectionSearchCloudGapSchema> };
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const json = (bytes: Buffer): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
type OwnedSandbox = Awaited<ReturnType<NonNullable<HtmlProtectionPreparedBrowserFactory["createPreparedBrowserSandbox"]>>>;

/** Fixed closed four-state protocol, same owned VM/Page, full private bytes; no stdout or general action selection. */
export async function runVercelSandboxHtmlProtectionSearchObservation(args: HtmlProtectionSearchObservationArgs,
  ports: HtmlProtectionPreparedBrowserFactory = {}): Promise<HtmlProtectionSearchObservationResult> {
  const unavailable = (reason: Extract<HtmlProtectionSearchObservationResult, { availability: "unavailable" }>["reason"]): HtmlProtectionSearchObservationResult => ({ availability: "unavailable", reason });
  // Capture every caller-held view and function before storage/VM awaits.
  const physical = args.physicalHtml.byteLength <= limits.htmlBytes ? Buffer.from(args.physicalHtml) : undefined;
  const runtime = ports.trustedRuntimeBytes && ports.trustedRuntimeBytes.byteLength <= limits.runtimeBytes ? Buffer.from(ports.trustedRuntimeBytes) : undefined;
  const binding = HtmlProtectionOwnedRuntimeBindingSchema.safeParse(ports.trustedRuntimeBinding), create = ports.createPreparedBrowserSandbox;
  if (!physical?.byteLength) return unavailable("physical-input-mismatch");
  if (!binding.success || !runtime || typeof create !== "function") return unavailable("missing-trusted-runtime");
  if (sha(runtime) !== binding.data.sha256 || runtime.byteLength !== binding.data.byteLength) return unavailable("runtime-integrity");
  const nonce = randomBytes(32).toString("hex");
  const parsed = HtmlProtectionSearchCloudInputSchema.safeParse({ schemaVersion: "html-protection-private-search-input-v1", nonce,
    request: args.snapshotRequests[0], registration: args.registration, stateRequests: args.stateRequests, snapshotRequests: args.snapshotRequests,
    material: { sha256: sha(physical), byteLength: physical.byteLength }, ownedRuntime: binding.data });
  if (!parsed.success) return unavailable("request-binding-mismatch");
  const input = parsed.data, inputSha = htmlProtectionSearchCloudInputSha256(input), inputBytes = Buffer.from(canonical(input));
  const name = "evo-protection-search-" + nonce.slice(0, 24), controller = new AbortController(), absoluteDeadline = Date.now() + limits.deadlineMs;
  let closed = false, sandbox: OwnedSandbox | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Set<OwnedSandbox>();
  const stopOwned = async (owned: OwnedSandbox) => {
    if (owned.name !== name || owned.persistent !== false || stopped.has(owned)) return;
    stopped.add(owned); const cleanup = new AbortController(), timeout = setTimeout(() => cleanup.abort(), 5_000);
    try { await Promise.race([owned.stop({ signal: cleanup.signal }), new Promise<void>(resolve => cleanup.signal.addEventListener("abort", () => resolve(), { once: true }))]); }
    catch { /* Stop only this uniquely named disposable VM. */ } finally { clearTimeout(timeout); }
  };
  const active = () => { if (closed || controller.signal.aborted || Date.now() >= absoluteDeadline) throw Error("PRIVATE_TIMEOUT"); };
  const operation = (async (): Promise<HtmlProtectionSearchObservationResult> => {
    const created = await create({ name, persistent: false, networkPolicy: "deny-all", timeout: limits.deadlineMs, signal: controller.signal });
    if (closed || controller.signal.aborted || Date.now() >= absoluteDeadline) { await stopOwned(created); throw Error("PRIVATE_TIMEOUT"); }
    sandbox = created;
    if (created.name !== name || created.persistent !== false || created.cwd !== "/vercel/sandbox" || created.currentSession().networkPolicy !== "deny-all") return unavailable("sandbox-policy-unavailable");
    active(); await created.writeFiles([
      { path: paths.html, content: physical, mode: 0o400 }, { path: paths.bundle, content: runtime, mode: 0o400 },
      { path: paths.input, content: inputBytes, mode: 0o600 }, { path: paths.runner, content: Buffer.from(HTML_PROTECTION_SEARCH_CLOUD_RUNNER_SCRIPT), mode: 0o400 },
    ], { signal: controller.signal }); active();
    const staged = await read(created, paths.bundle, limits.runtimeBytes, controller.signal); active();
    if (sha(staged) !== binding.data.sha256 || staged.byteLength !== binding.data.byteLength) return unavailable("runtime-integrity");
    const execution = await created.runCommand({ cmd: "node", args: ["--max-old-space-size=512", paths.runner], cwd: "/vercel/sandbox", timeoutMs: 80_000, signal: controller.signal }); active();
    if (execution.exitCode !== 0) return unavailable("runtime-exit");
    const manifest = HtmlProtectionSearchCloudManifestSchema.parse(json(await read(created, paths.manifest, limits.manifestBytes, controller.signal))); active();
    if (manifest.nonce !== nonce || manifest.batchRequestSha256 !== inputSha) return unavailable("request-binding-mismatch");
    if (manifest.ownedRuntimeSha256 !== binding.data.sha256 || manifest.runnerSha256 !== sha(HTML_PROTECTION_SEARCH_CLOUD_RUNNER_SCRIPT)) return unavailable("runtime-integrity");
    const bytes = await read(created, paths.result, limits.resultBytes, controller.signal); active();
    if (bytes.byteLength !== manifest.result.byteLength || sha(bytes) !== manifest.result.sha256) return unavailable("private-file-integrity");
    const observation = HtmlProtectionSearchCloudObservationSchema.parse(json(bytes));
    if (!equal(observation.input, input) || observation.batchRequestSha256 !== inputSha) return unavailable("request-binding-mismatch");
    if (observation.availability === "available" || observation.phase === "after-startup") {
      for (let index = 0; index < 4; index++) {
        const step = observation.steps[index]!;
        if (step.status === "observed") validateSnapshot(step.snapshot, input.snapshotRequests[index]!, input.material, observation.custody.navigation);
      }
    }
    active(); return { availability: "available", observation, resultSha256: sha(bytes), resultByteLength: bytes.byteLength };
  })();
  try { return await Promise.race([operation, new Promise<HtmlProtectionSearchObservationResult>(resolve => {
    timer = setTimeout(() => { closed = true; controller.abort(); resolve(unavailable("private-file-timeout")); }, limits.deadlineMs);
  })]); }
  catch (error) {
    const code = error instanceof Error && "code" in error ? (error as Error & { code: unknown }).code : undefined;
    const allowed = ["private-file-missing", "private-file-limit", "private-file-timeout", "private-file-stream"] as const;
    return unavailable(error instanceof Error && error.message === "PRIVATE_TIMEOUT" ? "private-file-timeout"
      : typeof code === "string" && allowed.includes(code as typeof allowed[number]) ? code as typeof allowed[number] : "private-file-integrity");
  } finally { closed = true; if (timer) clearTimeout(timer); controller.abort(); if (sandbox) await stopOwned(sandbox); }
}