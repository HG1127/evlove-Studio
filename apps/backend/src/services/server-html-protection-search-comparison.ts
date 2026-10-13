import { createHash } from "node:crypto";
import { z } from "zod";
import {
  HtmlProtectionSearchCloudGapSchema, HtmlProtectionSearchCloudObservationSchema,
  HTML_PROTECTION_CLOUD_LIMITS, HTML_PROTECTION_CLOUD_URL,
  htmlProtectionCloudCanonicalJson,
  type HtmlProtectionSearchObservationResult,
} from "@evolution/adapters/sandbox";
import { HtmlProtectionSnapshotRequestSchema } from "@evolution/contracts";
import {
  compareHtmlProtectionSnapshots, compareHtmlProtectionOriginalSearchReference,
  type HtmlProtectionSnapshotComparisonExpected,
} from "@evolution/core";
import type { prepareServerHtmlProtectionCollectionPlan } from "./server-html-protection-collection-plan";

type Plan = Awaited<ReturnType<typeof prepareServerHtmlProtectionCollectionPlan>>;
type Role = "original" | "executed";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const Result = z.discriminatedUnion("availability", [
  z.object({ availability: z.literal("available"), observation: HtmlProtectionSearchCloudObservationSchema,
    resultSha256: digest, resultByteLength: z.number().int().positive().max(HTML_PROTECTION_CLOUD_LIMITS.resultBytes) }).strict(),
  z.object({ availability: z.literal("unavailable"), reason: HtmlProtectionSearchCloudGapSchema }).strict(),
]);
const canonical = htmlProtectionCloudCanonicalJson;
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
type Gap = { code: string; role?: Role };
type Comparison = {
  stateId: string; stateKind: string; availability: "compared" | "unavailable";
  sequenceScope: "complete-selected-sequence" | "historical-prefix-only" | "no-comparable-native-state";
  gaps: Gap[];
  strictComparison?: ReturnType<typeof compareHtmlProtectionSnapshots>;
  originalReference?: ReturnType<typeof compareHtmlProtectionOriginalSearchReference>;
};

/**
 * Private App composition of independently prepared Original expectations and owned controller results.
 * Serialized binding/digests do not authenticate observations. No proof, whole/Hidden settlement,
 * safety or acceptance authority is supplied. Historical prefixes stay explicitly historical.
 */
export function compareCollectedServerHtmlProtectionSearchPair(args: {
  plan: Plan; original: HtmlProtectionSearchObservationResult; executed: HtmlProtectionSearchObservationResult;
}) {
  const { plan } = args, registration = plan.searchRegistration;
  const gaps: Gap[] = [], comparisons: Comparison[] = [];
  const output = () => ({
    schemaVersion: "server-html-protection-search-comparison-facts-v1" as const,
    planSha256: plan.planSha256, binding: plan.binding, comparisons, gaps,
    countFormat: plan.searchCountFormat,
    limitations: [
      "Strict raw changes and all unapproved additional members remain in every comparison.",
      "Source count format and substring membership are finite syntactic proposals, not slot meaning, JS causality or script closure.",
      "Unavailable terminal sequences retain only explicitly historical observed prefixes; later placeholders never receive comparisons.",
      "Native hidden/display membership is not visual visibility or semantic preservation.",
      "No observation authority, whole protection, paired Hidden, signing, verified, safety, authorization or acceptance verdict.",
    ],
  });
  if (!registration) { gaps.push({ code: "independent-search-registration-unavailable" }); return output(); }
  const roles = ["original", "executed"] as const;
  const expectedInputs = Object.fromEntries(roles.map(role => {
    const stateRequests = plan.searchRequests.filter(request => request.sourceRole === role);
    const snapshotRequests = stateRequests.map(({ schemaVersion: _version, stateKind: _kind, ...anchor }) => {
      void _version; void _kind;
      return HtmlProtectionSnapshotRequestSchema.parse({ ...anchor, schemaVersion: "html-protection-snapshot-request-v1",
        documentUrl: HTML_PROTECTION_CLOUD_URL, registry: registration.registry });
    });
    return [role, { stateRequests, snapshotRequests }];
  })) as Record<Role, { stateRequests: Plan["searchRequests"]; snapshotRequests: ReturnType<typeof HtmlProtectionSnapshotRequestSchema.parse>[] }>;
  const validated = Object.fromEntries(roles.map(role => {
    const parsed = Result.safeParse(args[role]);
    if (!parsed.success) { gaps.push({ code: "invalid-controller-result", role }); return [role, undefined]; }
    if (parsed.data.availability === "unavailable") {
      gaps.push({ code: "controller-result-unavailable", role }); return [role, undefined];
    }
    const result = parsed.data, observation = result.observation;
    const bytes = canonical(observation), expected = expectedInputs[role];
    if (sha(bytes) !== result.resultSha256 || Buffer.byteLength(bytes, "utf8") !== result.resultByteLength) {
      gaps.push({ code: "controller-result-identity-mismatch", role }); return [role, undefined];
    }
    if (!same(observation.input.registration, registration)
      || !same(observation.input.stateRequests, expected.stateRequests)
      || !same(observation.input.snapshotRequests, expected.snapshotRequests)
      || !same(observation.input.material, { sha256: plan.binding[role].sha256, byteLength: plan.binding[role].byteLength })) {
      gaps.push({ code: "independent-plan-binding-mismatch", role }); return [role, undefined];
    }
    if (observation.availability !== "available") gaps.push({ code: "controller-sequence-unavailable", role });
    return [role, observation];
  })) as Record<Role, z.infer<typeof HtmlProtectionSearchCloudObservationSchema> | undefined>;
  for (const [index, state] of registration.states.entries()) {
    const currentGaps: Gap[] = [], row: Comparison = {
      stateId: state.stateId, stateKind: state.stateKind, availability: "unavailable",
      sequenceScope: "no-comparable-native-state", gaps: currentGaps,
    };
    comparisons.push(row);
    const left = validated.original, right = validated.executed;
    const step = (value: typeof left) => value && (value.availability === "available" || value.phase === "after-startup") ? value.steps[index] : undefined;
    const before = step(left), after = step(right);
    // Retain both arms' fixed action/link failures before any prefix comparison decision.
    for (const role of roles) {
      const stateStep = step(validated[role]);
      if (!stateStep || stateStep.status === "not-executed") continue;
      if (!stateStep.actionFacts.executionRecorded) currentGaps.push({ code: "state-execution-unavailable", role });
      for (const code of stateStep.actionFacts.gaps) currentGaps.push({ code: "action-" + code, role });
      if (stateStep.status === "observed") {
        if (!stateStep.linkFacts.linked) currentGaps.push({ code: "state-link-unavailable", role });
        for (const code of stateStep.linkFacts.gaps) currentGaps.push({ code: "link-" + code, role });
      }
      if (stateStep.status === "observation-rejected") currentGaps.push({ code: "native-snapshot-rejected-" + stateStep.rejectedSnapshot.reason, role });
    }
    if (before?.status !== "observed" || after?.status !== "observed") {
      for (const role of roles) if (step(validated[role])?.status !== "observed") currentGaps.push({ code: "state-native-snapshot-unavailable", role });
      continue;
    }
    // Only a completed native action/link belongs to a genuinely observed historical prefix.
    if (currentGaps.length) continue;
    row.sequenceScope = left?.availability === "available" && right?.availability === "available"
      ? "complete-selected-sequence" : "historical-prefix-only";
    if (row.sequenceScope === "historical-prefix-only") currentGaps.push({ code: "historical-sequence-prefix-only" });
    const scope = plan.runtimePlan.search.states.find(item => item.stateId === state.stateId);
    const expectedOriginal = expectedInputs.original.snapshotRequests[index], expectedExecuted = expectedInputs.executed.snapshotRequests[index];
    if (!scope || !expectedOriginal || !expectedExecuted) { currentGaps.push({ code: "independent-state-scope-unavailable" }); continue; }
    const expected: HtmlProtectionSnapshotComparisonExpected = {
      binding: plan.binding, policyVersion: registration.policyVersion, planSha256: plan.planSha256,
      registrySha256: registration.registrySha256, registry: registration.registry,
      stateId: state.stateId, batchId: expectedOriginal.batchId,
      execution: { original: expectedOriginal.execution, executed: expectedExecuted.execution },
      documentUrl: { original: expectedOriginal.documentUrl, executed: expectedExecuted.documentUrl },
      registeredScopes: scope.registeredScopes,
    };
    row.strictComparison = compareHtmlProtectionSnapshots({ original: before.snapshot, executed: after.snapshot, expected });
    row.availability = "compared";
    const countTemplate = plan.searchCountFormat.availability === "available" ? plan.searchCountFormat.countTemplate : undefined;
    if (!countTemplate) currentGaps.push({ code: "original-count-format-unavailable" });
    row.originalReference = compareHtmlProtectionOriginalSearchReference({
        original: before.snapshot, executed: after.snapshot, expected,
        reference: {
          schemaVersion: "html-protection-original-search-reference-v1",
          sourceArtifactId: plan.binding.original.sourceArtifactId, originalSha256: plan.binding.original.sha256,
          policyVersion: registration.policyVersion, planSha256: plan.planSha256,
          registrySha256: registration.registrySha256, stateId: state.stateId, targetId: registration.registry.targetId,
          expectedOriginalVisibleCardIds: scope.expectedVisibleCardIds, ...(countTemplate ? { countTemplate } : {}),
        },
      });
  }
  return output();
}
