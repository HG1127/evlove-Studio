import { createHash } from "node:crypto";
import { z } from "zod";
import { HtmlProtectionWholeRuntimeActionFactSchema, type ArtifactStorePort, type HtmlProtectionEvidence, type HtmlProtectionObligation } from "@evolution/contracts";
import { HTML_PROTECTION_AUTHORITY_POLICY, assembleHtmlProtectionProof, deriveHtmlProtectionStaticObservations,
  HTML_PROTECTION_OPERATIONAL_RUNTIME_ID, assessHtmlProtectionOperationalAcceptance, supportHtmlProtectionObservedObligations, assessHtmlProtectionWholeRuntimeObservationCoverage, htmlProtectionWholeRuntimeSourcePlan, htmlProtectionWholeSubjectScriptLocations } from "@evolution/core";
import { HtmlProtectionWholeCloudManifestSchema, HtmlProtectionWholePrivateRecordSchema,
  validateHtmlProtectionWholeReadback, HtmlProtectionOwnedRuntimeBindingSchema } from "@evolution/adapters/sandbox";
import type { prepareServerHtmlProtectionAuthorityPlan } from "./server-html-protection-authority-plan";
import { htmlProtectionCanonicalJson } from "./server-html-protection-authority-attestation";
import { readStoredServerHtmlProtectionNativeRecord } from "./server-html-protection-authority-store";
import { prepareServerHtmlProtectionSemanticComponents, validateServerHtmlProtectionSemanticObservations } from "./server-html-protection-semantic-observation";
import { prepareServerHtmlProtectionVisualPairs, validateServerHtmlProtectionVisualObservations } from "./server-html-protection-visual-observation";
import type { ServerHtmlProtectionAuthorityObservations } from "./server-html-protection-authority-envelope";
export type ServerHtmlProtectionAuthorityPrepared = Awaited<ReturnType<typeof prepareServerHtmlProtectionAuthorityPlan>>;
export type ServerHtmlProtectionAuthorityRuntimeBinding = z.infer<typeof HtmlProtectionOwnedRuntimeBindingSchema>;
const sha = (value: unknown) => createHash("sha256").update(htmlProtectionCanonicalJson(value)).digest("hex");
/** Actual parts are re-read before any native material is used. An authenticated wrapper cannot substitute this step. */
export async function readServerHtmlProtectionAuthorityNative(args: { prepared: ServerHtmlProtectionAuthorityPrepared;
  native: ServerHtmlProtectionAuthorityObservations["native"]; observationNotAfter: string; runtimeBinding: ServerHtmlProtectionAuthorityRuntimeBinding; store?: ArtifactStorePort }) {
  const notAfter = Date.parse(args.observationNotAfter);
  if (!Number.isFinite(notAfter)) throw Error("html-protection-native-observation-clock-invalid");
  const expectedSourcePlan = htmlProtectionWholeRuntimeSourcePlan({ original: args.prepared.binding.original, html: args.prepared.physicalInputs.original.toString("utf8") });
  const roles = {} as Record<"original" | "executed", { manifest: z.infer<typeof HtmlProtectionWholeCloudManifestSchema>;
    records: Array<{ record: z.infer<typeof HtmlProtectionWholePrivateRecordSchema>; material: unknown }> }>;
  for (const role of ["original", "executed"] as const) {
    const stored = args.native[role], manifest = HtmlProtectionWholeCloudManifestSchema.parse(stored.manifest), records = [];
    if (manifest.request.sourceRole !== role || htmlProtectionCanonicalJson(manifest.request.binding) !== htmlProtectionCanonicalJson(args.prepared.binding)
      || htmlProtectionCanonicalJson(manifest.request.execution) !== htmlProtectionCanonicalJson(args.prepared.execution)) throw Error("html-protection-native-scope-or-execution-foreign");
    for (const item of stored.records) {
      const record = HtmlProtectionWholePrivateRecordSchema.parse(item.record);
      const read = await readStoredServerHtmlProtectionNativeRecord({ missionId: args.prepared.binding.missionId,
        jobId: manifest.request.execution.jobId, role, artifactId: item.artifactId, record, store: args.store });
      if (record.kind === "action") { const fact = HtmlProtectionWholeRuntimeActionFactSchema.parse(read.material);
        if (Date.parse(fact.startedAt) > notAfter || Date.parse(fact.completedAt) > notAfter) throw Error("html-protection-native-future-observation"); }
      records.push({ record, material: read.material });
    }
    validateHtmlProtectionWholeReadback({ manifest, records, expectedRequest: { ...manifest.request, binding: args.prepared.binding,
      sourcePlan: expectedSourcePlan, sourcePlanSha256: sha(expectedSourcePlan), sourceRole: role,
      subjectScriptLocations: htmlProtectionWholeSubjectScriptLocations({ sourcePlan: expectedSourcePlan, html: args.prepared.physicalInputs[role].toString("utf8") }),
      execution: args.prepared.execution,
      registration: role === "executed" ? roles.original.manifest.registration : undefined }, trustedRuntimeBinding: args.runtimeBinding });
    roles[role] = { manifest, records };
  }
  if (htmlProtectionCanonicalJson(roles.original.manifest.request.sourcePlan) !== htmlProtectionCanonicalJson(roles.executed.manifest.request.sourcePlan)) throw Error("html-protection-native-original-plan-foreign");
  return roles;
}
/** Pure observation conversion after physical native/producer validation; no saved proof or saved support flags are consumed. */
export function deriveServerHtmlProtectionAuthorityObservations(args: { prepared: ServerHtmlProtectionAuthorityPrepared;
  roles: Awaited<ReturnType<typeof readServerHtmlProtectionAuthorityNative>>; sourcePlan: Parameters<typeof assessHtmlProtectionWholeRuntimeObservationCoverage>[0]["sourcePlan"];
  semanticRaw: readonly unknown[]; visualRaw: readonly unknown[]; observedAt: string }) {
  const { prepared, roles } = args, originalHtml = prepared.physicalInputs.original.toString("utf8"), executedHtml = prepared.physicalInputs.executed.toString("utf8");
  const runtime = assessHtmlProtectionWholeRuntimeObservationCoverage({ sourcePlan: args.sourcePlan, original: roles.original, executed: roles.executed });
  const operationalRuntime = prepared.operationalScope ? [{ obligationId: HTML_PROTECTION_OPERATIONAL_RUNTIME_ID,
    verificationStatus: runtime.knownBehaviorFailures.length ? "failed" as const : runtime.completeNativeSequence ? "verified" as const : "unverified" as const }] : [];
  const operationalSupported = prepared.operationalScope && runtime.completeNativeSequence ? [HTML_PROTECTION_OPERATIONAL_RUNTIME_ID] : [];
  const statics = deriveHtmlProtectionStaticObservations({ plan: prepared.obligationPlan, originalHtml, executedHtml });
  const documents = (role: "original" | "executed") => roles[role].records.filter(item => item.record.kind === "document").map(item => ({ stateId: item.record.stateId, material: item.material }));
  const originalDocuments = documents("original"), executedDocuments = documents("executed");
  const expectedDocumentStates = roles.original.manifest.expectedActions.filter(item => ["boot", "viewport"].includes(item.operation)).map(item => item.stateId);
  const bootState = roles.original.manifest.expectedActions.find(item => item.operation === "boot")?.stateId;
  const components = prepareServerHtmlProtectionSemanticComponents({ plan: prepared.obligationPlan, originalHtml, executedHtml,
    originalNativeDocument: originalDocuments.find(item => item.stateId === bootState)?.material,
    executedNativeDocument: executedDocuments.find(item => item.stateId === bootState)?.material,
    executedInventory: statics.comparison.current, nativeComplete: runtime.completeNativeSequence, frozenRequirements: prepared.semanticRequirements });
  const semantic = validateServerHtmlProtectionSemanticObservations({ components, raw: args.semanticRaw, required: prepared.obligationPlan.requiredObligations });
  let visual: Omit<ReturnType<typeof validateServerHtmlProtectionVisualObservations>,"evidence"> & {
    evidence: {obligationId:string;verificationStatus:HtmlProtectionEvidence["verificationStatus"];detail:string}[];
  };
  try {
    const pairs = prepareServerHtmlProtectionVisualPairs({ originalTiles: roles.original.records.filter(item => item.record.kind === "visual-tile").map(item => ({ stateId: item.record.stateId, material: item.material })),
      executedTiles: roles.executed.records.filter(item => item.record.kind === "visual-tile").map(item => ({ stateId: item.record.stateId, material: item.material })), expectedDocumentStates, nativeComplete: runtime.completeNativeSequence,
      ...(prepared.operationalScope ? {operationalDocuments:{original:originalDocuments,executed:executedDocuments}} : {}) });
    const unresolvedRuntime = prepared.obligationPlan.requiredObligations.filter(item => item.evidenceKind === "browser" && !(prepared.operationalScope && item.kind === "unknown-runtime") && ![...runtime.supportedObligationIds,...operationalSupported].includes(item.id)).map(item => item.id);
    visual = validateServerHtmlProtectionVisualObservations({ pairs, raw: args.visualRaw, required: prepared.obligationPlan.requiredObligations, unresolvedRuntimeObligationIds: unresolvedRuntime });
  } catch {
    if (args.visualRaw.length) throw Error("html-protection-saved-visual-observations-cannot-be-rebound");
    visual = { raw: [], supportedObligationIds: [], evidence: prepared.obligationPlan.requiredObligations.filter(item => item.evidenceKind === "visual").map(item => ({ obligationId: item.id,
      verificationStatus: "unverified" as const, detail: "Complete actual paired visual observations are unavailable" })), gaps: ["html-protection-full-visual-observation-unavailable"] };
  }
  const supported = [...new Set([...statics.supportedObligationIds, ...semantic.supportedObligationIds, ...visual.supportedObligationIds, ...runtime.supportedObligationIds, ...operationalSupported])];
  const requiredObligations = supportHtmlProtectionObservedObligations(prepared.obligationPlan.requiredObligations, supported);
  const observations = [...statics.staticFacts.map(item => ({ ...item, kind: "static" as const })), ...[...runtime.evidence, ...operationalRuntime].map(item => ({ ...item, kind: "browser" as const })),
    ...runtime.knownBehaviorFailures.map(item => ({ ...item, obligationId: prepared.obligationPlan.scope.document.runtimeResidual, kind: "browser" as const })),
    ...semantic.evidence.map(item => ({ ...item, kind: "semantic" as const })), ...visual.evidence.map(item => ({ ...item, kind: "visual" as const }))];
  const trustedEvidence: HtmlProtectionEvidence[] = observations.map((item, index) => ({ schemaVersion: "html-protection-evidence-v1", id: "observed:" + index + ":" + sha(item).slice(0,32),
    binding: prepared.binding, kind: item.kind, producer: ({ static: "core-static", browser: "browser-runner", semantic: "semantic-runtime", visual: "visual-judge" } as const)[item.kind],
    obligationIds: [item.obligationId], verificationStatus: item.verificationStatus, observedAt: args.observedAt }));
  // Every missing child/residual remains represented, including the complete document residual.
  for (const item of requiredObligations.filter(item => item.evidenceKind === "browser" && !trustedEvidence.some(value => value.obligationIds.includes(item.id)))) trustedEvidence.push({
    schemaVersion: "html-protection-evidence-v1", id: "missing:" + sha(item).slice(0,32), binding: prepared.binding, kind: "browser", producer: "browser-runner",
    obligationIds: [item.id], verificationStatus: "unverified", observedAt: args.observedAt });
  const assembled = assembleHtmlProtectionProof({ binding: prepared.binding, requiredObligations, trustedEvidence });
  const operationalAcceptance = prepared.operationalScope ? assessHtmlProtectionOperationalAcceptance({ scope: prepared.operationalScope, validation: assembled.validation, requiredObligations }) : undefined;
  return { ...assembled, operationalAcceptance, requiredObligations: requiredObligations as HtmlProtectionObligation[], trustedEvidence, components, runtime, semantic, visual,
    policyVersion: HTML_PROTECTION_AUTHORITY_POLICY, planSha256: sha({ policy: HTML_PROTECTION_AUTHORITY_POLICY, preparedPlan: prepared.planSha256,
      semanticRequirementsSha256: prepared.semanticRequirementsSha256, sourcePlan: args.sourcePlan, requiredObligations }) };
}

/** Honest static fallback preserves known product losses while keeping every unobserved runtime/semantic/visual scope unresolved. */
export function deriveServerHtmlProtectionAuthorityStaticObservations(args: { prepared: ServerHtmlProtectionAuthorityPrepared; observedAt: string }) {
  const { prepared } = args, statics = deriveHtmlProtectionStaticObservations({ plan: prepared.obligationPlan,
    originalHtml: prepared.physicalInputs.original.toString("utf8"), executedHtml: prepared.physicalInputs.executed.toString("utf8") });
  const requiredObligations = supportHtmlProtectionObservedObligations(prepared.obligationPlan.requiredObligations, statics.supportedObligationIds);
  const trustedEvidence: HtmlProtectionEvidence[] = requiredObligations.map((item, index) => ({ schemaVersion: "html-protection-evidence-v1", id: "static-fallback:" + index,
    binding: prepared.binding, kind: item.evidenceKind, producer: ({ static: "core-static", browser: "browser-runner", semantic: "semantic-runtime", visual: "visual-judge", manual: "human" } as const)[item.evidenceKind],
    obligationIds: [item.id], verificationStatus: statics.staticFacts.find(fact => fact.obligationId === item.id)?.verificationStatus ?? "unverified", observedAt: args.observedAt }));
  return { ...assembleHtmlProtectionProof({ binding: prepared.binding, requiredObligations, trustedEvidence }), operationalAcceptance: undefined, requiredObligations, trustedEvidence,
    planSha256: sha({ policy: HTML_PROTECTION_AUTHORITY_POLICY, mode: "physical-static", preparedPlan: prepared.planSha256, semanticRequirementsSha256: prepared.semanticRequirementsSha256, requiredObligations }) };
}
/** Prefix bytes are retained and re-read for audit; missing custody never turns them into native PASS/failure authority. */
export async function readServerHtmlProtectionAuthorityStaticPrefix(args: { prepared: ServerHtmlProtectionAuthorityPrepared;
  observations: ServerHtmlProtectionAuthorityObservations; execution: { executionId: string; jobId: string; generation: number }; store?: ArtifactStorePort }) {
  if (args.observations.collectionMode !== "physical-static" || args.observations.semanticRaw.length || args.observations.visualRaw.length) throw Error("html-protection-static-fallback-scope-invalid");
  const Unavailable = z.object({ schemaVersion: z.literal("html-protection-native-unavailable-v1"), sourceRole: z.enum(["original", "executed"]),
    binding: z.unknown(), execution: z.unknown(), reason: z.literal("complete-native-producer-unavailable") }).strict();
  for (const role of ["original", "executed"] as const) {
    const value = args.observations.native[role], manifest = Unavailable.parse(value.manifest);
    if (manifest.sourceRole !== role || htmlProtectionCanonicalJson(manifest.binding) !== htmlProtectionCanonicalJson(args.prepared.binding)
      || htmlProtectionCanonicalJson(manifest.execution) !== htmlProtectionCanonicalJson(args.execution)) throw Error("html-protection-static-prefix-subject-or-owner-foreign");
    if (new Set(value.records.map(item => item.artifactId)).size !== value.records.length) throw Error("html-protection-static-prefix-record-duplicate");
    for (const item of value.records) { const record = HtmlProtectionWholePrivateRecordSchema.parse(item.record);
      await readStoredServerHtmlProtectionNativeRecord({ missionId: args.prepared.binding.missionId, jobId: args.execution.jobId, role, artifactId: item.artifactId, record, store: args.store }); }
  }
}
