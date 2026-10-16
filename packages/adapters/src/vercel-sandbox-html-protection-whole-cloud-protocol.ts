import { z } from "zod";
import { HTML_PROTECTION_WHOLE_RUNTIME_LIMITS as limits, HtmlProtectionWholeRuntimeRequestSchema,
  HtmlProtectionWholeRuntimeRegistrationSchema, HtmlProtectionWholeRuntimeActionSchema } from "@evolution/contracts";
import { HtmlProtectionOwnedRuntimeBindingSchema, HtmlProtectionCloudObservationSchema,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha } from "./vercel-sandbox-html-protection-cloud-protocol";

const digest = z.string().regex(/^[a-f0-9]{64}$/), nonce = digest;
export const HTML_PROTECTION_WHOLE_PRIVATE_PATHS = {
  input: ".evolution/runtime/html-protection-whole-input.json", manifest: ".evolution/runtime/html-protection-whole-manifest.json",
  runner: ".evolution/runtime/html-protection-whole-runner.mjs", partRoot: ".evolution/runtime/whole-observations/",
} as const;
export const HtmlProtectionWholeCloudInputSchema = z.object({
  schemaVersion: z.literal("html-protection-whole-private-input-v1"), nonce,
  request: HtmlProtectionWholeRuntimeRequestSchema, ownedRuntime: HtmlProtectionOwnedRuntimeBindingSchema,
  material: z.object({ sha256: digest, byteLength: z.number().int().positive() }).strict(),
}).strict().superRefine((value, ctx) => {
  const expected = value.request.binding[value.request.sourceRole];
  if (expected.sha256 !== value.material.sha256 || expected.byteLength !== value.material.byteLength
    || sha(canonical(value.request.sourcePlan)) !== value.request.sourcePlanSha256) ctx.addIssue({ code: "custom", message: "Whole runtime physical source or plan mismatch" });
  if (Buffer.byteLength(canonical(value)) > 2 * 1024 * 1024) ctx.addIssue({ code: "custom", message: "Complete private plan exceeds input capacity" });
});
export type HtmlProtectionWholeCloudInput = z.infer<typeof HtmlProtectionWholeCloudInputSchema>;
const part = z.object({ path: z.string().regex(/^\.evolution\/runtime\/whole-observations\/[0-9]{5}-[0-9]{3}\.part$/),
  sha256: digest, byteLength: z.number().int().positive().max(limits.partBytes) }).strict();
export const HtmlProtectionWholePrivateRecordSchema = z.object({
  recordId: z.string().min(1).max(512), kind: z.enum(["boot-census", "action", "document", "visual-tile", "script-coverage", "diagnostic"]),
  stateId: z.string().min(1).max(512), sha256: digest, byteLength: z.number().int().positive().max(limits.observationBytes),
  parts: z.array(part).min(1).max(8),
}).strict().refine(value => value.parts.reduce((sum, item) => sum + item.byteLength, 0) === value.byteLength, "Complete record parts required");
export type HtmlProtectionWholePrivateRecord = z.infer<typeof HtmlProtectionWholePrivateRecordSchema>;
const custody = HtmlProtectionCloudObservationSchema.options[0].shape.custody.extend({ blockedRequests: z.number().int().nonnegative() }).strict();
export const HtmlProtectionWholeCloudManifestSchema = z.object({
  schemaVersion: z.literal("html-protection-whole-private-manifest-v1"), nonce, inputSha256: digest,
  ownedRuntimeSha256: digest, runnerSha256: digest,
  request: HtmlProtectionWholeRuntimeRequestSchema, registration: HtmlProtectionWholeRuntimeRegistrationSchema.optional(),
  availability: z.enum(["available", "unavailable"]), reason: z.string().min(1).max(128).optional(),
  custody: custody.optional(),
  expectedActions: z.array(HtmlProtectionWholeRuntimeActionSchema).max(limits.states),
  records: z.array(HtmlProtectionWholePrivateRecordSchema).max(limits.states + limits.viewports + 1),
  actualActionCount: z.number().int().nonnegative().max(limits.states),
  aggregateByteLength: z.number().int().nonnegative().max(limits.aggregateBytes),
  gaps: z.array(z.string()).max(512),
}).strict().superRefine((value, ctx) => {
  if (value.records.reduce((sum, record) => sum + record.byteLength, 0) !== value.aggregateByteLength
    || new Set(value.records.map(record => record.recordId)).size !== value.records.length
    || new Set(value.records.flatMap(record => record.parts.map(item => item.path))).size !== value.records.flatMap(record => record.parts).length) {
    ctx.addIssue({ code: "custom", message: "Duplicate, absent or incomplete native private records" });
  }
  if (value.availability === "available" && (!value.registration || !value.custody || value.custody.blockedRequests
    || value.actualActionCount !== value.expectedActions.length || value.reason)) ctx.addIssue({ code: "custom", message: "Available local sequence needs all actual actions and physical custody" });
  if (value.availability === "unavailable" && !value.reason) ctx.addIssue({ code: "custom", message: "Incomplete execution requires its actual refusal" });
});
export type HtmlProtectionWholeCloudManifest = z.infer<typeof HtmlProtectionWholeCloudManifestSchema>;
export const HTML_PROTECTION_WHOLE_CLOUD_RUNNER_SCRIPT = String.raw`import { chromium } from "../browser/node_modules/playwright/index.mjs";
import { runPrivateHtmlProtectionWholeCloudRuntime } from "./html-protection-owned-runtime.mjs";
await runPrivateHtmlProtectionWholeCloudRuntime({ chromium, workingDirectory: process.cwd() });
`;
