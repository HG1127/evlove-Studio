import { z } from "zod";
import {
  createVercelSandboxHtmlProtectionBrowser, runVercelSandboxHtmlProtectionSearchObservation,
  HtmlProtectionOwnedRuntimeBindingSchema, HTML_PROTECTION_CLOUD_LIMITS, HTML_PROTECTION_CLOUD_URL,
  type HtmlProtectionPreparedBrowserFactory, type HtmlProtectionSearchObservationArgs,
} from "@evolution/adapters/sandbox";
import { HtmlProtectionSnapshotRequestSchema, HtmlProtectionSearchStateRegistrationSchema, HtmlProtectionSearchStateRequestSchema } from "@evolution/contracts";
import { prepareServerHtmlProtectionCollectionPlan } from "./server-html-protection-collection-plan";
import { compareCollectedServerHtmlProtectionSearchPair } from "./server-html-protection-search-comparison";

const Module = HtmlProtectionOwnedRuntimeBindingSchema.extend({ text: z.string().max(HTML_PROTECTION_CLOUD_LIMITS.runtimeBytes) }).strict();
type Ports = {
  loadOwnedRuntime?: () => Promise<z.infer<typeof Module>>;
  createPreparedBrowserSandbox?: HtmlProtectionPreparedBrowserFactory["createPreparedBrowserSandbox"];
};
/** Deployment-only ports. No HTTP/AI data selects a loader, browser, script or model-owned registration. */
export function createServerHtmlProtectionSearchObserver(ports: Ports = {}) {
  const load = ports.loadOwnedRuntime ?? (async () => (await import("virtual:evolution-html-protection-runtime")).default);
  const create = ports.createPreparedBrowserSandbox ?? createVercelSandboxHtmlProtectionBrowser;
  return async (args: HtmlProtectionSearchObservationArgs) => {
    // Snapshot mutable request data before the deployment module await.
    if (args.physicalHtml.byteLength > HTML_PROTECTION_CLOUD_LIMITS.htmlBytes) return { availability: "unavailable" as const, reason: "physical-input-mismatch" as const };
    const validated = z.object({ registration: HtmlProtectionSearchStateRegistrationSchema, stateRequests: z.array(HtmlProtectionSearchStateRequestSchema).length(4), snapshotRequests: z.array(HtmlProtectionSnapshotRequestSchema).length(4) }).strict().parse({ registration: args.registration, stateRequests: args.stateRequests, snapshotRequests: args.snapshotRequests });
    const input = { ...validated, physicalHtml: Buffer.from(args.physicalHtml) };
    let runtime: z.infer<typeof Module>;
    try { runtime = Module.parse(await load()); } catch { return { availability: "unavailable" as const, reason: "missing-trusted-runtime" as const }; }
    const binding = HtmlProtectionOwnedRuntimeBindingSchema.parse({ version: runtime.version, sha256: runtime.sha256, byteLength: runtime.byteLength });
    if (Buffer.byteLength(runtime.text, "utf8") > HTML_PROTECTION_CLOUD_LIMITS.runtimeBytes) return { availability: "unavailable" as const, reason: "runtime-integrity" as const };
    return runVercelSandboxHtmlProtectionSearchObservation(input, { trustedRuntimeBinding: binding,
      trustedRuntimeBytes: Buffer.from(runtime.text, "utf8"), createPreparedBrowserSandbox: create });
  };
}
export const collectServerHtmlProtectionSearchObservation = createServerHtmlProtectionSearchObserver();

/** Read exact stored Original/current/frozen Candidate and execute both roles against one Original-only closed plan. */
export async function collectServerHtmlProtectionSearchPair(
  args: Parameters<typeof prepareServerHtmlProtectionCollectionPlan>[0],
  observe = collectServerHtmlProtectionSearchObservation,
) {
  const prepared = await prepareServerHtmlProtectionCollectionPlan(args);
  // Own the entire expected plan before either asynchronous observer receives its isolated views.
  const plan = structuredClone(prepared);
  plan.physicalInputs = { original: Buffer.from(prepared.physicalInputs.original), executed: Buffer.from(prepared.physicalInputs.executed) };
  if (!plan.searchRegistration) return { availability: "unavailable" as const, reason: "original-search-scope-unavailable" as const,
    planSha256: plan.planSha256, binding: plan.binding };
  const registration = plan.searchRegistration;
  const role = (sourceRole: "original" | "executed"): HtmlProtectionSearchObservationArgs => {
    const stateRequests = plan.searchRequests.filter(request => request.sourceRole === sourceRole);
    const snapshotRequests = stateRequests.map(({ schemaVersion: _version, stateKind: _kind, ...anchor }) => {
      void _version; void _kind;
      return HtmlProtectionSnapshotRequestSchema.parse({ ...anchor, schemaVersion: "html-protection-snapshot-request-v1",
        documentUrl: HTML_PROTECTION_CLOUD_URL, registry: registration.registry });
    });
    return { ...structuredClone({ registration, stateRequests, snapshotRequests }), physicalHtml: Buffer.from(plan.physicalInputs[sourceRole]) };
  };
  const original = structuredClone(await observe(role("original")));
  const executed = structuredClone(await observe(role("executed")));
  const comparison = compareCollectedServerHtmlProtectionSearchPair({ plan, original, executed });
  return { availability: "collected" as const, binding: plan.binding, planSha256: plan.planSha256, original, executed, comparison,
    limitations: ["Selected native search sequence only; inspect each observation and unavailable prefix.",
      "Not whole protection, semantic/visual proof, Hidden settlement, signing or Gate F acceptance."] };
}