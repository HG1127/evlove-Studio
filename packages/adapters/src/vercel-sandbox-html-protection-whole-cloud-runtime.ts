import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { BrowserType, Browser } from "@playwright/test";
import { z } from "zod";
import { HTML_PROTECTION_WHOLE_RUNTIME_LIMITS as limits, HtmlProtectionWholeRuntimeRegistrationSchema,
  HtmlProtectionWholeRuntimeActionFactSchema, type HtmlProtectionWholeRuntimeAction, type HtmlProtectionWholeRuntimeRegistration } from "@evolution/contracts";
import { htmlProtectionWholeRuntimeActions, htmlProtectionWholeSubjectScriptLocations } from "@evolution/core";
import { createOwnedHtmlProtectionScriptCoverage, type HtmlProtectionOwnedScriptCoverage } from "./html-protection-whole-script-coverage";
import { collectOwnedHtmlProtectionVisualTiles } from "./html-protection-whole-visual-tiles";
import { withOwnedHtmlProtectionDocument, type HtmlProtectionOwnedDocument } from "./html-protection-owned-document";
import { readOwnedHtmlProtectionPrivateFile as read, writeOwnedHtmlProtectionPrivateFile as write } from "./html-protection-private-files";
import { createHtmlProtectionWholeNativeObserver, HtmlProtectionWholeNativeGap, type HtmlProtectionWholeNativeObserver } from "./html-protection-whole-native-observer";
import { HTML_PROTECTION_CLOUD_PATHS as paths, HTML_PROTECTION_CLOUD_LIMITS as oldLimits,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha } from "./vercel-sandbox-html-protection-cloud-protocol";
import { HTML_PROTECTION_WHOLE_PRIVATE_PATHS as wholePaths, HtmlProtectionWholeCloudInputSchema,
  HtmlProtectionWholeCloudManifestSchema, HtmlProtectionWholePrivateRecordSchema,
  type HtmlProtectionWholeCloudInput, type HtmlProtectionWholePrivateRecord } from "./vercel-sandbox-html-protection-whole-cloud-protocol";

const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
const Target = z.object({ target: z.object({ tag: z.string(), namespace: z.string(), attributes: z.array(z.tuple([z.string(), z.string()])),
  value: z.string().optional() }).passthrough() }).passthrough();
function validateTarget(material: unknown, control: HtmlProtectionWholeRuntimeRegistration["controls"][number]) {
  const value = Target.parse(material).target;
  if (value.tag !== control.tag || value.namespace !== control.namespace) throw new HtmlProtectionWholeNativeGap("registered-control-identity-mismatch");
  const actual = new Map(value.attributes);
  for (const [name, expected] of control.attributes) if (!["class", "style", "open", "aria-expanded", "aria-checked"].includes(name)
    && actual.get(name) !== expected) throw new HtmlProtectionWholeNativeGap("registered-control-identity-mismatch");
  for (const name of control.classNames) if (!["checked", "active", "in-view"].includes(name)
    && !(actual.get("class") ?? "").split(/\s+/).includes(name)) throw new HtmlProtectionWholeNativeGap("registered-control-identity-mismatch");
}
async function executeAction(owned: HtmlProtectionOwnedDocument, native: HtmlProtectionWholeNativeObserver,
  action: HtmlProtectionWholeRuntimeAction, registration: HtmlProtectionWholeRuntimeRegistration) {
  const startedAt = new Date().toISOString(), control = registration.controls.find(item => item.targetId === action.targetId);
  let dispatched = 0, settled = false, beforeBackendNodeId: number | null = null, afterBackendNodeId: number | null = null;
  const partial: { before?: unknown; after?: unknown; clipboard?: unknown; navigation?: unknown; events?: unknown; dispatchTrace?: unknown[] } = {};
  const actualDispatch = () => { dispatched = 1; };
  const active = async () => { if (owned.signal.aborted || Date.now() >= owned.deadline) throw new HtmlProtectionWholeNativeGap("action-deadline"); await owned.assertCurrent(); };
  try {
    await active();
    beforeBackendNodeId = await native.backendNodeId(action.selector);
    const before = await native.target(action.selector); partial.before = before; if (control) validateTarget(before.value, control);
    if (control && ["click", "copy", "fill"].includes(action.operation)) partial.events = await native.events(action.selector);
    let navigation: { selector: string; fragment: string; beforeBackendNodeId: number; afterBackendNodeId?: number; before: unknown; after?: unknown } | undefined;
    if (action.intent === "navigate") {
      if (!control || !action.value || action.value !== control.href || !action.value.startsWith("#") || action.value.length < 2) throw new HtmlProtectionWholeNativeGap("actual-anchor-target-unregistered");
      let id: string; try { id = decodeURIComponent(action.value.slice(1)); } catch { throw new HtmlProtectionWholeNativeGap("actual-anchor-fragment-unresolved"); }
      const selector = '[id="' + Array.from(id, character => "\\" + character.codePointAt(0)!.toString(16) + " ").join("") + '"]';
      navigation = { selector, fragment: id, beforeBackendNodeId: await native.backendNodeId(selector), before: await native.target(selector) }; partial.navigation = navigation;
    }
    let clipboard: { text: string; sentinelSha256: string } | undefined;
    let dispatchTrace: unknown[] = [];
    if (action.operation === "copy") {
      await owned.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(owned.custody.documentUrl).origin });
      const sentinel = "evolution-native-whole-" + randomUUID(); await native.clipboardWrite(sentinel);
      if ((await native.clipboardRead()).text !== sentinel) throw new HtmlProtectionWholeNativeGap("clipboard-native-preflight-mismatch");
      await active(); dispatchTrace = await native.input(action.selector, "click", undefined, actualDispatch); await active();
      const deadline = Math.min(owned.deadline, Date.now() + limits.actionTimeoutMs);
      let text = sentinel;
      while (Date.now() < deadline && text === sentinel) { text = (await native.clipboardRead()).text; if (text === sentinel) await delay(25); }
      if (text === sentinel) throw new HtmlProtectionWholeNativeGap("clipboard-no-native-write-observed");
      clipboard = { text, sentinelSha256: sha(sentinel) }; partial.clipboard = clipboard; settled = true;
    } else if (action.operation === "viewport") {
      if (!action.viewport) throw new HtmlProtectionWholeNativeGap("viewport-unregistered");
      await owned.page.setViewportSize(action.viewport); dispatched = 1; settled = true;
    } else if (action.operation === "fill") {
      if (!control || control.kind !== "search" || action.value === undefined) throw new HtmlProtectionWholeNativeGap("input-unregistered");
      dispatchTrace = await native.input(action.selector, "fill", action.value, actualDispatch); settled = true;
    } else if (action.operation === "hover") { dispatchTrace = await native.input(action.selector, action.intent === "hover-leave" ? "leave" : "hover", undefined, actualDispatch); settled = true; }
    else if (action.operation === "scroll") { dispatchTrace = await native.input(action.selector, "scroll", undefined, actualDispatch); settled = true; }
    else if (action.operation === "click") { dispatchTrace = await native.input(action.selector, "click", undefined, actualDispatch); settled = true; }
    else settled = true;
    partial.dispatchTrace = dispatchTrace;
    await active();
    // The actual source uses IntersectionObserver, CSS transitions and native smooth navigation.
    // Wait for a bounded quiet native material interval; never repeat an action or force a page state.
    let after: Awaited<ReturnType<typeof native.target>> | undefined, quiet = 0, last = "";
    const settlingDeadline = Math.min(owned.deadline, Date.now() + limits.actionTimeoutMs);
    while (Date.now() < settlingDeadline && quiet < 3) {
      try { const observation = await native.target(action.selector), encoded = sha(canonical(observation.value));
        quiet = encoded === last ? quiet + 1 : 0; last = encoded; after = observation; partial.after = observation;
      } catch (error) { if (!(error instanceof HtmlProtectionWholeNativeGap) || error.code !== "native-document-unstable") throw error; quiet = 0; }
      if (quiet < 3) await delay(50);
    }
    if (!after || quiet < 3) throw new HtmlProtectionWholeNativeGap("action-native-settlement-unavailable");
    afterBackendNodeId = await native.backendNodeId(action.selector);
    if (beforeBackendNodeId !== afterBackendNodeId) throw new HtmlProtectionWholeNativeGap("registered-control-replaced");
    if (control) validateTarget(after.value, control);
    validateActualState(action, after.value);
    if (navigation) {
      navigation.afterBackendNodeId = await native.backendNodeId(navigation.selector); navigation.after = await native.target(navigation.selector);
      if (navigation.beforeBackendNodeId !== navigation.afterBackendNodeId) throw new HtmlProtectionWholeNativeGap("actual-anchor-target-replaced");
      validateActualNavigation(navigation.fragment, (navigation.after as Awaited<ReturnType<typeof native.target>>).value);
    }
    if (action.operation === "fill" && Target.parse(after.value).target.value !== action.value) throw new HtmlProtectionWholeNativeGap("actual-input-value-mismatch");
    await active();
    const nativeObservation = { before, after, dispatchTrace, ...(partial.events ? { events: partial.events } : {}), ...(clipboard ? { clipboard } : {}), ...(navigation ? { navigation } : {}) }, bytes = Buffer.from(canonical(nativeObservation));
    return HtmlProtectionWholeRuntimeActionFactSchema.parse({ action, status: "observed", dispatched, settled, startedAt,
      completedAt: new Date().toISOString(), beforeBackendNodeId, afterBackendNodeId, nativeObservation,
      nativeObservationSha256: sha(bytes), nativeObservationByteLength: bytes.byteLength, gaps: [] });
  } catch (error) {
    return HtmlProtectionWholeRuntimeActionFactSchema.parse({ action, status: "failed", dispatched, settled, startedAt,
      completedAt: new Date().toISOString(), beforeBackendNodeId, afterBackendNodeId,
      ...(Object.keys(partial).length ? { nativeObservation: partial, nativeObservationSha256: sha(canonical(partial)), nativeObservationByteLength: Buffer.byteLength(canonical(partial)) } : {}),
      gaps: [error instanceof HtmlProtectionWholeNativeGap ? error.code : "actual-browser-action-unavailable"] });
  }
}

/** Actual one-Page complete sequence; preserves failed prefix and stops rather than inventing later states. */
export async function observeOwnedHtmlProtectionWholeRuntime(args: {
  chromium: BrowserType<Browser>; input: HtmlProtectionWholeCloudInput; physicalHtml: Buffer;
  writeRecord: (record: { kind: HtmlProtectionWholePrivateRecord["kind"]; stateId: string; value: unknown }) => Promise<HtmlProtectionWholePrivateRecord>;
}) {
  const input = structuredClone(HtmlProtectionWholeCloudInputSchema.parse(args.input)), records: HtmlProtectionWholePrivateRecord[] = [];
  let registration: HtmlProtectionWholeRuntimeRegistration | undefined, custody: HtmlProtectionOwnedDocument["custody"] | undefined;
  let expectedActions: HtmlProtectionWholeRuntimeAction[] = [], actualActionCount = 0;
  let scriptCoverage: HtmlProtectionOwnedScriptCoverage | undefined;
  const collectionGaps = new Set<string>();
  const finish = (reason?: string) => HtmlProtectionWholeCloudManifestSchema.parse({
    schemaVersion: "html-protection-whole-private-manifest-v1", nonce: input.nonce, inputSha256: sha(canonical(input)),
    ownedRuntimeSha256: input.ownedRuntime.sha256, runnerSha256: "0".repeat(64), request: input.request,
    ...(registration ? { registration } : {}), ...(custody ? { custody } : {}), availability: reason || collectionGaps.size ? "unavailable" : "available", ...(reason || collectionGaps.size ? { reason: reason ?? [...collectionGaps][0] } : {}),
    expectedActions, records, actualActionCount, aggregateByteLength: records.reduce((sum, record) => sum + record.byteLength, 0),
    gaps: [...input.request.sourcePlan.gaps, ...(registration?.gaps ?? []), ...collectionGaps, ...(reason ? [reason] : [])],
  });
  const write = async (kind: HtmlProtectionWholePrivateRecord["kind"], stateId: string, value: unknown) => {
    const record = await args.writeRecord({ kind, stateId, value }); records.push(record);
    if (records.reduce((sum, item) => sum + item.byteLength, 0) > limits.aggregateBytes) throw new HtmlProtectionWholeNativeGap("aggregate-private-capacity-unavailable");
  };
  const closeCoverage = async (owned: HtmlProtectionOwnedDocument) => {
    if (!scriptCoverage) return;
    const coverage = scriptCoverage; scriptCoverage = undefined;
    try {
      await owned.assertCurrent(); const material = await coverage.collect({ sourcePlan: input.request.sourcePlan, subjectScriptLocations: input.request.subjectScriptLocations, frameId: owned.custody.navigation.frameId, documentUrl: owned.custody.documentUrl });
      await write("script-coverage", "source-program-coverage", material);
      for (const gap of material.gaps) collectionGaps.add(gap);
    }
    catch (error) { collectionGaps.add(error instanceof HtmlProtectionWholeNativeGap ? error.code : error instanceof z.ZodError ? "actual-script-coverage-schema-invalid" : "actual-native-script-coverage-unavailable"); }
    finally { await coverage.dispose(); }
  };
  try {
    if (canonical(input.request.subjectScriptLocations) !== canonical(htmlProtectionWholeSubjectScriptLocations({ sourcePlan: input.request.sourcePlan, html: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(args.physicalHtml) }))) throw new HtmlProtectionWholeNativeGap("physical-script-occurrence-plan-mismatch");
    return await withOwnedHtmlProtectionDocument({ chromium: args.chromium, physicalHtml: args.physicalHtml,
      expectedMaterial: input.material, runtimeDeadlineMs: limits.deadlineMs,
      beforeOwnedNavigation: async args => { scriptCoverage = await createOwnedHtmlProtectionScriptCoverage(args); }, consume: async owned => {
        custody = owned.readCustody(); await owned.page.setViewportSize({ width: 1280, height: 900 });
        const native = await createHtmlProtectionWholeNativeObserver({ ...owned, frameId: owned.custody.navigation.frameId,
          loaderId: owned.custody.navigation.loaderId, documentUrl: owned.custody.documentUrl });
        try {
          // Native scripts and CSS may still be completing their actual boot effects. No state is overwritten.
          let census: Awaited<ReturnType<typeof native.census>> | undefined;
          for (let attempt = 0; attempt < 40 && !census; attempt++) {
            try { census = await native.census(); } catch (error) {
              if (!(error instanceof HtmlProtectionWholeNativeGap) || error.code !== "native-document-unstable") throw error;
              await delay(50);
            }
          }
          if (!census) throw new HtmlProtectionWholeNativeGap("original-native-boot-unavailable");
          const value = z.object({ controls: HtmlProtectionWholeRuntimeRegistrationSchema.shape.controls,
            revealTargets: HtmlProtectionWholeRuntimeRegistrationSchema.shape.revealTargets,
            elementCount: z.number().int().positive().max(limits.nodes), gaps: z.array(z.string()) }).strict().parse(census.value);
          await write("boot-census", "native-boot-census", census);
          if (input.request.sourceRole === "original") registration = HtmlProtectionWholeRuntimeRegistrationSchema.parse({
            schemaVersion: "html-protection-owned-boot-registration-v1", original: input.request.binding.original,
            sourcePlanSha256: input.request.sourcePlanSha256, nativeBootSha256: sha(canonical(census)), nativeElementCount: value.elementCount,
            controls: value.controls, revealTargets: value.revealTargets, gaps: value.gaps });
          else {
            registration = HtmlProtectionWholeRuntimeRegistrationSchema.parse(input.request.registration);
            // New controls are a recorded mismatch; they never expand Original authority.
            const expected = registration.controls.map(control => ({ selector: control.selector, tag: control.tag, kind: control.kind, id: control.id, ownerCardId: control.ownerCardId, href: control.href }));
            const observed = value.controls.map(control => ({ selector: control.selector, tag: control.tag, kind: control.kind, id: control.id, ownerCardId: control.ownerCardId, href: control.href }));
            if (canonical(expected) !== canonical(observed)) throw new HtmlProtectionWholeNativeGap("executed-native-control-census-mismatch");
          }
          expectedActions = htmlProtectionWholeRuntimeActions(input.request.sourcePlan, registration);
          if (expectedActions.length > limits.states) throw new HtmlProtectionWholeNativeGap("action-plan-capacity-unavailable");
          for (const action of expectedActions) {
            await owned.assertCurrent();
            const fact = await executeAction(owned, native, action, registration);
            await write("action", action.stateId, fact);
            actualActionCount++;
            if (fact.status !== "observed") { custody = owned.readCustody(); await closeCoverage(owned); return finish(fact.gaps[0] ?? "action-unavailable"); }
            if (["boot", "viewport"].includes(action.operation)) {
              await write("document", action.stateId, await native.document());
              await collectOwnedHtmlProtectionVisualTiles({ owned, native, stateId: action.stateId, writeTile: (id, material) => write("visual-tile", id, material) });
            }
          }
          await owned.assertCurrent(); custody = owned.readCustody(); await closeCoverage(owned); return finish();
        } finally {
          await closeCoverage(owned);
          await native.dispose();
        }
      } });
  } catch (error) {
    if (error instanceof HtmlProtectionWholeNativeGap && error.diagnostic) await write("diagnostic", "native-window-diagnostic", { phase: "native-window", code: error.code, diagnostic: error.diagnostic });
    const code = error instanceof HtmlProtectionWholeNativeGap ? error.code : error instanceof z.ZodError ? "whole-runtime-schema-boundary-invalid" : "whole-observation-unavailable";
    if (error instanceof z.ZodError) await write("diagnostic", "runtime-boundary-diagnostic", { phase: "whole-runtime", errorType: "ZodError", issues: error.issues.map(issue => ({ code: issue.code, path: issue.path.map(part => typeof part === "number" ? part : String(part)).slice(0, 12) })) });
    return finish(code);
  }
  finally { if (scriptCoverage) await scriptCoverage.dispose(); }
}
export async function runPrivateHtmlProtectionWholeCloudRuntime(args: { chromium: BrowserType<Browser>; workingDirectory: string }) {
  const root = args.workingDirectory;
  await mkdir(join(root, wholePaths.partRoot), { recursive: true, mode: 0o700 });
  const input = HtmlProtectionWholeCloudInputSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await read(join(root, wholePaths.input), 2 * 1024 * 1024))));
  const html = await read(join(root, paths.html), oldLimits.htmlBytes), runtime = await read(join(root, paths.bundle), oldLimits.runtimeBytes), runner = await read(join(root, wholePaths.runner), oldLimits.inputBytes);
  if (sha(runtime) !== input.ownedRuntime.sha256 || runtime.byteLength !== input.ownedRuntime.byteLength || sha(html) !== input.material.sha256 || html.byteLength !== input.material.byteLength) throw Error("Whole runtime staged identity unavailable");
  let recordIndex = 0, aggregate = 0;
  const manifest = await observeOwnedHtmlProtectionWholeRuntime({ chromium: args.chromium, input, physicalHtml: html,
    writeRecord: async ({ kind, stateId, value }) => {
      const bytes = Buffer.from(canonical(value));
      if (!bytes.byteLength || bytes.byteLength > limits.observationBytes || bytes.byteLength + aggregate > limits.aggregateBytes) throw new HtmlProtectionWholeNativeGap("aggregate-private-capacity-unavailable");
      const index = recordIndex++, parts: HtmlProtectionWholePrivateRecord["parts"] = [];
      for (let offset = 0, partIndex = 0; offset < bytes.byteLength; offset += limits.partBytes, partIndex++) {
        const part = bytes.subarray(offset, Math.min(offset + limits.partBytes, bytes.byteLength)), path = wholePaths.partRoot + String(index).padStart(5, "0") + "-" + String(partIndex).padStart(3, "0") + ".part";
        await write(join(root, path), part); const actual = await read(join(root, path), limits.partBytes);
        if (sha(actual) !== sha(part) || actual.byteLength !== part.byteLength) throw new HtmlProtectionWholeNativeGap("private-record-write-readback-mismatch");
        parts.push({ path, sha256: sha(actual), byteLength: actual.byteLength });
      }
      aggregate += bytes.byteLength;
      return HtmlProtectionWholePrivateRecordSchema.parse({ recordId: "native-record:" + input.nonce + ":" + index, kind, stateId, sha256: sha(bytes), byteLength: bytes.byteLength, parts });
    } });
  manifest.runnerSha256 = sha(runner);
  const bytes = Buffer.from(canonical(HtmlProtectionWholeCloudManifestSchema.parse(manifest)));
  if (bytes.byteLength > oldLimits.resultBytes) throw Error("Whole runtime manifest unavailable");
  await mkdir(join(root, dirname(wholePaths.manifest)), { recursive: true, mode: 0o700 });
  await write(join(root, wholePaths.manifest), bytes);
}

function validateActualState(action: HtmlProtectionWholeRuntimeAction, value: unknown) {
  const state = value as { target?: { hovered?: boolean; attributes?: Array<[string,string]>; parentAttributes?: Array<[string,string]> | null }; globals?: Array<{tag:string;id:string|null;attributes:Array<[string,string]>}>; documentUrl?:string; scroll?:{y:number} };
  const attributes = new Map(state.target?.attributes ?? []), classes = (attributes.get("class") ?? "").split(/\s+/);
  if (["hover-enter", "hover-leave"].includes(action.intent) && state.target?.hovered !== (action.intent === "hover-enter")) throw new HtmlProtectionWholeNativeGap("actual-hover-transition-mismatch");
  if (["check-on", "check-off"].includes(action.intent) && classes.includes("checked") !== (action.intent === "check-on")) throw new HtmlProtectionWholeNativeGap("actual-check-transition-mismatch");
  if (["menu-open", "menu-close"].includes(action.intent)) {
    const body = state.globals?.find(item => item.tag === "BODY"), bodyClasses = (new Map(body?.attributes ?? []).get("class") ?? "").split(/\s+/);
    if (bodyClasses.includes("menu-open") !== (action.intent === "menu-open")) throw new HtmlProtectionWholeNativeGap("actual-menu-transition-mismatch");
  }
  if (["details-open", "details-close"].includes(action.intent) && new Map(state.target?.parentAttributes ?? []).has("open") !== (action.intent === "details-open")) throw new HtmlProtectionWholeNativeGap("actual-details-transition-mismatch");
  if (action.intent === "top" && (!state.scroll || Math.abs(state.scroll.y) > 1)) throw new HtmlProtectionWholeNativeGap("actual-top-navigation-mismatch");
  if (action.intent === "reveal" && !classes.includes("in-view")) throw new HtmlProtectionWholeNativeGap("actual-reveal-transition-unobserved");
  if (action.operation === "fill") {
    const needle = (action.value ?? "").toLowerCase().trim();
    const cards = (state.globals ?? []).filter(item => (new Map(item.attributes).get("class") ?? "").split(/\s+/).includes("slide-card"));
    if (!cards.length || cards.some(item => {const map=new Map(item.attributes), search=map.get("data-search");return search===undefined || (map.get("class")??"").split(/\s+/).includes("search-hidden") === search.includes(needle);})) throw new HtmlProtectionWholeNativeGap("actual-search-membership-transition-mismatch");
  }
}
function validateActualNavigation(fragment: string, value: unknown) {
  const state = z.object({ documentUrl: z.string(), viewport: z.object({ height: z.number().positive() }), scroll: z.object({ y: z.number().finite() }),
    documentSize: z.object({ height: z.number().positive() }), rootScrollPaddingTop: z.string(), target: z.object({ attributes: z.array(z.tuple([z.string(), z.string()])),
      bounds: z.array(z.number().finite()).length(4), styles: z.array(z.tuple([z.string(), z.string()])) }) }).passthrough().parse(value);
  let actualFragment: string; try { actualFragment = decodeURIComponent(new URL(state.documentUrl).hash.slice(1)); } catch { throw new HtmlProtectionWholeNativeGap("actual-anchor-fragment-unresolved"); }
  if (actualFragment !== fragment || new Map(state.target.attributes).get("id") !== fragment) throw new HtmlProtectionWholeNativeGap("actual-anchor-navigation-mismatch");
  const pixel = (value: string) => value === "auto" ? 0 : /^-?\d+(?:\.\d+)?px$/.test(value) ? Number.parseFloat(value) : Number.NaN;
  const margin = pixel(new Map(state.target.styles).get("scroll-margin-top") ?? "0px"), padding = pixel(state.rootScrollPaddingTop);
  const targetAbsoluteTop = state.target.bounds[1]! + state.scroll.y;
  const expectedScroll = Math.max(0, Math.min(state.documentSize.height - state.viewport.height, targetAbsoluteTop - margin - padding));
  if (!Number.isFinite(expectedScroll) || Math.abs(state.scroll.y - expectedScroll) > 2) throw new HtmlProtectionWholeNativeGap("actual-anchor-scroll-alignment-mismatch");
}