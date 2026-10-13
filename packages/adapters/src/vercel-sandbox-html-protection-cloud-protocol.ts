import { createHash } from "node:crypto";
import { z } from "zod";
import { HtmlProtectionSnapshotRequestSchema, HtmlProtectionSnapshotResultSchema } from "@evolution/contracts";

export const HTML_PROTECTION_CLOUD_RUNTIME_VERSION = "html-protection-private-cloud-v1";
export const HTML_PROTECTION_CLOUD_URL = "http://127.0.0.1:4173/index.html";
export const HTML_PROTECTION_CLOUD_PATHS = {
  html: "dist/index.html",
  input: ".evolution/runtime/html-protection-input.json",
  runner: ".evolution/runtime/html-protection-runner.mjs",
  bundle: ".evolution/runtime/html-protection-owned-runtime.mjs",
  result: ".evolution/runtime/html-protection-result.json",
  manifest: ".evolution/runtime/html-protection-manifest.json",
} as const;
export const HTML_PROTECTION_CLOUD_LIMITS = {
  htmlBytes: 20 * 1024 * 1024, inputBytes: 64 * 1024, resultBytes: 4 * 1024 * 1024,
  runtimeBytes: 4 * 1024 * 1024, manifestBytes: 16 * 1024, deadlineMs: 90_000,
} as const;
export const HTML_PROTECTION_CLOUD_CSP = "worker-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const nonce = z.string().regex(/^[a-f0-9]{64}$/);
export const HtmlProtectionOwnedRuntimeBindingSchema = z.object({
  version: z.literal(HTML_PROTECTION_CLOUD_RUNTIME_VERSION), sha256,
  byteLength: z.number().int().positive().max(HTML_PROTECTION_CLOUD_LIMITS.runtimeBytes),
}).strict();
const MaterialSchema = z.object({ sha256, byteLength: z.number().int().positive().max(HTML_PROTECTION_CLOUD_LIMITS.htmlBytes) }).strict();
export const HtmlProtectionCloudInputSchema = z.object({
  schemaVersion: z.literal("html-protection-private-input-v1"), nonce,
  request: HtmlProtectionSnapshotRequestSchema,
  material: MaterialSchema, ownedRuntime: HtmlProtectionOwnedRuntimeBindingSchema,
}).strict().refine(value => value.request.documentUrl === HTML_PROTECTION_CLOUD_URL, "Fixed private document URL required")
  .refine(value => {
    const bound = value.request.sourceRole === "original" ? value.request.binding.original : value.request.binding.executed;
    return bound.sha256 === value.material.sha256 && bound.byteLength === value.material.byteLength;
  }, "Physical input must bind the selected subject");
export type HtmlProtectionCloudInput = z.infer<typeof HtmlProtectionCloudInputSchema>;
export const HtmlProtectionCloudGapSchema = z.enum([
  "missing-trusted-runtime", "copy-material-undefined", "physical-input-mismatch",
  "sandbox-policy-unavailable", "runtime-integrity", "runtime-exit", "private-file-missing",
  "private-file-integrity", "private-file-limit", "private-file-timeout", "private-file-stream",
  "request-binding-mismatch", "staged-material-mismatch", "served-material-mismatch",
  "blocked-resource", "observation-unavailable",
]);
const ObservationBase = z.object({
  schemaVersion: z.literal("html-protection-private-observation-v1"), nonce,
  request: HtmlProtectionSnapshotRequestSchema, ownedRuntime: HtmlProtectionOwnedRuntimeBindingSchema,
});
export const HtmlProtectionCloudObservationSchema = z.discriminatedUnion("availability", [
  ObservationBase.extend({
    availability: z.literal("available"),
    custody: z.object({
      staged: MaterialSchema, nodeResponse: MaterialSchema, browserResponse: MaterialSchema,
      documentUrl: z.literal(HTML_PROTECTION_CLOUD_URL), status: z.literal(200),
      contentType: z.literal("text/html"), contentSecurityPolicy: z.literal(HTML_PROTECTION_CLOUD_CSP),
      fromServiceWorker: z.literal(false), blockedRequests: z.literal(0),
      navigation: z.object({ frameId: z.string().min(1).max(512), loaderId: z.string().min(1).max(512),
        requestId: z.string().min(1).max(512), responseUrl: z.literal(HTML_PROTECTION_CLOUD_URL) }).strict(),
    }).strict(),
    snapshot: HtmlProtectionSnapshotResultSchema,
  }).strict(),
  ObservationBase.extend({ availability: z.literal("unavailable"), reason: HtmlProtectionCloudGapSchema }).strict(),
]);
export type HtmlProtectionCloudObservation = z.infer<typeof HtmlProtectionCloudObservationSchema>;
export const HtmlProtectionCloudManifestSchema = z.object({
  schemaVersion: z.literal("html-protection-private-manifest-v1"), nonce, requestSha256: sha256,
  ownedRuntimeSha256: sha256, runnerSha256: sha256,
  result: z.object({ path: z.literal(HTML_PROTECTION_CLOUD_PATHS.result), sha256,
    byteLength: z.number().int().positive().max(HTML_PROTECTION_CLOUD_LIMITS.resultBytes) }).strict(),
}).strict();
export function htmlProtectionCloudCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value); if (encoded === undefined) throw new Error("Non-JSON private material"); return encoded;
  }
  if (Array.isArray(value)) return "[" + value.map(htmlProtectionCloudCanonicalJson).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + htmlProtectionCloudCanonicalJson(record[key])).join(",") + "}";
}
export const htmlProtectionCloudSha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const HTML_PROTECTION_CLOUD_RUNNER_SCRIPT = String.raw`import { chromium } from "../browser/node_modules/playwright/index.mjs";
import { runPrivateHtmlProtectionCloudRuntime } from "./html-protection-owned-runtime.mjs";
await runPrivateHtmlProtectionCloudRuntime({ chromium, workingDirectory: process.cwd() });
`;
