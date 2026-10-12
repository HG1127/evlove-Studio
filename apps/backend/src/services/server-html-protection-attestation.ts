import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  HtmlProtectionEvidenceSchema,
  HtmlProtectionObligationSchema,
  HtmlProtectionProofBindingSchema,
  TargetRunResultSchema,
} from "@evolution/contracts";

export const SERVER_HTML_PROTECTION_ATTESTATION_PURPOSE = "evolution-html-protection-execution-v1";
const identity = z.string().min(1).max(512);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const datetime = z.string().datetime({ offset: true });
const SigningConfigSchema = z.object({
  keyId: identity,
  key: z.string().min(32).max(4096),
  verificationKeys: z.record(identity, z.string().min(32).max(4096)),
}).strict();
export type ServerHtmlProtectionSigningConfig = z.infer<typeof SigningConfigSchema>;

const ExecutionIdentitySchema = z.object({
  executionId: identity,
  jobId: identity,
  generation: z.number().int().positive(),
}).strict();
const ExecutionSchema = ExecutionIdentitySchema.extend({ observedAt: datetime, expiresAt: datetime }).strict();
const CanonicalRunSchema = TargetRunResultSchema.strict();
const AttestationMaterialSchema = z.object({
  schemaVersion: z.literal("html-protection-attestation-v1"),
  purpose: z.literal(SERVER_HTML_PROTECTION_ATTESTATION_PURPOSE),
  policyVersion: identity,
  binding: HtmlProtectionProofBindingSchema,
  requiredObligations: z.array(HtmlProtectionObligationSchema).min(1).max(5000),
  trustedEvidence: z.array(HtmlProtectionEvidenceSchema).max(5000),
  canonicalRunSha256: sha256,
  signatureKeyId: identity,
  execution: ExecutionSchema,
}).strict();
export const ServerHtmlProtectionAttestationSchema = AttestationMaterialSchema.extend({
  signature: sha256,
}).strict();
export type ServerHtmlProtectionAttestation = z.infer<typeof ServerHtmlProtectionAttestationSchema>;
const CollectedExecutionSchema = z.object({
  policyVersion: identity,
  binding: HtmlProtectionProofBindingSchema,
  requiredObligations: z.array(HtmlProtectionObligationSchema).min(1).max(5000),
  trustedEvidence: z.array(HtmlProtectionEvidenceSchema).max(5000),
  canonicalRun: CanonicalRunSchema,
  execution: ExecutionSchema,
}).strict();
export type ServerHtmlProtectionCollectedExecution = z.infer<typeof CollectedExecutionSchema>;

/** Deterministic JSON for validated JSON-compatible material; object insertion order is immaterial. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Non-JSON attestation material");
    return encoded;
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const record = value as Record<string, unknown>;
  return "{" + Object.keys(record).filter(key => record[key] !== undefined).sort()
    .map(key => JSON.stringify(key) + ":" + canonicalJson(record[key])).join(",") + "}";
}
function equalMaterial(a: unknown, b: unknown) { return canonicalJson(a) === canonicalJson(b); }
function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function safeEqual(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function verificationKey(config: ServerHtmlProtectionSigningConfig, id: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(config.verificationKeys, id)
    && typeof config.verificationKeys[id] === "string" ? config.verificationKeys[id] : undefined;
}
function runDigest(run: z.infer<typeof CanonicalRunSchema>) {
  return createHash("sha256").update(canonicalJson(run), "utf8").digest("hex");
}
function materialOf(attestation: ServerHtmlProtectionAttestation) {
  const { signature, ...material } = attestation;
  void signature;
  return material;
}
function signatureFor(material: z.infer<typeof AttestationMaterialSchema>, key: string) {
  // Generic Evidence Ledger signs its content hash. This distinct purpose and full
  // canonical material cannot be substituted by a signed client-authored Ledger entry.
  return createHmac("sha256", key).update(SERVER_HTML_PROTECTION_ATTESTATION_PURPOSE + "\0", "utf8")
    .update(canonicalJson(material), "utf8").digest("hex");
}

function validCollection(material: z.infer<typeof AttestationMaterialSchema>, run: z.infer<typeof CanonicalRunSchema>) {
  if (run.testCaseId !== material.binding.testCaseId || run.artifactHash !== material.binding.executed.sha256) return false;
  if (run.htmlProtectionProof && !equalMaterial(run.htmlProtectionProof.binding, material.binding)) return false;
  const obligations = new Map(material.requiredObligations.map(item => [item.id, item]));
  if (obligations.size !== material.requiredObligations.length
    || material.requiredObligations.some(item => item.sourceArtifactId !== material.binding.original.sourceArtifactId)) return false;
  const observedAt = Date.parse(material.execution.observedAt), expiresAt = Date.parse(material.execution.expiresAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(expiresAt) || expiresAt <= observedAt) return false;
  if (new Set(material.trustedEvidence.map(item => item.id)).size !== material.trustedEvidence.length) return false;
  return material.trustedEvidence.every(item => equalMaterial(item.binding, material.binding)
    && new Set(item.obligationIds).size === item.obligationIds.length
    && item.obligationIds.every(id => obligations.get(id)?.evidenceKind === item.kind)
    && Date.parse(item.observedAt) <= observedAt);
}

/**
 * INTERNAL execution-service primitive, never a route/body signing endpoint.
 * The caller must collect ALL actual port observations (including failures), derive
 * obligations independently, and provide its canonical actual Run. Zod/HMAC cannot
 * turn arbitrary client/AI/proof claims into execution provenance. This function
 * neither changes Run status nor validates completeness or product PASS.
 * Partial/unverified/failed observations are deliberately retained for Core validation.
 */
export function attestServerHtmlProtectionExecution(raw: ServerHtmlProtectionCollectedExecution, signing?: ServerHtmlProtectionSigningConfig) {
  const collected = CollectedExecutionSchema.safeParse(raw);
  const config = SigningConfigSchema.safeParse(signing);
  const activeKey = config.success ? verificationKey(config.data, config.data.keyId) : undefined;
  if (!config.success || !activeKey || !safeEqual(config.data.key, activeKey)) {
    throw new Error("HTML protection execution attestation signing is unavailable");
  }
  if (!collected.success) throw new Error("Invalid HTML protection collected execution boundary");
  const { canonicalRun, ...collection } = collected.data;
  const material = AttestationMaterialSchema.parse({
    schemaVersion: "html-protection-attestation-v1", purpose: SERVER_HTML_PROTECTION_ATTESTATION_PURPOSE,
    ...collection,
    requiredObligations: sortById(collection.requiredObligations),
    trustedEvidence: sortById(collection.trustedEvidence),
    canonicalRunSha256: runDigest(canonicalRun), signatureKeyId: config.data.keyId,
  });
  if (!validCollection(material, canonicalRun)) throw new Error("HTML protection execution collection has conflicting identity, scope or time");
  return ServerHtmlProtectionAttestationSchema.parse({
    ...material, signatureKeyId: config.data.keyId, signature: signatureFor(material, config.data.key),
  });
}

/**
 * Restore trusted context from an internal execution attestation. All expectations
 * must come from independent physical inputs, the frozen paper and authoritative
 * Job/execution state, never from the attestation or the proof being checked.
 * No pass/completeness verdict is returned: the caller must still invoke Core's
 * validateHtmlProtectionProof, independent Judge and normal gate settlement.
 */
export function verifyServerHtmlProtectionExecutionAttestation(args: {
  attestation: unknown;
  expectedBinding: unknown;
  requiredObligations: unknown;
  policyVersion: unknown;
  canonicalRun: unknown;
  expectedExecution: unknown;
  now: number;
}, signing?: ServerHtmlProtectionSigningConfig) {
  const envelope = ServerHtmlProtectionAttestationSchema.safeParse(args.attestation);
  const expectedBinding = HtmlProtectionProofBindingSchema.safeParse(args.expectedBinding);
  const obligations = z.array(HtmlProtectionObligationSchema).min(1).max(5000).safeParse(args.requiredObligations);
  const policy = identity.safeParse(args.policyVersion);
  const run = CanonicalRunSchema.safeParse(args.canonicalRun);
  const execution = ExecutionIdentitySchema.safeParse(args.expectedExecution);
  const config = SigningConfigSchema.safeParse(signing);
  if (!envelope.success || !expectedBinding.success || !obligations.success || !policy.success
    || !run.success || !execution.success || !config.success || !Number.isFinite(args.now)) return undefined;
  const material = materialOf(envelope.data);
  const key = verificationKey(config.data, envelope.data.signatureKeyId);
  if (!key || !safeEqual(signatureFor(material, key), envelope.data.signature)) return undefined;
  if (!equalMaterial(material.binding, expectedBinding.data) || material.policyVersion !== policy.data
    || !equalMaterial(material.requiredObligations, sortById(obligations.data))
    || !equalMaterial({ executionId: material.execution.executionId, jobId: material.execution.jobId,
      generation: material.execution.generation }, execution.data)
    || material.canonicalRunSha256 !== runDigest(run.data) || !validCollection(material, run.data)
    || args.now < Date.parse(material.execution.observedAt) || args.now >= Date.parse(material.execution.expiresAt)) return undefined;
  return {
    expectedBinding: expectedBinding.data,
    requiredObligations: obligations.data,
    trustedEvidence: material.trustedEvidence,
    canonicalRun: run.data,
    policyVersion: material.policyVersion,
    execution: material.execution,
  };
}
