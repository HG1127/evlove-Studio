import { z } from "zod";
import {
  HtmlProtectionSearchStateGapSchema, HtmlProtectionSearchStateRegistrationSchema,
  HtmlProtectionSearchStateRequestSchema, HtmlProtectionSnapshotRequestSchema, HtmlProtectionSnapshotResultSchema,
} from "@evolution/contracts";
import {
  HTML_PROTECTION_CLOUD_LIMITS, HTML_PROTECTION_CLOUD_PATHS, HTML_PROTECTION_CLOUD_URL,
  HtmlProtectionCloudGapSchema, HtmlProtectionCloudObservationSchema, HtmlProtectionOwnedRuntimeBindingSchema,
  htmlProtectionCloudCanonicalJson as canonical, htmlProtectionCloudSha256 as sha,
} from "./vercel-sandbox-html-protection-cloud-protocol";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const nonce = digest;
const material = z.object({ sha256: digest, byteLength: z.number().int().positive().max(HTML_PROTECTION_CLOUD_LIMITS.htmlBytes) }).strict();
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const inputObject = z.object({
  schemaVersion: z.literal("html-protection-private-search-input-v1"),
  nonce, request: HtmlProtectionSnapshotRequestSchema,
  material, ownedRuntime: HtmlProtectionOwnedRuntimeBindingSchema,
  registration: HtmlProtectionSearchStateRegistrationSchema,
  stateRequests: z.tuple([HtmlProtectionSearchStateRequestSchema, HtmlProtectionSearchStateRequestSchema,
    HtmlProtectionSearchStateRequestSchema, HtmlProtectionSearchStateRequestSchema]),
  snapshotRequests: z.tuple([HtmlProtectionSnapshotRequestSchema, HtmlProtectionSnapshotRequestSchema,
    HtmlProtectionSnapshotRequestSchema, HtmlProtectionSnapshotRequestSchema]),
}).strict();
function anchor(value: z.infer<typeof HtmlProtectionSearchStateRequestSchema> | z.infer<typeof HtmlProtectionSnapshotRequestSchema>) {
  return { binding: value.binding, sourceRole: value.sourceRole, policyVersion: value.policyVersion,
    planSha256: value.planSha256, registrySha256: value.registrySha256, execution: value.execution, batchId: value.batchId };
}
function issue(ctx: z.RefinementCtx, message: string) { ctx.addIssue({ code: "custom", message }); }
function byteBudget(value: unknown, maximum: number, ctx: z.RefinementCtx) {
  try {
    if (Buffer.byteLength(canonical(value), "utf8") > maximum) issue(ctx, "Canonical private material exceeds the byte budget; truncation is forbidden");
  } catch { issue(ctx, "Private material must be plain JSON; optional absent facts must be omitted"); }
}
/**
 * Private controller protocol. Original-only registration and runtime/physical custody
 * must be independently established; DTO parsing, digests and labels are not authority.
 * This extends no public proof and accepts no script, environment or general action.
 */
export const HtmlProtectionSearchCloudInputSchema = inputObject.superRefine((input, ctx) => {
  const first = input.snapshotRequests[0], registration = input.registration;
  if (!same(input.request, first)) issue(ctx, "The served request anchor must be the exact boot snapshot request");
  if (!same(registration.original, first.binding.original) || registration.policyVersion !== first.policyVersion
    || registration.planSha256 !== first.planSha256 || registration.registrySha256 !== first.registrySha256
    || sha(canonical(registration.registry)) !== first.registrySha256) issue(ctx, "Unbound independently registered Original scope");
  const selected = first.binding[first.sourceRole];
  if (input.material.sha256 !== selected.sha256 || input.material.byteLength !== selected.byteLength) issue(ctx, "Wrong physical source role");
  for (let index = 0; index < 4; index++) {
    const state = input.stateRequests[index], snapshot = input.snapshotRequests[index], registered = registration.states[index];
    if (!same(anchor(state), anchor(first)) || !same(anchor(snapshot), anchor(first))
      || state.stateId !== registered.stateId || state.stateKind !== registered.stateKind
      || snapshot.stateId !== registered.stateId || snapshot.documentUrl !== HTML_PROTECTION_CLOUD_URL
      || snapshot.registry.projection !== "search-membership-v1" || !same(snapshot.registry, registration.registry)) {
      issue(ctx, "All four requests must follow the exact closed Original state order and shared binding");
    }
  }
  byteBudget(input, HTML_PROTECTION_CLOUD_LIMITS.inputBytes, ctx);
});
export type HtmlProtectionSearchCloudInput = z.infer<typeof HtmlProtectionSearchCloudInputSchema>;
/** Hash the full parsed input, including all states/registrations/custody metadata, never just its boot anchor. */
export function htmlProtectionSearchCloudInputSha256(input: unknown): string {
  return sha(canonical(HtmlProtectionSearchCloudInputSchema.parse(input)));
}

const actionFacts = z.object({
  request: HtmlProtectionSearchStateRequestSchema.optional(),
  fillCalls: z.union([z.literal(0), z.literal(1)]), fillSettled: z.boolean(),
  beforeValue: z.string().max(4096).optional(), afterValue: z.string().max(4096).optional(),
  executionRecorded: z.boolean(), gaps: z.array(HtmlProtectionSearchStateGapSchema).max(64),
}).strict();
const linkFacts = z.object({ linked: z.boolean(), gaps: z.array(HtmlProtectionSearchStateGapSchema).max(64) }).strict();
/**
 * Identity of the complete rejected canonical native DTO, never selected content or
 * an available native observation. Its size can exceed the output packet budget;
 * the small receipt itself still obeys that budget. The producer must measure it.
 */
export const HtmlProtectionSearchCloudRejectedSnapshotSchema = z.object({
  sha256: digest, byteLength: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.enum(["aggregate-private-file-limit", "document-binding-mismatch"]),
}).strict();
export type HtmlProtectionSearchCloudRejectedSnapshot = z.infer<typeof HtmlProtectionSearchCloudRejectedSnapshotSchema>;
export const HtmlProtectionSearchCloudStepSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("observed"), stateRequest: HtmlProtectionSearchStateRequestSchema,
    actionFacts, snapshot: HtmlProtectionSnapshotResultSchema, linkFacts }).strict(),
  z.object({ status: z.literal("action-failed"), stateRequest: HtmlProtectionSearchStateRequestSchema,
    actionFacts: actionFacts.extend({ executionRecorded: z.literal(false) }) }).strict(),
  z.object({ status: z.literal("observation-rejected"), stateRequest: HtmlProtectionSearchStateRequestSchema,
    actionFacts: actionFacts.extend({ executionRecorded: z.literal(true) }),
    rejectedSnapshot: HtmlProtectionSearchCloudRejectedSnapshotSchema }).strict(),
  z.object({ status: z.literal("not-executed"), stateRequest: HtmlProtectionSearchStateRequestSchema,
    reason: z.literal("prior-step-unavailable") }).strict(),
]).superRefine((step, ctx) => {
  if (step.status === "not-executed") return;
  const facts = step.actionFacts;
  if (facts.request && !same(facts.request, step.stateRequest)) issue(ctx, "Action facts belong to another state request");
  if (facts.fillSettled && facts.fillCalls !== 1) issue(ctx, "A fill cannot settle without one dispatched call");
  if (step.stateRequest.stateKind === "boot" && (facts.fillCalls !== 0 || facts.fillSettled)) issue(ctx, "Boot never dispatches fill");
  if (facts.executionRecorded && (facts.gaps.length || facts.beforeValue === undefined || facts.afterValue === undefined
    || (step.stateRequest.stateKind !== "boot" && (facts.fillCalls !== 1 || !facts.fillSettled)))) issue(ctx, "Recorded state requires complete local action/input facts");
  if (!facts.executionRecorded && !facts.gaps.length) issue(ctx, "Incomplete execution must retain a gap");
  if (step.status === "observed") {
    if (step.linkFacts.linked && (step.linkFacts.gaps.length || !facts.executionRecorded
      || step.snapshot.availability !== "available" || !step.snapshot.projectionComplete
      || step.snapshot.gaps.length || step.snapshot.body?.gaps.length)) issue(ctx, "A link cannot hide incomplete state/snapshot material");
    if (!step.linkFacts.linked && !step.linkFacts.gaps.length) issue(ctx, "A missing link must retain its gap");
  }
});
export type HtmlProtectionSearchCloudStep = z.infer<typeof HtmlProtectionSearchCloudStepSchema>;
const steps = z.tuple([HtmlProtectionSearchCloudStepSchema, HtmlProtectionSearchCloudStepSchema,
  HtmlProtectionSearchCloudStepSchema, HtmlProtectionSearchCloudStepSchema]);
const custody = HtmlProtectionCloudObservationSchema.options[0].shape.custody
  // Keep actual late blocked-resource counts on an unavailable prefix; available still requires zero.
  .extend({ blockedRequests: z.number().int().nonnegative().max(1_000_000) }).strict();
export const HtmlProtectionSearchCloudGapSchema = z.union([HtmlProtectionCloudGapSchema, HtmlProtectionSearchStateGapSchema,
  z.enum(["state-execution-unavailable", "snapshot-unavailable", "case-timeout"])]);
/** Explicit post-sequence owner/custody failures retain the truthful complete prefix. */
export const HtmlProtectionSearchCloudTerminalFailureReasonSchema = z.enum([
  "case-timeout", "deadline-exceeded", "document-mismatch", "physical-input-mismatch",
  "aborted", "session-unavailable", "served-material-mismatch", "runtime-integrity",
]);
export type HtmlProtectionSearchCloudTerminalFailureReason = z.infer<typeof HtmlProtectionSearchCloudTerminalFailureReasonSchema>;
const observationBase = z.object({
  schemaVersion: z.literal("html-protection-private-search-observation-v1"),
  nonce, request: HtmlProtectionSnapshotRequestSchema,
  batchRequestSha256: digest, ownedRuntime: HtmlProtectionOwnedRuntimeBindingSchema,
  input: HtmlProtectionSearchCloudInputSchema,
});
const available = observationBase.extend({ availability: z.literal("available"), custody, steps }).strict();
const beforeStartup = observationBase.extend({ availability: z.literal("unavailable"), phase: z.literal("before-startup"),
  reason: HtmlProtectionSearchCloudGapSchema }).strict();
const afterStartup = observationBase.extend({ availability: z.literal("unavailable"), phase: z.literal("after-startup"),
  reason: HtmlProtectionSearchCloudGapSchema, custody, steps }).strict();
type BatchObservation = z.infer<typeof available> | z.infer<typeof afterStartup>;
function complete(step: HtmlProtectionSearchCloudStep): boolean {
  return step.status === "observed" && step.actionFacts.executionRecorded && step.linkFacts.linked
    && step.snapshot.availability === "available" && step.snapshot.projectionComplete
    && !step.snapshot.gaps.length && !step.snapshot.body?.gaps.length;
}
function validateBatch(observation: BatchObservation, ctx: z.RefinementCtx) {
  const input = observation.input;
  for (const value of [observation.custody.staged, observation.custody.nodeResponse, observation.custody.browserResponse]) {
    if (!same(value, input.material)) issue(ctx, "Custody physical bytes differ from the exact selected source role");
  }
  let interrupted = false;
  for (let index = 0; index < 4; index++) {
    const step = observation.steps[index], registered = input.registration.states[index];
    if (!same(step.stateRequest, input.stateRequests[index])) issue(ctx, "Missing, duplicate or foreign state facts");
    if (interrupted && step.status !== "not-executed") issue(ctx, "No later execution may follow an unavailable step");
    if (!interrupted && step.status === "not-executed") issue(ctx, "A placeholder requires a preceding unavailable step");
    if (step.status === "not-executed") continue;
    const targetValue = registered.stateKind === "boot" ? input.registration.input.initialValue : registered.value;
    const prior = index <= 1 ? input.registration.input.initialValue
      : index === 2 ? input.registration.states[1].value : input.registration.states[2].value;
    if (step.actionFacts.executionRecorded && (step.actionFacts.beforeValue !== prior || step.actionFacts.afterValue !== targetValue)) {
      issue(ctx, "Recorded input facts do not match the closed Original literals");
    }
    if (step.status === "observed") {
      const snapshot = step.snapshot;
      if (!same(snapshot.request, input.snapshotRequests[index]) || !same(snapshot.physicalInput, input.material)) {
        issue(ctx, "Snapshot belongs to another request or physical role");
      }
      if (snapshot.availability === "available" && snapshot.body) {
        try {
          const encoded = canonical(snapshot.body);
          if (sha(encoded) !== snapshot.bodySha256 || Buffer.byteLength(encoded, "utf8") !== snapshot.bodyUtf8Bytes) {
            issue(ctx, "Native body digest/actual byte count mismatch; DTO consistency is not provenance");
          }
        } catch { issue(ctx, "Native body must be plain JSON"); }
      }
      if (snapshot.realm && (snapshot.realm.frameId !== observation.custody.navigation.frameId
        || snapshot.realm.loaderId !== observation.custody.navigation.loaderId)) issue(ctx, "Cross-page/document snapshot cannot join this batch");
      if (snapshot.availability === "available" && (snapshot.body?.projection !== "search-membership-v1"
        || snapshot.body.targetId !== input.registration.registry.targetId)) issue(ctx, "Wrong registered search projection");
      if (step.linkFacts.linked && (snapshot.body?.projection !== "search-membership-v1"
        || snapshot.body.input.matchCount !== 1 || snapshot.body.input.tag !== "INPUT" || snapshot.body.input.value !== targetValue)) {
        issue(ctx, "Linked input facts do not match the registered state");
      }
    }
    if (!complete(step)) interrupted = true;
  }
  if (observation.availability === "available" && (interrupted || observation.custody.blockedRequests !== 0)) {
    issue(ctx, "Available batch requires all four complete observed local states and unblocked custody");
  }
  if (observation.availability === "unavailable" && !interrupted && observation.custody.blockedRequests === 0
    && !HtmlProtectionSearchCloudTerminalFailureReasonSchema.safeParse(observation.reason).success) {
    issue(ctx, "Unavailable after startup must retain interruption, actual resource gap or an explicit terminal owner/custody failure");
  }
}
/**
 * Complete expected sequence with actual observed prefix. Not-executed placeholders are
 * explicit and contain no fake native DTO. Local availability/link facts are neither
 * observation authority nor semantics, whole preservation, signing or acceptance.
 * Available is a complete local state sequence; independent Core Original-ID scope
 * comparison still detects missing/changed native items and is not replaced here.
 * A complete historical prefix can still be unavailable when the final owner/custody
 * guard fails. Its closed reason is a controller claim, never guard provenance or PASS.
 * observation-rejected retains a real completed action plus the full rejected DTO
 * identity, then stops. Its digest cannot replace native content or its provenance.
 */
export const HtmlProtectionSearchCloudObservationSchema = z.union([available, beforeStartup, afterStartup]).superRefine((observation, ctx) => {
  if (observation.nonce !== observation.input.nonce || !same(observation.request, observation.input.request)
    || !same(observation.ownedRuntime, observation.input.ownedRuntime)
    || observation.batchRequestSha256 !== htmlProtectionSearchCloudInputSha256(observation.input)) issue(ctx, "Wrong complete batch input digest or runtime/nonce anchor");
  if (observation.availability === "available" || observation.phase === "after-startup") validateBatch(observation, ctx);
  byteBudget(observation, HTML_PROTECTION_CLOUD_LIMITS.resultBytes, ctx);
});
export type HtmlProtectionSearchCloudObservation = z.infer<typeof HtmlProtectionSearchCloudObservationSchema>;
export const HtmlProtectionSearchCloudManifestSchema = z.object({
  schemaVersion: z.literal("html-protection-private-search-manifest-v1"),
  nonce, batchRequestSha256: digest, ownedRuntimeSha256: digest, runnerSha256: digest,
  result: z.object({ path: z.literal(HTML_PROTECTION_CLOUD_PATHS.result), sha256: digest,
    byteLength: z.number().int().positive().max(HTML_PROTECTION_CLOUD_LIMITS.resultBytes) }).strict(),
}).strict();
export type HtmlProtectionSearchCloudManifest = z.infer<typeof HtmlProtectionSearchCloudManifestSchema>;
