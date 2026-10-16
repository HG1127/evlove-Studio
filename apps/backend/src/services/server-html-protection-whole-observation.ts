import { z } from "zod";
import { HtmlProtectionWholeRuntimeRequestSchema, type HtmlProtectionWholeRuntimeRequest } from "@evolution/contracts";
import { htmlProtectionWholeRuntimeSourcePlan, htmlProtectionWholeSubjectScriptLocations } from "@evolution/core";
import { createVercelSandboxHtmlProtectionWholeBrowser, runVercelSandboxHtmlProtectionWholeObservation,
  HtmlProtectionOwnedRuntimeBindingSchema, HTML_PROTECTION_CLOUD_LIMITS,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha,
  type HtmlProtectionPreparedBrowserFactory, type HtmlProtectionWholeRecordSink } from "@evolution/adapters/sandbox";
import { prepareServerHtmlProtectionCollectionPlan } from "./server-html-protection-collection-plan";

const Module = HtmlProtectionOwnedRuntimeBindingSchema.extend({ text: z.string().max(HTML_PROTECTION_CLOUD_LIMITS.runtimeBytes) }).strict();
/** Deployment composition only; no Mission/API data selects commands, code, source registration or artifact sink. */
export function createServerHtmlProtectionWholeObserver(ports: {
  loadOwnedRuntime?: () => Promise<z.infer<typeof Module>>;
  createPreparedBrowserSandbox?: HtmlProtectionPreparedBrowserFactory["createPreparedBrowserSandbox"];
} = {}) {
  const load = ports.loadOwnedRuntime ?? (async () => (await import("virtual:evolution-html-protection-runtime")).default);
  const create = ports.createPreparedBrowserSandbox ?? createVercelSandboxHtmlProtectionWholeBrowser;
  return async (args: { request: HtmlProtectionWholeRuntimeRequest; physicalHtml: Uint8Array; consumeRecord: HtmlProtectionWholeRecordSink }) => {
    const request = structuredClone(HtmlProtectionWholeRuntimeRequestSchema.parse(args.request)), physicalHtml = Buffer.from(args.physicalHtml), consumeRecord = args.consumeRecord;
    let runtime: z.infer<typeof Module>;
    try { runtime = Module.parse(await load()); } catch { return { availability: "unavailable" as const, reason: "missing-trusted-runtime", request }; }
    return runVercelSandboxHtmlProtectionWholeObservation({ request, physicalHtml, consumeRecord }, {
      trustedRuntimeBinding: { version: runtime.version, sha256: runtime.sha256, byteLength: runtime.byteLength },
      trustedRuntimeBytes: Buffer.from(runtime.text), createPreparedBrowserSandbox: create });
  };
}
export const collectServerHtmlProtectionWholeObservation = createServerHtmlProtectionWholeObserver();
/** Read complete physical Original independently, derive only its plan, then run both exact source roles with the same Original boot registry. */
export async function collectServerHtmlProtectionWholeRuntimePair(args: Parameters<typeof prepareServerHtmlProtectionCollectionPlan>[0] & {
  consumeRecord: (role: "original" | "executed", ...args: Parameters<HtmlProtectionWholeRecordSink>) => ReturnType<HtmlProtectionWholeRecordSink>;
}, observe = collectServerHtmlProtectionWholeObservation) {
  const execution = structuredClone(args.execution), consume = args.consumeRecord;
  const prepared = await prepareServerHtmlProtectionCollectionPlan({ ...args, execution });
  const binding = structuredClone(prepared.binding);
  const physical = { original: Buffer.from(prepared.physicalInputs.original), executed: Buffer.from(prepared.physicalInputs.executed) };
  const sourcePlan = htmlProtectionWholeRuntimeSourcePlan({ original: binding.original,
    html: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(physical.original) });
  const sourcePlanSha256 = sha(canonical(sourcePlan));
  const originalRequest = HtmlProtectionWholeRuntimeRequestSchema.parse({ schemaVersion: "html-protection-whole-runtime-request-v1",
    binding, execution, sourceRole: "original", sourcePlan, sourcePlanSha256,
    subjectScriptLocations: htmlProtectionWholeSubjectScriptLocations({ sourcePlan, html: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(physical.original) }) });
  const original = await observe({ request: originalRequest, physicalHtml: physical.original, consumeRecord: (record, bytes) => consume("original", record, bytes) });
  if (original.availability !== "available" || !original.manifest.registration) return { availability: "unavailable" as const,
    binding, execution, sourcePlan, sourcePlanSha256, original, reason: "original-runtime-registration-unavailable" };
  const registration = structuredClone(original.manifest.registration);
  const executedRequest = HtmlProtectionWholeRuntimeRequestSchema.parse({ ...originalRequest, sourceRole: "executed", registration,
    subjectScriptLocations: htmlProtectionWholeSubjectScriptLocations({ sourcePlan, html: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(physical.executed) }) });
  const executed = await observe({ request: executedRequest, physicalHtml: physical.executed, consumeRecord: (record, bytes) => consume("executed", record, bytes) });
  return { availability: "collected" as const, binding, execution, sourcePlan, sourcePlanSha256, original, executed,
    limitations: ["Inspect every native action and physical private record; collection transport is not a preservation verdict.",
      "Unknown source parents, continuous responsive effects and unproved script causality remain unresolved and block whole protection."] };
}
