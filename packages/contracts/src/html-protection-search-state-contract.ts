import { z } from "zod";
import { HtmlProtectionArtifactIdentitySchema, HtmlProtectionProofBindingSchema } from "./html-protection-proof-contract";
import { HtmlProtectionSnapshotRegistrySchema } from "./html-protection-snapshot-contract";

export const HTML_PROTECTION_SEARCH_STATE_LIMITS = { actionTimeoutMs: 5_000, caseTimeoutMs: 45_000, queryLength: 4096 } as const;
const identity = z.string().min(1).max(512).refine(value => value.trim().length > 0);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const value = z.string().max(HTML_PROTECTION_SEARCH_STATE_LIMITS.queryLength);
const query = value.refine(text => text.trim().length > 0);
const execution = z.object({ executionId: identity, jobId: identity, generation: z.number().int().positive() }).strict();
export const HtmlProtectionSearchStateKindSchema = z.enum(["boot", "query-positive", "query-negative", "clear"]);
export const HtmlProtectionSearchStateGapSchema = z.enum([
  "invalid-request", "binding-mismatch", "unregistered-state", "out-of-order-state", "operation-in-progress",
  "session-unavailable", "unsupported-selector", "native-unavailable", "missing-input", "ambiguous-input",
  "unsupported-input", "input-identity-mismatch", "input-value-mismatch", "page-mismatch", "document-mismatch",
  "physical-input-mismatch", "deadline-exceeded", "aborted", "fill-unavailable", "snapshot-mismatch",
]);
export type HtmlProtectionSearchStateGap = z.infer<typeof HtmlProtectionSearchStateGapSchema>;

/** Closed intent only. No selector, query, URL, script, environment or arbitrary action enters here. */
export const HtmlProtectionSearchStateRequestSchema = z.object({
  schemaVersion: z.literal("html-protection-search-state-request-v1"),
  binding: HtmlProtectionProofBindingSchema, sourceRole: z.enum(["original", "executed"]),
  policyVersion: identity, planSha256: sha256, registrySha256: sha256, execution,
  batchId: identity, stateId: identity, stateKind: HtmlProtectionSearchStateKindSchema,
}).strict();
export type HtmlProtectionSearchStateRequest = z.infer<typeof HtmlProtectionSearchStateRequestSchema>;

const searchRegistry = HtmlProtectionSnapshotRegistrySchema.options[2];
/**
 * Supplied by an independently Original-only registration path, never derived from Candidate,
 * a submitted proof or AI prose. Parsing this DTO does not establish that provenance.
 * Positive/negative are finite state intent names, not a semantic query verdict.
 */
export const HtmlProtectionSearchStateRegistrationSchema = z.object({
  schemaVersion: z.literal("html-protection-search-state-registration-v1"),
  original: HtmlProtectionArtifactIdentitySchema,
  policyVersion: identity, planSha256: sha256, registrySha256: sha256,
  registry: searchRegistry,
  input: z.object({
    id: identity, tag: z.literal("INPUT"), namespace: z.literal("http://www.w3.org/1999/xhtml"),
    type: z.enum(["text", "search"]), initialValue: value,
  }).strict(),
  states: z.tuple([
    z.object({ stateKind: z.literal("boot"), stateId: identity }).strict(),
    z.object({ stateKind: z.literal("query-positive"), stateId: identity, value: query }).strict(),
    z.object({ stateKind: z.literal("query-negative"), stateId: identity, value: query }).strict(),
    z.object({ stateKind: z.literal("clear"), stateId: identity, value: z.literal("") }).strict(),
  ]),
}).strict().superRefine((registration, ctx) => {
  if (registration.registry.originalSha256 !== registration.original.sha256) {
    ctx.addIssue({ code: "custom", message: "Search registry must belong to the registered Original" });
  }
  if (new Set(registration.states.map(state => state.stateId)).size !== 4) {
    ctx.addIssue({ code: "custom", message: "Every finite state needs an independent unique identity" });
  }
  if (registration.states[1].value === registration.states[2].value) {
    ctx.addIssue({ code: "custom", message: "Positive and negative query intents must use distinct literals" });
  }
});
export type HtmlProtectionSearchStateRegistration = z.infer<typeof HtmlProtectionSearchStateRegistrationSchema>;

/** Constructor expectation is trusted-controller input, not a per-step client command. */
export const HtmlProtectionSearchStateSessionSchema = HtmlProtectionSearchStateRequestSchema
  .omit({ schemaVersion: true, stateId: true, stateKind: true })
  .extend({ frameId: identity, loaderId: identity }).strict();
export type HtmlProtectionSearchStateSession = z.infer<typeof HtmlProtectionSearchStateSessionSchema>;

const inputFact = z.object({
  matchCount: z.number().int().nonnegative(), backendNodeId: z.number().int().positive().nullable(),
  id: z.string().nullable(), tag: z.string().nullable(), namespace: z.string().nullable(),
  type: z.string().nullable(), value: value.nullable(), disabled: z.boolean().nullable(), readOnly: z.boolean().nullable(),
}).strict();
/**
 * Fixed native input observation port material. Its producer must independently obtain
 * isolated/native DOM and served-byte facts; these labels and Zod alone are not authority.
 */
export const HtmlProtectionSearchInputObservationSchema = z.object({
  schemaVersion: z.literal("html-protection-search-input-observation-v1"),
  availability: z.enum(["available", "unavailable"]),
  frameId: identity.optional(), loaderId: identity.optional(),
  physicalInput: z.object({ sha256, byteLength: z.number().int().positive() }).strict(),
  input: inputFact.optional(),
  gaps: z.array(HtmlProtectionSearchStateGapSchema).max(64),
}).strict().superRefine((observation, ctx) => {
  if (observation.availability === "available" && (!observation.frameId || !observation.loaderId || !observation.input || observation.gaps.length)) {
    ctx.addIssue({ code: "custom", message: "Available native input requires document identity, material and no gaps" });
  }
  if (observation.availability === "unavailable" && observation.input) {
    ctx.addIssue({ code: "custom", message: "Unavailable read cannot supply selected input facts" });
  }
  if (observation.input && observation.input.matchCount !== 1
    && Object.entries(observation.input).some(([key, field]) => key !== "matchCount" && field !== null)) {
    ctx.addIssue({ code: "custom", message: "Missing/ambiguous input cannot choose one matching node" });
  }
});
export type HtmlProtectionSearchInputObservation = z.infer<typeof HtmlProtectionSearchInputObservationSchema>;
