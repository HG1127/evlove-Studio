import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { TargetRunResultSchema, type TargetRunResult } from "@evolution/contracts";
import { htmlProtectionAuthorityCanonicalRun } from "@evolution/core";
import { ServerAiPublicSelectionSchema, serverAiPublicSelectionIdentity, type ServerAiPublicSelection } from "./server-ai-public-selection";
import {
  ServerHtmlProtectionAttestationSchema, attestServerHtmlProtectionExecution,
  verifyServerHtmlProtectionExecutionAttestation, type ServerHtmlProtectionCollectedExecution,
  type ServerHtmlProtectionSigningConfig,
} from "./server-html-protection-attestation";
export const SERVER_HTML_PROTECTION_AUTHORITY_PURPOSE = "evolution-html-protection-authority-v2-sealed-selection";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const Schema = z.object({
  schemaVersion: z.literal("html-protection-authority-attestation-v2"),
  purpose: z.literal(SERVER_HTML_PROTECTION_AUTHORITY_PURPOSE),
  inputSha256: sha, planSha256: sha, observationSha256: sha,
  scoringRouteFingerprint: z.string().min(1).max(512),
  selection: ServerAiPublicSelectionSchema, selectionIdentitySha256: sha,
  executionAttestation: ServerHtmlProtectionAttestationSchema,
  signature: sha,
}).strict();
export const ServerHtmlProtectionAuthorityAttestationSchema = Schema;
export type ServerHtmlProtectionAuthorityAttestation = z.infer<typeof Schema>;
export function htmlProtectionCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(htmlProtectionCanonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ":" + htmlProtectionCanonicalJson(item)).join(",") + "}";
  const result = JSON.stringify(value);
  if (result === undefined) throw Error("Non-JSON authority material");
  return result;
}
/** References locate envelopes; they are not canonical observation material and avoid recursive digests. */
export function htmlProtectionCanonicalRun(run: TargetRunResult): TargetRunResult {
  return htmlProtectionAuthorityCanonicalRun(run);
}
const same = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
function sign(material: Omit<ServerHtmlProtectionAuthorityAttestation, "signature">, key: string) {
  return createHmac("sha256", key).update(SERVER_HTML_PROTECTION_AUTHORITY_PURPOSE + "\0", "utf8")
    .update(htmlProtectionCanonicalJson(material), "utf8").digest("hex");
}
/** Internal collector only. Signing never substitutes independent raw-observation rederivation. */
export function attestServerHtmlProtectionAuthority(args: {
  collected: ServerHtmlProtectionCollectedExecution; inputSha256: string; planSha256: string;
  observationSha256: string; scoringRouteFingerprint: string; selection: ServerAiPublicSelection;
}, signing?: ServerHtmlProtectionSigningConfig): ServerHtmlProtectionAuthorityAttestation {
  const executionAttestation = attestServerHtmlProtectionExecution({ ...args.collected,
    canonicalRun: htmlProtectionCanonicalRun(args.collected.canonicalRun) }, signing);
  const selection = ServerAiPublicSelectionSchema.parse(args.selection);
  const material = Schema.omit({ signature: true }).parse({ schemaVersion: "html-protection-authority-attestation-v2",
    purpose: SERVER_HTML_PROTECTION_AUTHORITY_PURPOSE, inputSha256: args.inputSha256, planSha256: args.planSha256,
    observationSha256: args.observationSha256, scoringRouteFingerprint: args.scoringRouteFingerprint,
    selection, selectionIdentitySha256: serverAiPublicSelectionIdentity(selection), executionAttestation });
  return Schema.parse({ ...material, signature: sign(material, signing!.key) });
}
/** All expected values come from actual inputs, current route, independent Job and fixed observation collector. */
type AuthorityCheck = {
  attestation: unknown; inputSha256: string; planSha256: string; observationSha256: string; scoringRouteFingerprint: string;
} & Omit<Parameters<typeof verifyServerHtmlProtectionExecutionAttestation>[0], "attestation">;
function verifiedOuter(args: AuthorityCheck, signing?: ServerHtmlProtectionSigningConfig) {
  const envelope = Schema.safeParse(args.attestation);
  const config = z.object({ keyId: z.string().min(1).max(512), key: z.string().min(32).max(4096),
    verificationKeys: z.record(z.string().min(1).max(512), z.string().min(32).max(4096)) }).strict().safeParse(signing);
  const canonical = TargetRunResultSchema.strict().safeParse(args.canonicalRun);
  if (!envelope.success || !config.success || !canonical.success) return undefined;
  const { signature: _signature, ...material } = envelope.data;
  void _signature;
  const id = material.executionAttestation.signatureKeyId;
  const key = Object.hasOwn(config.data.verificationKeys, id) ? config.data.verificationKeys[id] : undefined;
  if (!key || !same(sign(material, key), envelope.data.signature)
    || material.inputSha256 !== args.inputSha256 || material.planSha256 !== args.planSha256
    || material.observationSha256 !== args.observationSha256 || material.scoringRouteFingerprint !== args.scoringRouteFingerprint
    || material.selectionIdentitySha256 !== serverAiPublicSelectionIdentity(material.selection)) return undefined;
  return { material, canonical: canonical.data, config: config.data };
}
export function verifyServerHtmlProtectionAuthorityAttestation(args: AuthorityCheck & { selection: ServerAiPublicSelection },
  signing?: ServerHtmlProtectionSigningConfig) {
  const verified = verifiedOuter(args, signing), selection=ServerAiPublicSelectionSchema.safeParse(args.selection);
  if (!verified || !selection.success || htmlProtectionCanonicalJson(verified.material.selection) !== htmlProtectionCanonicalJson(selection.data)) return undefined;
  const { material, canonical, config } = verified;
  return verifyServerHtmlProtectionExecutionAttestation({ ...args,
    attestation: material.executionAttestation, canonicalRun: htmlProtectionCanonicalRun(canonical),
  }, config);
}

export type AuthenticatedServerHtmlProtectionSelection = Readonly<{ provenance: "authenticated-whole-selection-v2" }>;
const authenticatedSelections = new WeakMap<object, ServerAiPublicSelection>();
/** First restoration phase: authenticate issuance/context only. Signed support flags are not independently verified here. */
export function authenticateServerHtmlProtectionAuthoritySelection(args: Omit<AuthorityCheck, "requiredObligations">,
  signing?: ServerHtmlProtectionSigningConfig): AuthenticatedServerHtmlProtectionSelection | undefined {
  const parsed = Schema.safeParse(args.attestation);
  if (!parsed.success) return undefined;
  const check = { ...args, requiredObligations: parsed.data.executionAttestation.requiredObligations };
  const verified = verifiedOuter(check, signing);
  if (!verified || !verifyServerHtmlProtectionExecutionAttestation({ ...check,
    attestation: verified.material.executionAttestation, canonicalRun: htmlProtectionCanonicalRun(verified.canonical) }, verified.config)) return undefined;
  const capability = Object.freeze({ provenance: "authenticated-whole-selection-v2" as const });
  authenticatedSelections.set(capability, ServerAiPublicSelectionSchema.parse(structuredClone(verified.material.selection)));
  return capability;
}
/** Private App witness extraction rejects plain/serialized DTOs and returns no Core evidence capability. */
export function readAuthenticatedServerHtmlProtectionSelection(capability: AuthenticatedServerHtmlProtectionSelection): ServerAiPublicSelection {
  const selection = authenticatedSelections.get(capability);
  if (!selection) throw Error("html-protection-selection-provenance-unavailable");
  return ServerAiPublicSelectionSchema.parse(structuredClone(selection));
}
