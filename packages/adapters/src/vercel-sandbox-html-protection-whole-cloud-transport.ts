import { randomBytes } from "node:crypto";
import { z } from "zod";
import { HTML_PROTECTION_WHOLE_RUNTIME_LIMITS as limits, HtmlProtectionWholeRuntimeRequestSchema,
  HtmlProtectionWholeRuntimeActionFactSchema, type HtmlProtectionWholeRuntimeRequest } from "@evolution/contracts";
import { readBoundedHtmlProtectionPrivateFile as read, type HtmlProtectionPreparedBrowserFactory } from "./vercel-sandbox-html-protection-cloud-transport";
import { HTML_PROTECTION_CLOUD_PATHS as paths, HTML_PROTECTION_CLOUD_LIMITS as oldLimits, HtmlProtectionOwnedRuntimeBindingSchema,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha } from "./vercel-sandbox-html-protection-cloud-protocol";
import { HTML_PROTECTION_WHOLE_PRIVATE_PATHS as wholePaths, HTML_PROTECTION_WHOLE_CLOUD_RUNNER_SCRIPT as runner,
  HtmlProtectionWholeCloudInputSchema, HtmlProtectionWholeCloudManifestSchema,
  type HtmlProtectionWholeCloudManifest, type HtmlProtectionWholePrivateRecord } from "./vercel-sandbox-html-protection-whole-cloud-protocol";
import { validateHtmlProtectionWholeReadback } from "./html-protection-whole-readback-validation";
import { htmlProtectionWholeRuntimeActions } from "@evolution/core";

export type HtmlProtectionWholeRecordReadback = { record: HtmlProtectionWholePrivateRecord; material: unknown };
/** The sink is trusted App composition and must persist/read back complete bytes before returning its reference. */
export type HtmlProtectionWholeRecordSink = (record: HtmlProtectionWholePrivateRecord, bytes: Uint8Array) => Promise<{ artifactId: string; sha256: string; byteLength: number }>;
export type HtmlProtectionWholeObservationResult = { availability: "available"; manifest: HtmlProtectionWholeCloudManifest;
  manifestSha256: string; manifestByteLength: number; records: Array<HtmlProtectionWholePrivateRecord & { artifactId: string }>;
} | { availability: "unavailable"; reason: string; request: HtmlProtectionWholeRuntimeRequest };
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const parse = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
type Sandbox = Awaited<ReturnType<NonNullable<HtmlProtectionPreparedBrowserFactory["createPreparedBrowserSandbox"]>>>;
/** Named ephemeral VM, pinned deployment bytes, independently re-read full bounded private parts; stdout is never consumed. */
export async function runVercelSandboxHtmlProtectionWholeObservation(args: {
  request: HtmlProtectionWholeRuntimeRequest; physicalHtml: Uint8Array; consumeRecord: HtmlProtectionWholeRecordSink;
}, ports: HtmlProtectionPreparedBrowserFactory = {}): Promise<HtmlProtectionWholeObservationResult> {
  const request = structuredClone(HtmlProtectionWholeRuntimeRequestSchema.parse(args.request)), consumeRecord = args.consumeRecord;
  const unavailable = (reason: string): HtmlProtectionWholeObservationResult => ({ availability: "unavailable", reason, request });
  const physical = args.physicalHtml.byteLength <= oldLimits.htmlBytes ? Buffer.from(args.physicalHtml) : undefined;
  const runtime = ports.trustedRuntimeBytes && ports.trustedRuntimeBytes.byteLength <= oldLimits.runtimeBytes ? Buffer.from(ports.trustedRuntimeBytes) : undefined;
  const binding = HtmlProtectionOwnedRuntimeBindingSchema.safeParse(ports.trustedRuntimeBinding), create = ports.createPreparedBrowserSandbox;
  if (!physical?.byteLength) return unavailable("physical-input-mismatch");
  if (!runtime || !binding.success || !create) return unavailable("missing-trusted-runtime");
  if (typeof consumeRecord !== "function") return unavailable("missing-trusted-private-record-sink");
  if (runtime.byteLength !== binding.data.byteLength || sha(runtime) !== binding.data.sha256) return unavailable("runtime-integrity");
  const nonce = randomBytes(32).toString("hex"), parsed = HtmlProtectionWholeCloudInputSchema.safeParse({
    schemaVersion: "html-protection-whole-private-input-v1", nonce, request, ownedRuntime: binding.data,
    material: { sha256: sha(physical), byteLength: physical.byteLength } });
  if (!parsed.success) return unavailable("physical-input-or-plan-mismatch");
  const input = parsed.data, inputBytes = Buffer.from(canonical(input)), inputSha = sha(inputBytes), name = "evo-protection-whole-" + nonce.slice(0, 24);
  const controller = new AbortController(), deadline = Date.now() + limits.deadlineMs;
  let sandbox: Sandbox | undefined, closed = false, timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Set<Sandbox>();
  const stop = async (owned: Sandbox) => {
    if (owned.name !== name || owned.persistent !== false || stopped.has(owned)) return;
    stopped.add(owned); const cleanup = new AbortController(), cleanupTimer = setTimeout(() => cleanup.abort(), 5000);
    try { await Promise.race([owned.stop({ signal: cleanup.signal }), new Promise<void>(resolve => cleanup.signal.addEventListener("abort", () => resolve(), { once: true }))]); }
    catch { /* Stop only the newly named resource whose handle actually returned. */ } finally { clearTimeout(cleanupTimer); }
  };
  const active = () => { if (closed || controller.signal.aborted || Date.now() >= deadline) throw Error("private-file-timeout"); };
  const operation = (async (): Promise<HtmlProtectionWholeObservationResult> => {
    const created = await create({ name, persistent: false, networkPolicy: "deny-all", timeout: limits.deadlineMs, signal: controller.signal });
    if (closed || controller.signal.aborted || Date.now() >= deadline) { await stop(created); return unavailable("private-file-timeout"); }
    sandbox = created;
    if (created.name !== name || created.persistent !== false || created.cwd !== "/vercel/sandbox" || created.currentSession().networkPolicy !== "deny-all") return unavailable("sandbox-policy-unavailable");
    await created.writeFiles([{ path: paths.html, content: physical, mode: 0o400 }, { path: paths.bundle, content: runtime, mode: 0o400 },
      { path: wholePaths.input, content: inputBytes, mode: 0o600 }, { path: wholePaths.runner, content: Buffer.from(runner), mode: 0o400 }], { signal: controller.signal }); active();
    const staged = await read(created, paths.bundle, oldLimits.runtimeBytes, controller.signal); active();
    if (sha(staged) !== binding.data.sha256 || staged.byteLength !== binding.data.byteLength) return unavailable("runtime-integrity");
    const execution = await created.runCommand({ cmd: "node", args: ["--max-old-space-size=512", wholePaths.runner], cwd: "/vercel/sandbox",
      timeoutMs: limits.deadlineMs - 10_000, signal: controller.signal }); active();
    if (execution.exitCode !== 0) return unavailable("runtime-exit");
    const manifestBytes = await read(created, wholePaths.manifest, oldLimits.resultBytes, controller.signal); active();
    const manifest = HtmlProtectionWholeCloudManifestSchema.parse(parse(manifestBytes));
    if (manifest.nonce !== nonce || manifest.inputSha256 !== inputSha || !equal(manifest.request, request)
      || manifest.ownedRuntimeSha256 !== binding.data.sha256 || manifest.runnerSha256 !== sha(runner)) return unavailable("request-runtime-binding-mismatch");
    if (manifest.registration && !equal(manifest.expectedActions, htmlProtectionWholeRuntimeActions(request.sourcePlan, manifest.registration))) return unavailable("actual-action-plan-mismatch");
    if (manifest.custody) for (const seen of [manifest.custody.staged, manifest.custody.nodeResponse, manifest.custody.browserResponse]) {
      if (!equal(seen, input.material)) return unavailable("physical-custody-mismatch");
    }
    const records: Extract<HtmlProtectionWholeObservationResult, { availability: "available" }>["records"] = [];
    const readbacks: HtmlProtectionWholeRecordReadback[] = [];
    let actualCount = 0, bootSeen = false, aggregate = 0;
    const documentStates = new Set<string>();
    for (const record of manifest.records) {
      active();
      const parts: Buffer[] = [];
      for (const part of record.parts) {
        const bytes = await read(created, part.path, limits.partBytes, controller.signal); active();
        if (sha(bytes) !== part.sha256 || bytes.byteLength !== part.byteLength) return unavailable("private-part-integrity"); parts.push(bytes);
      }
      const bytes = Buffer.concat(parts, record.byteLength); aggregate += bytes.byteLength;
      if (sha(bytes) !== record.sha256 || bytes.byteLength !== record.byteLength || aggregate > limits.aggregateBytes) return unavailable("private-record-integrity");
      const material = parse(bytes);
      if (record.kind === "action") {
        const fact = HtmlProtectionWholeRuntimeActionFactSchema.parse(material), expected = manifest.expectedActions[actualCount++];
        if (!equal(fact.action, expected) || fact.action.stateId !== record.stateId) return unavailable("foreign-or-out-of-order-action-record");
        if (fact.nativeObservation) {
          const encoded = Buffer.from(canonical(fact.nativeObservation));
          if (sha(encoded) !== fact.nativeObservationSha256 || encoded.byteLength !== fact.nativeObservationByteLength) return unavailable("private-native-material-integrity");

        }
      } else if (record.kind === "boot-census") {
        if (bootSeen || actualCount) return unavailable("native-boot-record-order"); bootSeen = true;

        if (request.sourceRole === "original" && record.sha256 !== manifest.registration?.nativeBootSha256) return unavailable("original-boot-registration-mismatch");
      } else if (record.kind === "document") {
        if (documentStates.has(record.stateId) || !manifest.expectedActions.some(action => action.stateId === record.stateId && ["boot", "viewport"].includes(action.operation))) return unavailable("unregistered-document-state");
        documentStates.add(record.stateId);
      }
      readbacks.push({ record: structuredClone(record), material });
    }
    if (actualCount !== manifest.actualActionCount || (manifest.registration && !bootSeen)
      || (manifest.availability === "available" && manifest.expectedActions.filter(action => ["boot", "viewport"].includes(action.operation)).some(action => !documentStates.has(action.stateId)))) return unavailable("complete-native-record-set-missing");
    validateHtmlProtectionWholeReadback({ manifest, records: readbacks, expectedRequest: request, trustedRuntimeBinding: binding.data });
    // Persist only after the complete physical set and native producer relations have been independently checked.
    for (const { record, material } of readbacks) {
      active(); const bytes = Buffer.from(canonical(material));
      const saved = z.object({ artifactId: z.string().min(1).max(512), sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive() }).strict().parse(await consumeRecord(structuredClone(record), Buffer.from(bytes))); active();
      if (saved.sha256 !== record.sha256 || saved.byteLength !== record.byteLength) return unavailable("private-artifact-readback-mismatch");
      records.push({ ...record, artifactId: saved.artifactId });
    }
    active(); return { availability: "available", manifest, manifestSha256: sha(manifestBytes), manifestByteLength: manifestBytes.byteLength, records };
  })();
  try { return await Promise.race([operation, new Promise<HtmlProtectionWholeObservationResult>(resolve => {
    timer = setTimeout(() => { closed = true; controller.abort(); resolve(unavailable("private-file-timeout")); }, limits.deadlineMs);
  })]); } catch { return unavailable(controller.signal.aborted ? "private-file-timeout" : "private-file-integrity"); }
  finally { closed = true; if (timer) clearTimeout(timer); controller.abort(); if (sandbox) await stop(sandbox); }
}
