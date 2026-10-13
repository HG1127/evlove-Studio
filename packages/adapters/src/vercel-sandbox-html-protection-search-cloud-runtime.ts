import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { BrowserType, Browser } from "@playwright/test";
import { HTML_PROTECTION_SEARCH_STATE_LIMITS, HtmlProtectionSnapshotResultSchema, HtmlProtectionSnapshotLimitations } from "@evolution/contracts";
import { withOwnedHtmlProtectionDocument, OwnedHtmlProtectionDocumentGap, type HtmlProtectionOwnedDocument } from "./html-protection-owned-document";
import { HtmlProtectionPrivateFileGap, readOwnedHtmlProtectionPrivateFile as readFixed, writeOwnedHtmlProtectionPrivateFile as writeFixed } from "./html-protection-private-files";
import { createHtmlProtectionSearchNativeInput } from "./html-protection-search-native-input";
import { createHtmlProtectionSearchStateSession } from "./html-protection-search-state";
import { collectVercelSandboxHtmlProtectionSnapshot, type HtmlProtectionSnapshotCdpPort } from "./vercel-sandbox-html-protection-snapshot";
import { HTML_PROTECTION_CLOUD_PATHS as paths, HTML_PROTECTION_CLOUD_LIMITS as limits,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha } from "./vercel-sandbox-html-protection-cloud-protocol";
import { HtmlProtectionSearchCloudInputSchema, HtmlProtectionSearchCloudObservationSchema, HtmlProtectionSearchCloudManifestSchema,
  htmlProtectionSearchCloudInputSha256, type HtmlProtectionSearchCloudInput, type HtmlProtectionSearchCloudStep,
  type HtmlProtectionSearchCloudObservation, type HtmlProtectionSearchCloudGapSchema } from "./vercel-sandbox-html-protection-search-cloud-protocol";
import type { z } from "zod";

type Reason = z.infer<typeof HtmlProtectionSearchCloudGapSchema>;
class SearchRuntimeGap extends Error {
  readonly code: Reason;
  constructor(code: Reason) { super(code); this.code = code; }
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function material(bytes: Uint8Array) { return { sha256: sha(bytes), byteLength: bytes.byteLength }; }

/** One fixed owned Page performs the complete closed sequence. This never signs or settles protection. */
async function observeSearch(chromium: BrowserType<Browser>, input: HtmlProtectionSearchCloudInput, html: Buffer): Promise<HtmlProtectionSearchCloudObservation> {
  const base = { schemaVersion: "html-protection-private-search-observation-v1" as const, nonce: input.nonce,
    request: input.request, batchRequestSha256: htmlProtectionSearchCloudInputSha256(input), ownedRuntime: input.ownedRuntime, input };
  const collected: HtmlProtectionSearchCloudStep[] = [];
  let readCustody: HtmlProtectionOwnedDocument["readCustody"] | undefined;
  let session: ReturnType<typeof createHtmlProtectionSearchStateSession> | undefined;
  const remaining = () => input.stateRequests.slice(collected.length).map(stateRequest => ({
    status: "not-executed" as const, stateRequest, reason: "prior-step-unavailable" as const,
  }));
  const result = (reason?: Reason) => HtmlProtectionSearchCloudObservationSchema.parse({ ...base,
    ...(reason ? { availability: "unavailable", phase: "after-startup", reason } : { availability: "available" }),
    custody: readCustody!(), steps: [...collected, ...remaining()],
  });
  try {
    return await withOwnedHtmlProtectionDocument({ chromium, physicalHtml: html, expectedMaterial: input.material, consume: async owned => {
      readCustody = owned.readCustody;
      const deadline = Math.min(owned.deadline, Date.now() + HTML_PROTECTION_SEARCH_STATE_LIMITS.caseTimeoutMs);
      const expected = { ...input.stateRequests[0],
        frameId: owned.custody.navigation.frameId, loaderId: owned.custody.navigation.loaderId };
      // Session construction takes shared anchors only; no stateId/stateKind belongs to its fixed session shape.
      const { stateId: _stateId, stateKind: _stateKind, schemaVersion: _version, ...sessionExpected } = expected; void _stateId; void _stateKind; void _version;
      const nativeInput = createHtmlProtectionSearchNativeInput({ page: owned.page, expected: sessionExpected,
        servedDocument: { frameId: owned.custody.navigation.frameId, loaderId: owned.custody.navigation.loaderId,
          url: owned.custody.documentUrl, physicalInput: owned.custody.browserResponse },
        registeredCssSelector: input.registration.registry.inputSelector, caseDeadline: deadline, signal: owned.signal });
      session = createHtmlProtectionSearchStateSession({ page: owned.page, expected: sessionExpected,
        originalRegistration: input.registration, nativeInput, caseDeadline: deadline });
      const active = () => { if (owned.signal.aborted || Date.now() >= deadline) throw new SearchRuntimeGap("case-timeout"); };
      try {
        for (let index = 0; index < 4; index++) {
          active(); await owned.assertCurrent(); active();
          const stateRequest = input.stateRequests[index]!, request = input.snapshotRequests[index]!;
          const actionFacts = await session.execute(stateRequest, owned.signal);
          if (!actionFacts.executionRecorded) {
            collected.push({ status: "action-failed", stateRequest, actionFacts: { ...actionFacts, executionRecorded: false } });
            return result("state-execution-unavailable");
          }
          // Actual native collector owns its own bounded CDP window. Keep any unavailable/partial result.
          let snapshotTimer: ReturnType<typeof setTimeout> | undefined, abortSnapshot: (() => void) | undefined;
          const snapshot = await (async () => {
            try {
              active();
              return await Promise.race([
                collectVercelSandboxHtmlProtectionSnapshot({ request, physicalHtml: html, createSession: async () => {
                  active(); const port = await owned.context.newCDPSession(owned.page);
                  try { active(); } catch (error) { void port.detach().catch(() => {}); throw error; }
                  return port as unknown as HtmlProtectionSnapshotCdpPort;
                } }),
                new Promise<never>((_, reject) => {
                  const stop = () => reject(new SearchRuntimeGap("case-timeout"));
                  snapshotTimer = setTimeout(stop, Math.max(1, deadline - Date.now()));
                  abortSnapshot = stop; owned.signal.addEventListener("abort", stop, { once: true });
                  if (owned.signal.aborted) stop();
                }),
              ]);
            } catch {
              // A real attempted read failed. No selected body/native realm is invented; action facts remain intact.
              return HtmlProtectionSnapshotResultSchema.parse({ schemaVersion: "html-protection-snapshot-result-v1", request,
                availability: "unavailable", projectionComplete: false, physicalInput: input.material,
                observedAt: new Date().toISOString(), gaps: [{ code: "capability-unavailable" }], limitations: [...HtmlProtectionSnapshotLimitations] });
            } finally { if (snapshotTimer) clearTimeout(snapshotTimer); if (abortSnapshot) owned.signal.removeEventListener("abort", abortSnapshot); }
          })();
          const snapshotBytes = Buffer.from(canonical(snapshot), "utf8");
          const rejected = (reason: "aggregate-private-file-limit" | "document-binding-mismatch") => ({
            status: "observation-rejected" as const, stateRequest, actionFacts: { ...actionFacts, executionRecorded: true as const },
            rejectedSnapshot: { sha256: sha(snapshotBytes), byteLength: snapshotBytes.byteLength, reason },
          });
          if (snapshot.realm && (snapshot.realm.frameId !== owned.custody.navigation.frameId || snapshot.realm.loaderId !== owned.custody.navigation.loaderId)) {
            collected.push(rejected("document-binding-mismatch")); return result("served-material-mismatch");
          }
          const linkFacts = await session.linkSnapshot({ page: owned.page, snapshot }, owned.signal);
          const observed = { status: "observed" as const, stateRequest, actionFacts, snapshot, linkFacts };
          const rest = input.stateRequests.slice(index + 1).map(state => ({ status: "not-executed", stateRequest: state, reason: "prior-step-unavailable" }));
          // Reserve bounded terminal/failure metadata. Reject a whole native body; never crop it and call it available.
          const proposed = { ...base, availability: "unavailable", phase: "after-startup", reason: "case-timeout",
            custody: readCustody!(), steps: [...collected, observed, ...rest] };
          if (Buffer.byteLength(canonical(proposed), "utf8") > limits.resultBytes - limits.inputBytes) {
            collected.push(rejected("aggregate-private-file-limit")); return result("private-file-limit");
          }
          collected.push(observed);
          if (!linkFacts.linked) return result("snapshot-unavailable");
          active(); await owned.assertCurrent(); active();
        }
        return result();
      } finally { nativeInput.dispose(); }
    } });
  } catch (error) {
    const reason: Reason = error instanceof SearchRuntimeGap ? error.code : error instanceof OwnedHtmlProtectionDocumentGap ? (error.code === "observation-unavailable" ? "case-timeout" : error.code) : "observation-unavailable";
    if (!readCustody) return HtmlProtectionSearchCloudObservationSchema.parse({ ...base, availability: "unavailable", phase: "before-startup", reason });
    // A guard can fail before dispatching the next state. Record no fill/native observation for that state.
    if (collected.length < 4 && (collected.length === 0 || (collected.at(-1)?.status === "observed" && (collected.at(-1) as Extract<HtmlProtectionSearchCloudStep, {status:"observed"}>).linkFacts.linked))) {
      const stateRequest = input.stateRequests[collected.length]!;
      collected.push({ status: "action-failed", stateRequest,
        actionFacts: { request: stateRequest, fillCalls: 0, fillSettled: false, executionRecorded: false, gaps: ["session-unavailable"] } });
    }
    return result(reason);
  } finally { session?.dispose(); }
}

async function executePrivateSearch(args: { chromium: BrowserType<Browser>; workingDirectory: string }) {
  const root = join(args.workingDirectory, dirname(paths.input)); await mkdir(root, { recursive: true, mode: 0o700 });
  const input = HtmlProtectionSearchCloudInputSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
    await readFixed(join(args.workingDirectory, paths.input), limits.inputBytes))));
  const runtime = await readFixed(join(args.workingDirectory, paths.bundle), limits.runtimeBytes);
  const runner = await readFixed(join(args.workingDirectory, paths.runner), limits.inputBytes);
  let observation: HtmlProtectionSearchCloudObservation | undefined, physicalHtml: Buffer | undefined;
  try {
    if (!equal(material(runtime), { sha256: input.ownedRuntime.sha256, byteLength: input.ownedRuntime.byteLength })) throw new SearchRuntimeGap("runtime-integrity");
    const html = await readFixed(join(args.workingDirectory, paths.html), limits.htmlBytes);
    if (!equal(material(html), input.material)) throw new SearchRuntimeGap("staged-material-mismatch");
    physicalHtml = html;
  } catch (error) {
    observation = HtmlProtectionSearchCloudObservationSchema.parse({ schemaVersion: "html-protection-private-search-observation-v1",
      nonce: input.nonce, request: input.request, batchRequestSha256: htmlProtectionSearchCloudInputSha256(input),
      ownedRuntime: input.ownedRuntime, input, availability: "unavailable", phase: "before-startup",
      reason: error instanceof SearchRuntimeGap || error instanceof HtmlProtectionPrivateFileGap ? error.code : "observation-unavailable" });
  }
  if (physicalHtml) observation = await observeSearch(args.chromium, input, physicalHtml);
  if (!observation) throw new Error("Missing private search observation");
  const bytes = Buffer.from(canonical(observation), "utf8");
  if (bytes.byteLength > limits.resultBytes) throw new Error("Private search result limit exceeded");
  await writeFixed(join(args.workingDirectory, paths.result), bytes);
  const manifest = HtmlProtectionSearchCloudManifestSchema.parse({ schemaVersion: "html-protection-private-search-manifest-v1",
    nonce: input.nonce, batchRequestSha256: htmlProtectionSearchCloudInputSha256(input),
    ownedRuntimeSha256: sha(runtime), runnerSha256: sha(runner),
    result: { path: paths.result, sha256: sha(bytes), byteLength: bytes.byteLength } });
  await writeFixed(join(args.workingDirectory, paths.manifest), Buffer.from(canonical(manifest), "utf8"));
}

/** Fixed Sandbox entry only. Physical user HTML must never be executed in the host process. */
export async function runPrivateHtmlProtectionSearchCloudRuntime(args: { chromium: BrowserType<Browser>; workingDirectory: string }) {
  try { await executePrivateSearch(args); } catch { throw new Error("Private search runtime unavailable"); }
}