import { randomBytes } from "node:crypto";
import type { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import { HtmlProtectionSnapshotRequestSchema, type HtmlProtectionSnapshotRequest, type HtmlProtectionSnapshotResult } from "@evolution/contracts";
import {
  HTML_PROTECTION_CLOUD_PATHS as paths, HTML_PROTECTION_CLOUD_URL as documentUrl,
  HTML_PROTECTION_CLOUD_LIMITS as limits, HTML_PROTECTION_CLOUD_RUNNER_SCRIPT as runner,
  HtmlProtectionOwnedRuntimeBindingSchema, HtmlProtectionCloudInputSchema,
  HtmlProtectionCloudObservationSchema, HtmlProtectionCloudManifestSchema, HtmlProtectionCloudGapSchema,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha,
  type HtmlProtectionCloudObservation,
} from "./vercel-sandbox-html-protection-cloud-protocol";

type OwnedSandbox = Pick<Sandbox, "name" | "cwd" | "persistent" | "currentSession" | "readFile" | "writeFiles" | "runCommand" | "stop">;
export interface HtmlProtectionPreparedBrowserFactory {
  /** Composition-owned expectation for its fixed build artifact, never external request/result data. */
  trustedRuntimeBinding?: z.infer<typeof HtmlProtectionOwnedRuntimeBindingSchema>;
  /** Exact fixed bundle emitted by the trusted build pipeline; never model/client runtime code. */
  trustedRuntimeBytes?: Uint8Array;
  /** Must create a new named ephemeral VM from the trusted browser runtime; never return shared resources. */
  createPreparedBrowserSandbox?: (spec: {
    name: string; persistent: false; networkPolicy: "deny-all"; timeout: number; signal: AbortSignal;
  }) => Promise<OwnedSandbox>;
}
export type HtmlProtectionCloudObservationResult = {
  availability: "available"; observation: HtmlProtectionCloudObservation; resultSha256: string; resultByteLength: number;
} | { availability: "unavailable"; reason: z.infer<typeof HtmlProtectionCloudGapSchema>; request: HtmlProtectionSnapshotRequest };

class ReadGap extends Error {
  readonly code: "private-file-missing" | "private-file-limit" | "private-file-timeout" | "private-file-stream";
  constructor(code: ReadGap["code"]) { super(code); this.code = code; }
}
/** SDK 3.3 Node stream: collect only bounded bytes; never use stdout/readFileToBuffer. */
export async function readBoundedHtmlProtectionPrivateFile(
  sandbox: Pick<OwnedSandbox, "readFile">, path: string, maximum: number, signal: AbortSignal,
) {
  if ((!Object.values(paths).includes(path as typeof paths[keyof typeof paths]) && !/^\.evolution\/runtime\/whole-observations\/[0-9]{5}-[0-9]{3}\.part$/.test(path) && ![".evolution/runtime/html-protection-whole-manifest.json"].includes(path))
    || !Number.isSafeInteger(maximum) || maximum <= 0 || maximum > limits.runtimeBytes) throw new ReadGap("private-file-limit");
  if (signal.aborted) throw new ReadGap("private-file-timeout");
  const stream = await sandbox.readFile({ path, cwd: "/vercel/sandbox" }, { signal });
  if (!stream) throw new ReadGap("private-file-missing");
  const readable = stream as NodeJS.ReadableStream & { destroy?: () => unknown };
  if (typeof readable.destroy !== "function") throw new ReadGap("private-file-stream");
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []; let total = 0, settled = false;
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      readable.removeListener("data", data); readable.removeListener("end", end);
      readable.removeListener("error", error); readable.removeListener("close", closed);
    };
    const fail = (code: ReadGap["code"]) => {
      if (settled) return; settled = true; cleanup();
      // destroy() without an error avoids creating an unhandled stream error after cleanup.
      // An SDK abort can emit a late transport error; it must not crash the caller.
      readable.on("error", () => {}); readable.destroy?.(); reject(new ReadGap(code));
    };
    const abort = () => fail("private-file-timeout");
    const error = () => fail("private-file-stream");
    const closed = () => { if (!settled) fail("private-file-stream"); };
    const data = (raw: unknown) => {
      if (!(raw instanceof Uint8Array) || raw.byteLength > maximum - total) { fail("private-file-limit"); return; }
      const chunk = Buffer.from(raw); chunks.push(chunk); total += chunk.byteLength;
    };
    const end = () => { if (!settled) { settled = true; cleanup(); resolve(Buffer.concat(chunks, total)); } };
    readable.on("error", error); readable.on("close", closed); readable.on("end", end); readable.on("data", data);
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
  });
}
function parsePrivateJson(bytes: Uint8Array) { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
function equal(left: unknown, right: unknown) { return canonical(left) === canonical(right); }
function validateObservation(observation: HtmlProtectionCloudObservation, expected: HtmlProtectionSnapshotRequest,
  material: { sha256: string; byteLength: number }) {
  if (!equal(observation.request, expected)) throw new Error("REQUEST_BINDING");
  if (observation.availability !== "available") return;
  for (const seen of [observation.custody.staged, observation.custody.nodeResponse, observation.custody.browserResponse])
    if (!equal(seen, material)) throw new Error("PRIVATE_INTEGRITY");
  validateHtmlProtectionSnapshotMaterial(observation.snapshot, expected, material, observation.custody.navigation);
}
/** Full selected native material consistency only; no observation provenance or protection verdict. */
export function validateHtmlProtectionSnapshotMaterial(snapshot: HtmlProtectionSnapshotResult, expected: HtmlProtectionSnapshotRequest,
  material: { sha256: string; byteLength: number }, navigation: { frameId: string; loaderId: string }) {
  if (!equal(snapshot.request, expected) || !equal(snapshot.physicalInput, material)) throw new Error("REQUEST_BINDING");
  if (snapshot.realm && (snapshot.realm.frameId !== navigation.frameId
    || snapshot.realm.loaderId !== navigation.loaderId)) throw new Error("PRIVATE_INTEGRITY");
  if (snapshot.body) {
    const body = snapshot.body, encoded = canonical(body);
    if (sha(encoded) !== snapshot.bodySha256 || Buffer.byteLength(encoded, "utf8") !== snapshot.bodyUtf8Bytes) throw new Error("PRIVATE_INTEGRITY");
    let collected = 0, textBytes = 0, incomplete = false;
    const utf8 = (value: string | null) => Buffer.byteLength(value ?? "", "utf8");
    const targets = expected.registry.projection === "search-membership-v1" ? [expected.registry.targetId]
      : expected.registry.targets.map(target => target.targetId);
    if (body.gaps.some(gap => gap.targetId !== undefined && !targets.includes(gap.targetId))) throw new Error("PRIVATE_INTEGRITY");
    if (body.projection === "boot-subtree-v1" && expected.registry.projection === "boot-subtree-v1") {
      if (body.targets.length !== targets.length || body.targets.some((target, index) => target.targetId !== targets[index])) throw new Error("PRIVATE_INTEGRITY");
      for (const target of body.targets) {
        if (target.matchCount === 1 && !target.nodes.length) throw new Error("PRIVATE_INTEGRITY");
        incomplete ||= target.matchCount !== 1;
        collected += target.nodes.length;
        for (const node of target.nodes) {
          incomplete ||= node.assignedOutsideTarget > 0;
          textBytes += utf8(node.value) + node.attributes.reduce((sum, attribute) => sum + utf8(attribute.value), 0);
        }
      }
    } else if (body.projection === "search-membership-v1" && expected.registry.projection === "search-membership-v1") {
      if (body.targetId !== expected.registry.targetId) throw new Error("PRIVATE_INTEGRITY");
      for (const rows of [body.cards, body.chapters]) {
        const ids = rows.map(row => row.id); incomplete ||= ids.some(id => !id) || new Set(ids).size !== ids.length;
        textBytes += rows.reduce((sum, row) => sum + utf8(row.id) + utf8(row.classAttribute) + utf8(row.chapterId), 0);
      }
      incomplete ||= body.input.matchCount !== 1 || body.count.matchCount !== 1 || body.input.tag !== "INPUT" || body.input.value === null;
      if (body.count.matchCount === 1 && body.count.text === null) throw new Error("PRIVATE_INTEGRITY");
      collected = body.cards.length + body.chapters.length + Number(body.input.matchCount === 1) + Number(body.count.matchCount === 1);
      textBytes += utf8(body.input.value) + utf8(body.count.text);
    } else throw new Error("PRIVATE_INTEGRITY");
    if (collected !== body.counters.collectedNodes || textBytes !== body.counters.textUtf8Bytes
      || (incomplete && snapshot.projectionComplete)) throw new Error("PRIVATE_INTEGRITY");
  }
}
/**
 * Trusted observation transport only. Factory/bundle readiness is caller-owned, and missing
 * wiring returns unavailable before a paid VM is created. No runtime/env/code field comes
 * from the request. Exact native result material comes from private files, never console.
 */
export async function runVercelSandboxHtmlProtectionCloudObservation(
  args: { request: unknown; physicalHtml: Uint8Array }, ports: HtmlProtectionPreparedBrowserFactory = {},
): Promise<HtmlProtectionCloudObservationResult> {
  // Own bounded copies before any asynchronous callback can mutate caller-held views.
  const physicalHtml = args.physicalHtml.byteLength <= limits.htmlBytes ? Buffer.from(args.physicalHtml) : undefined;
  const runtimeBytes = ports.trustedRuntimeBytes && ports.trustedRuntimeBytes.byteLength <= limits.runtimeBytes
    ? Buffer.from(ports.trustedRuntimeBytes) : undefined;
  const factory = ports.createPreparedBrowserSandbox;
  const request = HtmlProtectionSnapshotRequestSchema.parse(args.request);
  const unavailable = (reason: Extract<HtmlProtectionCloudObservationResult, { availability: "unavailable" }>["reason"]): HtmlProtectionCloudObservationResult =>
    ({ availability: "unavailable", reason, request });
  if (request.registry.projection === "copy-material-v1") return unavailable("copy-material-undefined");
  const binding = HtmlProtectionOwnedRuntimeBindingSchema.safeParse(ports.trustedRuntimeBinding);
  if (typeof factory !== "function" || !binding.success || !runtimeBytes) return unavailable("missing-trusted-runtime");
  if (runtimeBytes.byteLength !== binding.data.byteLength || sha(runtimeBytes) !== binding.data.sha256) return unavailable("runtime-integrity");
  if (request.documentUrl !== documentUrl) return unavailable("request-binding-mismatch");
  const expected = request.sourceRole === "original" ? request.binding.original : request.binding.executed;
  if (!physicalHtml) return unavailable("physical-input-mismatch");
  const physical = { sha256: sha(physicalHtml), byteLength: physicalHtml.byteLength };
  if (!physical.byteLength || physical.byteLength > limits.htmlBytes || !equal(physical, { sha256: expected.sha256, byteLength: expected.byteLength })) return unavailable("physical-input-mismatch");
  const nonce = randomBytes(32).toString("hex"), name = "evo-protection-" + nonce.slice(0, 24);
  const controller = new AbortController(), absoluteDeadline = Date.now() + limits.deadlineMs; let closed = false, sandbox: OwnedSandbox | undefined;
  const stopped = new Set<OwnedSandbox>();
  const stopOwned = async (value: OwnedSandbox) => {
    if (value.name !== name || value.persistent !== false || stopped.has(value)) return;
    stopped.add(value); const cleanup = new AbortController(), timer = setTimeout(() => cleanup.abort(), 5_000);
    try { await Promise.race([value.stop({ signal: cleanup.signal }), new Promise<void>(resolve => {
      cleanup.signal.addEventListener("abort", () => resolve(), { once: true });
    })]); } catch { /* Only this named disposable VM is ours. */ } finally { clearTimeout(timer); }
  };
  const active = () => { if (closed || controller.signal.aborted || Date.now() >= absoluteDeadline) throw new ReadGap("private-file-timeout"); };
  const operation = (async (): Promise<HtmlProtectionCloudObservationResult> => {
    const created = await factory({ name, persistent: false, networkPolicy: "deny-all", timeout: limits.deadlineMs, signal: controller.signal });
    if (closed || controller.signal.aborted || Date.now() >= absoluteDeadline) { await stopOwned(created); throw new ReadGap("private-file-timeout"); }
    sandbox = created;
    if (created.name !== name || created.persistent !== false || created.cwd !== "/vercel/sandbox"
      || created.currentSession().networkPolicy !== "deny-all") return unavailable("sandbox-policy-unavailable");
    active();
    const input = HtmlProtectionCloudInputSchema.parse({ schemaVersion: "html-protection-private-input-v1",
      nonce, request, material: physical, ownedRuntime: binding.data });
    const inputBytes = Buffer.from(canonical(input), "utf8");
    if (inputBytes.byteLength > limits.inputBytes) return unavailable("private-file-limit");
    await created.writeFiles([
      { path: paths.html, content: Buffer.from(physicalHtml), mode: 0o400 },
      { path: paths.bundle, content: Buffer.from(runtimeBytes), mode: 0o400 },
      { path: paths.input, content: inputBytes, mode: 0o600 },
      { path: paths.runner, content: Buffer.from(runner, "utf8"), mode: 0o400 },
    ], { signal: controller.signal });
    active();
    const stagedRuntime = await readBoundedHtmlProtectionPrivateFile(created, paths.bundle, limits.runtimeBytes, controller.signal); active();
    if (sha(stagedRuntime) !== binding.data.sha256 || stagedRuntime.byteLength !== binding.data.byteLength) return unavailable("runtime-integrity");
    const executed = await created.runCommand({
      cmd: "node", args: ["--max-old-space-size=512", paths.runner], cwd: "/vercel/sandbox",
      timeoutMs: 60_000, signal: controller.signal,
    });
    active();
    if (executed.exitCode !== 0) return unavailable("runtime-exit");
    const manifest = HtmlProtectionCloudManifestSchema.parse(parsePrivateJson(
      await readBoundedHtmlProtectionPrivateFile(created, paths.manifest, limits.manifestBytes, controller.signal)));
    active();
    if (manifest.nonce !== nonce || manifest.requestSha256 !== sha(canonical(request))) return unavailable("request-binding-mismatch");
    if (manifest.ownedRuntimeSha256 !== binding.data.sha256 || manifest.runnerSha256 !== sha(runner)) return unavailable("runtime-integrity");
    const bytes = await readBoundedHtmlProtectionPrivateFile(created, paths.result, limits.resultBytes, controller.signal);
    active();
    if (sha(bytes) !== manifest.result.sha256 || bytes.byteLength !== manifest.result.byteLength) return unavailable("private-file-integrity");
    const observation = HtmlProtectionCloudObservationSchema.parse(parsePrivateJson(bytes));
    if (observation.nonce !== nonce || !equal(observation.ownedRuntime, binding.data)) return unavailable("request-binding-mismatch");
    validateObservation(observation, request, physical);
    active(); return { availability: "available", observation, resultSha256: sha(bytes), resultByteLength: bytes.byteLength };
  })();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<HtmlProtectionCloudObservationResult>(resolve => {
      deadline = setTimeout(() => { closed = true; controller.abort(); resolve(unavailable("private-file-timeout")); }, limits.deadlineMs);
    })]);
  } catch (error) {
    return unavailable(error instanceof ReadGap ? error.code : error instanceof Error && error.message === "REQUEST_BINDING" ? "request-binding-mismatch" : "private-file-integrity");
  } finally {
    closed = true; if (deadline) clearTimeout(deadline); controller.abort();
    if (sandbox) await stopOwned(sandbox);
  }
}
