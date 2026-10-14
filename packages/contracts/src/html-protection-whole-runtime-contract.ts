import { z } from "zod";
import { HtmlProtectionArtifactIdentitySchema, HtmlProtectionProofBindingSchema } from "./html-protection-proof-contract";

export const HTML_PROTECTION_WHOLE_RUNTIME_VERSION = "original-owned-whole-runtime-v1" as const;
export const HTML_PROTECTION_WHOLE_RUNTIME_LIMITS = {
  nodes: 20_000, controls: 5_000, states: 20_000, viewports: 40,
  properties: 1_024, observationBytes: 32 * 1024 * 1024, partBytes: 4 * 1024 * 1024,
  aggregateBytes: 256 * 1024 * 1024, actionTimeoutMs: 7_000, deadlineMs: 600_000,
} as const;
const identity = z.string().min(1).max(512);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const HtmlProtectionWholeRuntimeViewportSchema = z.object({
  width: z.number().int().min(240).max(2560), height: z.number().int().min(240).max(2560),
}).strict();
export const HtmlProtectionWholeRuntimeControlSchema = z.object({
  targetId: identity, selector: z.string().min(1).max(2048), sourcePath: identity,
  tag: identity, namespace: z.literal("http://www.w3.org/1999/xhtml"),
  id: z.string().nullable(), classNames: z.array(z.string()).max(128),
  attributes: z.array(z.tuple([z.string(), z.string()])).max(128),
  kind: z.enum(["search", "copy", "menu", "top", "anchor", "check", "details", "unknown"]),
  ownerCardId: z.string().nullable(), href: z.string().nullable(),
}).strict();
export type HtmlProtectionWholeRuntimeControl = z.infer<typeof HtmlProtectionWholeRuntimeControlSchema>;
export const HtmlProtectionWholeRuntimeSourcePlanSchema = z.object({
  schemaVersion: z.literal(HTML_PROTECTION_WHOLE_RUNTIME_VERSION), original: HtmlProtectionArtifactIdentitySchema,
  sourceCensus: z.object({ elements: z.number().int().nonnegative(), cards: z.number().int().nonnegative(),
    scripts: z.number().int().nonnegative(), styles: z.number().int().nonnegative(), controls: z.number().int().nonnegative() }).strict(),
  originalElementPaths: z.array(identity).max(HTML_PROTECTION_WHOLE_RUNTIME_LIMITS.nodes),
  runtimeParentIds: z.array(identity).max(HTML_PROTECTION_WHOLE_RUNTIME_LIMITS.nodes),
  scriptShape: z.array(z.object({ id: identity, sourcePath: identity, kind: z.string(),
    literal: z.string().nullable(), operationCensus: z.record(z.string(), z.number().int().nonnegative()),
    unsupportedOperations: z.array(z.string()), parseComplete: z.boolean(), effectProfile: z.unknown() }).strict()).max(128),
  viewports: z.array(HtmlProtectionWholeRuntimeViewportSchema).min(1).max(HTML_PROTECTION_WHOLE_RUNTIME_LIMITS.viewports),
  queryPositive: z.string().min(1).max(4096).nullable(), queryNegative: z.string().min(1).max(4096),
  gaps: z.array(z.string()).max(512),
}).strict();
export type HtmlProtectionWholeRuntimeSourcePlan = z.infer<typeof HtmlProtectionWholeRuntimeSourcePlanSchema>;
export const HtmlProtectionWholeRuntimeRegistrationSchema = z.object({
  schemaVersion: z.literal("html-protection-owned-boot-registration-v1"), original: HtmlProtectionArtifactIdentitySchema,
  sourcePlanSha256: digest, controls: z.array(HtmlProtectionWholeRuntimeControlSchema).max(HTML_PROTECTION_WHOLE_RUNTIME_LIMITS.controls),
  revealTargets: z.array(z.object({ targetId: identity, selector: z.string().min(1).max(2048), sourcePath: identity }).strict())
    .max(HTML_PROTECTION_WHOLE_RUNTIME_LIMITS.controls),
  nativeElementCount: z.number().int().positive().max(HTML_PROTECTION_WHOLE_RUNTIME_LIMITS.nodes),
  nativeBootSha256: digest, gaps: z.array(z.string()).max(512),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.controls.map(item => item.targetId)).size !== value.controls.length
    || new Set(value.controls.map(item => item.selector)).size !== value.controls.length) {
    ctx.addIssue({ code: "custom", message: "All native boot controls need unique registered identities" });
  }
});
export type HtmlProtectionWholeRuntimeRegistration = z.infer<typeof HtmlProtectionWholeRuntimeRegistrationSchema>;
export const HtmlProtectionWholeRuntimeRequestSchema = z.object({
  schemaVersion: z.literal("html-protection-whole-runtime-request-v1"), binding: HtmlProtectionProofBindingSchema,
  sourceRole: z.enum(["original", "executed"]), sourcePlanSha256: digest,
  sourcePlan: HtmlProtectionWholeRuntimeSourcePlanSchema,
  execution: z.object({ executionId: identity, jobId: identity, generation: z.number().int().positive() }).strict(),
  registration: HtmlProtectionWholeRuntimeRegistrationSchema.optional(),
  subjectScriptLocations: z.array(z.object({ parentId: identity, sourcePath: identity, subjectSourcePath: identity, line: z.number().int().nonnegative(), column: z.number().int().nonnegative(), sourceCharacters: z.number().int().nonnegative() }).strict()).max(128),
}).strict().superRefine((value, ctx) => {
  if (value.subjectScriptLocations.length !== value.sourcePlan.scriptShape.length || value.subjectScriptLocations.some((location, index) => location.parentId !== value.sourcePlan.scriptShape[index]?.id || location.sourcePath !== value.sourcePlan.scriptShape[index]?.sourcePath || location.sourceCharacters !== value.sourcePlan.scriptShape[index]?.literal?.replace(/\r\n?/g, "\n").length)
    || new Set(value.subjectScriptLocations.map(location => location.line + ":" + location.column)).size !== value.subjectScriptLocations.length) ctx.addIssue({ code: "custom", message: "Complete unique physical script occurrence locations required" });
  if (JSON.stringify(value.sourcePlan.original) !== JSON.stringify(value.binding.original)) {
    ctx.addIssue({ code: "custom", message: "Source plan belongs to a different physical Original" });
  }
  if (value.sourceRole === "executed" && !value.registration) ctx.addIssue({ code: "custom", message: "Executed role cannot derive a registration from Candidate" });
  if (value.registration && (value.registration.original.sha256 !== value.binding.original.sha256
    || value.registration.original.byteLength !== value.binding.original.byteLength
    || value.registration.original.sourceArtifactId !== value.binding.original.sourceArtifactId
    || value.registration.sourcePlanSha256 !== value.sourcePlanSha256)) {
    ctx.addIssue({ code: "custom", message: "Boot registry belongs to another Original or source plan" });
  }
});
export type HtmlProtectionWholeRuntimeRequest = z.infer<typeof HtmlProtectionWholeRuntimeRequestSchema>;
export const HtmlProtectionWholeRuntimeActionSchema = z.object({
  stateId: identity, targetId: identity, selector: z.string().min(1).max(2048),
  operation: z.enum(["boot", "viewport", "fill", "hover", "copy", "click", "scroll"]),
  intent: z.enum(["boot", "responsive", "query-positive", "query-negative", "clear", "hover-enter", "hover-leave",
    "copy", "menu-open", "menu-close", "check-on", "check-off", "details-open", "details-close", "navigate", "reveal", "top"]),
  value: z.string().max(4096).optional(), viewport: HtmlProtectionWholeRuntimeViewportSchema.optional(),
}).strict();
export type HtmlProtectionWholeRuntimeAction = z.infer<typeof HtmlProtectionWholeRuntimeActionSchema>;
export const HtmlProtectionWholeRuntimeActionFactSchema = z.object({
  action: HtmlProtectionWholeRuntimeActionSchema, status: z.enum(["observed", "failed", "not-executed"]),
  dispatched: z.number().int().min(0).max(1), settled: z.boolean(),
  startedAt: z.string().datetime({ offset: true }), completedAt: z.string().datetime({ offset: true }),
  beforeBackendNodeId: z.number().int().positive().nullable(), afterBackendNodeId: z.number().int().positive().nullable(),
  nativeObservation: z.unknown().optional(), nativeObservationSha256: digest.optional(),
  nativeObservationByteLength: z.number().int().positive().max(HTML_PROTECTION_WHOLE_RUNTIME_LIMITS.observationBytes).optional(),
  gaps: z.array(z.string()).max(64),
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.completedAt) < Date.parse(value.startedAt)) ctx.addIssue({ code: "custom", message: "Invalid actual execution time interval" });
  if (value.status === "observed" && (!value.settled || value.gaps.length || !value.nativeObservationSha256 || !value.nativeObservationByteLength
    || (value.action.operation !== "boot" && value.dispatched !== 1))) ctx.addIssue({ code: "custom", message: "Observed state requires one actual dispatch and native material" });
  if (value.status !== "observed" && !value.gaps.length) ctx.addIssue({ code: "custom", message: "Incomplete states must retain their actual gap" });
  if (value.status === "not-executed" && (value.dispatched || value.settled || value.nativeObservation)) ctx.addIssue({ code: "custom", message: "Unexecuted placeholder cannot contain invented actions or native evidence" });
});
export type HtmlProtectionWholeRuntimeActionFact = z.infer<typeof HtmlProtectionWholeRuntimeActionFactSchema>;
