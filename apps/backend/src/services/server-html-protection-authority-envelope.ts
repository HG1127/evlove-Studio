import { createHash } from "node:crypto";
import { z } from "zod";
import { HtmlProtectionProofSchema, TargetRunResultSchema, HtmlProtectionAuthorityReferenceSchema, type ArtifactStorePort } from "@evolution/contracts";
import { ServerHtmlProtectionAuthorityAttestationSchema, htmlProtectionCanonicalJson, htmlProtectionCanonicalRun } from "./server-html-protection-authority-attestation";
import { writeVerifiedServerHtmlProtectionBlob, readVerifiedServerHtmlProtectionBlob } from "./server-html-protection-authority-store";
const NativeRecord = z.object({ record: z.unknown(), artifactId: z.string().min(1).max(512) }).strict();
const NativeRole = z.object({ manifest: z.unknown(), records: z.array(NativeRecord).max(25000) }).strict();
export const ServerHtmlProtectionAuthorityObservationSchema = z.object({ schemaVersion: z.literal("html-protection-authority-observations-v2"),
  selectionIdentitySha256:z.string().regex(/^[a-f0-9]{64}$/),
  collectionMode: z.enum(["whole-native", "physical-static"]),
  native: z.object({ original: NativeRole, executed: NativeRole }).strict(),
  semanticRaw: z.array(z.unknown()).max(1000), visualRaw: z.array(z.unknown()).max(10000), gaps: z.array(z.string().max(2048)).max(1000),
}).strict().refine(value => value.collectionMode === "whole-native" || (!value.semanticRaw.length && !value.visualRaw.length), "Static fallback cannot carry claimed semantic/visual authority");
export const ServerHtmlProtectionAuthorityEnvelopeSchema = z.object({ schemaVersion: z.literal("html-protection-authority-envelope-v2"),
  attestation: ServerHtmlProtectionAuthorityAttestationSchema, proof: HtmlProtectionProofSchema,
  canonicalRun: TargetRunResultSchema.strict(), observations: ServerHtmlProtectionAuthorityObservationSchema,
}).strict();
export type ServerHtmlProtectionAuthorityObservations = z.infer<typeof ServerHtmlProtectionAuthorityObservationSchema>;
export const serverHtmlProtectionObservationSha256 = (raw: ServerHtmlProtectionAuthorityObservations) =>
  createHash("sha256").update(htmlProtectionCanonicalJson(ServerHtmlProtectionAuthorityObservationSchema.parse(raw))).digest("hex");
/** Private integrity persistence only. A stored signature/proof is never registered as Core authority here. */
export async function persistServerHtmlProtectionAuthorityEnvelope(args: { envelope: z.infer<typeof ServerHtmlProtectionAuthorityEnvelopeSchema>; store?: ArtifactStorePort }) {
  const envelope = ServerHtmlProtectionAuthorityEnvelopeSchema.parse(args.envelope), attestation = envelope.attestation,
    execution = attestation.executionAttestation.execution, binding = attestation.executionAttestation.binding;
  if (serverHtmlProtectionObservationSha256(envelope.observations) !== attestation.observationSha256
    || envelope.observations.selectionIdentitySha256!==attestation.selectionIdentitySha256
    || htmlProtectionCanonicalJson(envelope.canonicalRun) !== htmlProtectionCanonicalJson(htmlProtectionCanonicalRun(envelope.canonicalRun))) throw Error("html-protection-envelope-canonical-material-invalid");
  const bytes = Buffer.from(htmlProtectionCanonicalJson(envelope));
  const saved = await writeVerifiedServerHtmlProtectionBlob({ missionId: binding.missionId, jobId: execution.jobId,
    kind: "html-protection-authority-envelope", bytes, store: args.store });
  const reference = HtmlProtectionAuthorityReferenceSchema.parse({ schemaVersion: "html-protection-authority-reference-v1", ...saved,
    criterionId: binding.criterionId, executionId: execution.executionId, jobId: execution.jobId, generation: execution.generation,
    inputSha256: attestation.inputSha256, planSha256: attestation.planSha256, scoringRouteFingerprint: attestation.scoringRouteFingerprint,
    policyVersion: attestation.executionAttestation.policyVersion, observedAt: execution.observedAt, expiresAt: execution.expiresAt });
  await readServerHtmlProtectionAuthorityEnvelope({ reference, missionId: binding.missionId, store: args.store });
  return reference;
}
/** Full blob bytes and metadata are re-read; references have no authority and cannot renew expiry. */
export async function readServerHtmlProtectionAuthorityEnvelope(args: { reference: unknown; missionId: string; store?: ArtifactStorePort }) {
  const reference = HtmlProtectionAuthorityReferenceSchema.parse(args.reference);
  const bytes = await readVerifiedServerHtmlProtectionBlob({ ...reference, missionId: args.missionId,
    kind: "html-protection-authority-envelope", store: args.store });
  const envelope = ServerHtmlProtectionAuthorityEnvelopeSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))),
    signed = envelope.attestation, execution = signed.executionAttestation.execution, binding = signed.executionAttestation.binding;
  if (binding.missionId !== args.missionId || binding.criterionId !== reference.criterionId || execution.jobId !== reference.jobId
    || execution.executionId !== reference.executionId || execution.generation !== reference.generation
    || execution.observedAt !== reference.observedAt || execution.expiresAt !== reference.expiresAt
    || signed.inputSha256 !== reference.inputSha256 || signed.planSha256 !== reference.planSha256
    || signed.scoringRouteFingerprint !== reference.scoringRouteFingerprint || signed.executionAttestation.policyVersion !== reference.policyVersion
    || signed.selectionIdentitySha256!==envelope.observations.selectionIdentitySha256
    || signed.observationSha256 !== serverHtmlProtectionObservationSha256(envelope.observations)) throw Error("html-protection-envelope-reference-or-observation-drift");
  return envelope;
}
