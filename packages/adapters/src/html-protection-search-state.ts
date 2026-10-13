import { z } from "zod";
import type { Page } from "@playwright/test";
import {
  HTML_PROTECTION_SEARCH_STATE_LIMITS, HtmlProtectionSearchInputObservationSchema,
  HtmlProtectionSearchStateRegistrationSchema, HtmlProtectionSearchStateRequestSchema,
  HtmlProtectionSearchStateSessionSchema, HtmlProtectionSnapshotResultSchema,
  type HtmlProtectionSearchInputObservation, type HtmlProtectionSearchStateGap,
  type HtmlProtectionSearchStateRequest,
} from "@evolution/contracts";

export interface HtmlProtectionSearchNativeReadPort {
  /** Fixed native/isolated input read. Must not use page-controlled main-world DOM accessors. */
  read(page: Page, registeredCssSelector: string): Promise<{ page: Page; observation: unknown }>;
}
export interface HtmlProtectionSearchExecutionFacts {
  request?: HtmlProtectionSearchStateRequest;
  fillCalls: 0 | 1;
  fillSettled: boolean;
  beforeValue?: string;
  afterValue?: string;
  /** Local action/input facts recorded, not a query-semantic or preservation verdict. */
  executionRecorded: boolean;
  gaps: HtmlProtectionSearchStateGap[];
}
export interface HtmlProtectionSearchSnapshotLinkFacts {
  /** Binding relationship only; neither DTO nor this field establishes observation provenance. */
  linked: boolean;
  gaps: HtmlProtectionSearchStateGap[];
}
class StateGap extends Error {
  readonly code: HtmlProtectionSearchStateGap;
  constructor(code: HtmlProtectionSearchStateGap) { super(code); this.code = code; }
}
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = Object.entries(left), b = Object.entries(right);
  return a.length === b.length && a.every(([key, value]) => Object.hasOwn(right, key) && equal(value, (right as Record<string, unknown>)[key]));
}
function nativeCss(selector: string): string | undefined {
  const css = selector.startsWith("css=") ? selector.slice(4) : selector;
  // Custom Playwright engines/chains are not native CSS. Actual CSS support is checked by the native read port.
  return !css.trim() || css.includes(">>") || /^[a-zA-Z][a-zA-Z0-9_-]*=/.test(css) ? undefined : css;
}

/**
 * Dedicated owned Page session; no cloud wiring or general action/evaluate interface.
 * Original registration, physical/document anchors and the read port come from a trusted
 * controller. Zod/DTO equality, local execution facts and native labels are not authority.
 * The caller still owns truthful snapshot production and semantic/visual/runtime residuals.
 */
export function createHtmlProtectionSearchStateSession(options: {
  page: Page;
  expected: unknown;
  originalRegistration: unknown;
  caseDeadline: number;
  nativeInput: HtmlProtectionSearchNativeReadPort;
}) {
  // Clone every external data object and capture all functions before the first await.
  const expected = HtmlProtectionSearchStateSessionSchema.parse(options.expected);
  const registration = HtmlProtectionSearchStateRegistrationSchema.parse(options.originalRegistration);
  const suppliedDeadline = z.number().finite().positive().parse(options.caseDeadline);
  const caseDeadline = Math.min(suppliedDeadline, Date.now() + HTML_PROTECTION_SEARCH_STATE_LIMITS.caseTimeoutMs);
  const page = options.page;
  const read = typeof options.nativeInput.read === "function" ? options.nativeInput.read.bind(options.nativeInput) : undefined;
  const close = typeof page.close === "function" ? page.close.bind(page) : undefined;
  const css = nativeCss(registration.registry.inputSelector);
  let fill: ((value: string, options: { timeout: number }) => Promise<void>) | undefined;
  if (css && typeof page.locator === "function") {
    try { const locator = page.locator("css=" + css); if (typeof locator.fill === "function") fill = locator.fill.bind(locator); }
    catch { /* Unsupported fixed locator is a capability gap, never a completed action. */ }
  }
  const registered = equal(registration.original, expected.binding.original)
    && registration.policyVersion === expected.policyVersion && registration.planSha256 === expected.planSha256
    && registration.registrySha256 === expected.registrySha256;
  let poisoned = false, closed = false, busy = false, next = 0;
  let nodeId: number | undefined;
  let last: { request: HtmlProtectionSearchStateRequest; value: string } | undefined;

  function poison() {
    poisoned = true;
    if (!closed) {
      closed = true;
      // Cleanup is always the constructor-owned Page, never a Page supplied by a later envelope.
      void Promise.resolve().then(() => close?.()).catch(() => undefined);
    }
  }
  function check(deadline: number, signal?: AbortSignal) {
    if (signal?.aborted) throw new StateGap("aborted");
    if (Date.now() >= deadline) throw new StateGap("deadline-exceeded");
    if (poisoned) throw new StateGap("session-unavailable");
  }
  async function bounded<T>(task: () => Promise<T>, deadline: number, signal?: AbortSignal): Promise<T> {
    check(deadline, signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      const stop = (code: "aborted" | "deadline-exceeded") => { poison(); reject(new StateGap(code)); };
      timer = setTimeout(() => stop("deadline-exceeded"), Math.max(0, deadline - Date.now()));
      abort = () => stop("aborted");
      signal?.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([
        Promise.resolve().then(() => { check(deadline, signal); return task(); })
          .then(result => { check(deadline, signal); return result; }),
        interrupted,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
    }
  }
  function anchor(value: Pick<HtmlProtectionSearchStateRequest, "binding" | "sourceRole" | "policyVersion" | "planSha256" | "registrySha256" | "execution" | "batchId">) {
    return { binding: value.binding, sourceRole: value.sourceRole, policyVersion: value.policyVersion,
      planSha256: value.planSha256, registrySha256: value.registrySha256, execution: value.execution, batchId: value.batchId };
  }
  function requestMatches(request: Parameters<typeof anchor>[0]) { return equal(anchor(request), anchor(expected)); }
  async function observe(deadline: number, signal?: AbortSignal): Promise<HtmlProtectionSearchInputObservation> {
    let material: { page: Page; observation: unknown };
    try { material = await bounded(() => read!(page, css!), deadline, signal); }
    catch (error) { throw error instanceof StateGap ? error : new StateGap("native-unavailable"); }
    if (material.page !== page) throw new StateGap("page-mismatch");
    const parsed = HtmlProtectionSearchInputObservationSchema.safeParse(material.observation);
    if (!parsed.success || parsed.data.availability !== "available") throw new StateGap("native-unavailable");
    const observation = parsed.data, input = observation.input!;
    if (observation.frameId !== expected.frameId || observation.loaderId !== expected.loaderId) throw new StateGap("document-mismatch");
    const physical = expected.binding[expected.sourceRole];
    if (observation.physicalInput.sha256 !== physical.sha256 || observation.physicalInput.byteLength !== physical.byteLength) {
      throw new StateGap("physical-input-mismatch");
    }
    if (input.matchCount !== 1) throw new StateGap(input.matchCount ? "ambiguous-input" : "missing-input");
    if (input.id !== registration.input.id || input.tag !== registration.input.tag || input.namespace !== registration.input.namespace
      || input.type !== registration.input.type || !input.backendNodeId) throw new StateGap("input-identity-mismatch");
    if (input.disabled !== false || input.readOnly !== false || input.value === null) throw new StateGap("unsupported-input");
    if (nodeId !== undefined && input.backendNodeId !== nodeId) throw new StateGap("input-identity-mismatch");
    return observation;
  }
  function guard(): HtmlProtectionSearchStateGap | undefined {
    if (poisoned) return "session-unavailable";
    if (busy) return "operation-in-progress";
    if (!registered) return "binding-mismatch";
    if (!css) return "unsupported-selector";
    if (!read) return "native-unavailable";
    if (!fill || !close) return "fill-unavailable";
  }

  async function execute(requestInput: unknown, signal?: AbortSignal): Promise<HtmlProtectionSearchExecutionFacts> {
    const parsed = HtmlProtectionSearchStateRequestSchema.safeParse(requestInput);
    const facts: HtmlProtectionSearchExecutionFacts = { fillCalls: 0, fillSettled: false, executionRecorded: false, gaps: [] };
    if (!parsed.success) { facts.gaps.push("invalid-request"); return facts; }
    const request = parsed.data;
    facts.request = request;
    const problem = guard();
    if (problem) { facts.gaps.push(problem); return facts; }
    if (!requestMatches(request)) { facts.gaps.push("binding-mismatch"); return facts; }
    const state = registration.states.find(item => item.stateId === request.stateId && item.stateKind === request.stateKind);
    if (!state) { facts.gaps.push("unregistered-state"); return facts; }
    if (state !== registration.states[next]) { facts.gaps.push("out-of-order-state"); return facts; }
    const deadline = Math.min(caseDeadline, Date.now() + HTML_PROTECTION_SEARCH_STATE_LIMITS.actionTimeoutMs);
    busy = true;
    try {
      const before = await observe(deadline, signal);
      facts.beforeValue = before.input!.value!;
      const priorValue = last?.value ?? registration.input.initialValue;
      if (facts.beforeValue !== priorValue) throw new StateGap("input-value-mismatch");
      nodeId = before.input!.backendNodeId!;
      const targetValue = state.stateKind === "boot" ? registration.input.initialValue : state.value;
      if (state.stateKind !== "boot") {
        await bounded(() => {
          // Actual dispatch checks remaining time, even when timers have not been scheduled after a CPU stall.
          check(deadline, signal);
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new StateGap("deadline-exceeded");
          facts.fillCalls = 1;
          return fill!(targetValue, { timeout: remaining });
        }, deadline, signal);
        facts.fillSettled = true;
      }
      const after = await observe(deadline, signal);
      facts.afterValue = after.input!.value!;
      if (facts.afterValue !== targetValue) throw new StateGap("input-value-mismatch");
      check(deadline, signal);
      last = { request: HtmlProtectionSearchStateRequestSchema.parse(request), value: targetValue };
      next++;
      facts.executionRecorded = true;
    } catch (error) {
      facts.gaps.push(error instanceof StateGap ? error.code : "fill-unavailable");
      poison();
    } finally { busy = false; }
    return facts;
  }

  async function linkSnapshot(material: { page: Page; snapshot: unknown }, signal?: AbortSignal): Promise<HtmlProtectionSearchSnapshotLinkFacts> {
    // The Page reference is controller-only material, never accepted from serialized client DTO.
    const snapshotPage = material.page, parsed = HtmlProtectionSnapshotResultSchema.safeParse(material.snapshot);
    const gaps: HtmlProtectionSearchStateGap[] = [];
    const problem = guard();
    if (problem) return { linked: false, gaps: [problem] };
    if (snapshotPage !== page) return { linked: false, gaps: ["page-mismatch"] };
    if (!last || !parsed.success) return { linked: false, gaps: ["snapshot-mismatch"] };
    const snapshot = parsed.data, request = snapshot.request;
    if (!requestMatches(request) || request.stateId !== last.request.stateId
      || !equal(request.registry, registration.registry) || snapshot.availability !== "available"
      || !snapshot.projectionComplete || snapshot.gaps.length || snapshot.body?.gaps.length
      || snapshot.realm?.frameId !== expected.frameId || snapshot.realm?.loaderId !== expected.loaderId
      || snapshot.physicalInput.sha256 !== expected.binding[expected.sourceRole].sha256
      || snapshot.physicalInput.byteLength !== expected.binding[expected.sourceRole].byteLength
      || snapshot.body?.projection !== "search-membership-v1"
      || snapshot.body.targetId !== registration.registry.targetId
      || snapshot.body.input.matchCount !== 1 || snapshot.body.input.tag !== "INPUT" || snapshot.body.input.value !== last.value) {
      return { linked: false, gaps: ["snapshot-mismatch"] };
    }
    const deadline = Math.min(caseDeadline, Date.now() + HTML_PROTECTION_SEARCH_STATE_LIMITS.actionTimeoutMs);
    busy = true;
    try {
      const current = await observe(deadline, signal);
      if (current.input!.value !== last.value) throw new StateGap("input-value-mismatch");
      check(deadline, signal);
    } catch (error) {
      gaps.push(error instanceof StateGap ? error.code : "native-unavailable");
      poison();
    } finally { busy = false; }
    return { linked: gaps.length === 0, gaps };
  }
  return { execute, linkSnapshot, dispose: poison };
}
