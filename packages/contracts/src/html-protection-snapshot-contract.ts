import { z } from "zod";
import { HtmlProtectionProofBindingSchema } from "./html-protection-proof-contract";

export const HTML_PROTECTION_SNAPSHOT_LIMITS = {
  targets: 16, nodes: 20_000, shadowRoots: 256, depth: 256,
  attributesPerNode: 128, textUtf8Bytes: 1_048_576, bodyUtf8Bytes: 2_097_152,
  timeoutMs: 7_000,
} as const;
const identity = z.string().min(1).max(512);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const selector = z.string().min(1).max(500).refine(value => value.trim().length > 0);
const TargetSchema = z.object({ targetId: identity, selector }).strict();
const targets = z.array(TargetSchema).min(1).max(HTML_PROTECTION_SNAPSHOT_LIMITS.targets)
  .refine(items => new Set(items.map(item => item.targetId)).size === items.length, "Duplicate registered target");
const RegistryBase = z.object({ schemaVersion: z.literal("html-protection-snapshot-registry-v1"), originalSha256: sha256 });
export const HtmlProtectionSnapshotRegistrySchema = z.discriminatedUnion("projection", [
  RegistryBase.extend({ projection: z.literal("boot-subtree-v1"), targets }).strict(),
  RegistryBase.extend({ projection: z.literal("copy-material-v1"), targets }).strict(),
  RegistryBase.extend({
    projection: z.literal("search-membership-v1"), targetId: identity,
    cardSelector: selector, chapterSelector: selector, inputSelector: selector, countSelector: selector,
  }).strict(),
]);
export const HtmlProtectionSnapshotRequestSchema = z.object({
  schemaVersion: z.literal("html-protection-snapshot-request-v1"),
  binding: HtmlProtectionProofBindingSchema,
  sourceRole: z.enum(["original", "executed"]),
  documentUrl: z.string().url().max(2048),
  policyVersion: identity, planSha256: sha256, registrySha256: sha256,
  registry: HtmlProtectionSnapshotRegistrySchema,
  execution: z.object({ executionId: identity, jobId: identity, generation: z.number().int().positive() }).strict(),
  stateId: identity, batchId: identity,
}).strict().refine(request => request.registry.originalSha256 === request.binding.original.sha256,
  "Registry must belong to the independently bound Original");
export type HtmlProtectionSnapshotRequest = z.infer<typeof HtmlProtectionSnapshotRequestSchema>;

export const HtmlProtectionSnapshotGapCodeSchema = z.enum([
  "missing-target", "ambiguous-target", "missing-or-duplicate-id", "unsupported-input", "slot-outside-target",
  "closed-shadow-root", "iframe", "object", "embed", "limit-exceeded",
  "copy-material-undefined", "capability-unavailable", "unstable-document", "physical-input-mismatch",
]);
const GapSchema = z.object({ code: HtmlProtectionSnapshotGapCodeSchema, targetId: identity.optional() }).strict();
const AttributeSchema = z.object({
  name: z.string(), namespace: z.string().nullable(), value: z.string(),
}).strict();
const NodeSchema = z.object({
  index: z.number().int().nonnegative(), parent: z.number().int().nonnegative().nullable(),
  edge: z.enum(["root", "light", "shadow", "template"]),
  type: z.number().int().nonnegative(), name: z.string(), namespace: z.string().nullable(),
  value: z.string().nullable(),
  attributes: z.array(AttributeSchema).max(HTML_PROTECTION_SNAPSHOT_LIMITS.attributesPerNode),
  // Slot references are physical node indexes, not a second copy of assigned text.
  assignedIndexes: z.array(z.number().int().nonnegative()).max(HTML_PROTECTION_SNAPSHOT_LIMITS.nodes),
  assignedOutsideTarget: z.number().int().nonnegative(),
}).strict();
const CountersSchema = z.object({
  scannedNodes: z.number().int().nonnegative().max(HTML_PROTECTION_SNAPSHOT_LIMITS.nodes),
  collectedNodes: z.number().int().nonnegative().max(HTML_PROTECTION_SNAPSHOT_LIMITS.nodes),
  shadowRoots: z.number().int().nonnegative().max(HTML_PROTECTION_SNAPSHOT_LIMITS.shadowRoots),
  textUtf8Bytes: z.number().int().nonnegative().max(HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes),
}).strict();
const BootTargetSchema = z.object({
  targetId: identity, matchCount: z.number().int().nonnegative(),
  nodes: z.array(NodeSchema).max(HTML_PROTECTION_SNAPSHOT_LIMITS.nodes),
}).strict().superRefine((target, ctx) => {
  if (target.matchCount !== 1 && target.nodes.length) ctx.addIssue({ code: "custom", message: "Ambiguous target cannot supply a selected subtree" });
  for (const [index, node] of target.nodes.entries()) {
    if (node.index !== index || (node.parent !== null && node.parent >= index)
      || (index === 0 ? node.parent !== null || node.edge !== "root" : node.parent === null)
      || new Set(node.assignedIndexes).size !== node.assignedIndexes.length
      || node.assignedIndexes.some(reference => reference >= target.nodes.length)) {
      ctx.addIssue({ code: "custom", message: "Incomplete ordered node or slot relationships" }); break;
    }
  }
});
const MembershipSchema = z.object({
  id: z.string().nullable(), tag: z.string(), namespace: z.string().nullable(),
  classAttribute: z.string().nullable(), hidden: z.boolean(), display: z.string(),
  ancestorDisplayNone: z.boolean(), chapterId: z.string().nullable(),
}).strict();
const BodyBase = z.object({ counters: CountersSchema, gaps: z.array(GapSchema).max(512) });
export const HtmlProtectionSnapshotBodySchema = z.discriminatedUnion("projection", [
  BodyBase.extend({
    projection: z.literal("boot-subtree-v1"), targets: z.array(BootTargetSchema).max(HTML_PROTECTION_SNAPSHOT_LIMITS.targets),
  }).strict(),
  BodyBase.extend({
    projection: z.literal("search-membership-v1"),
    targetId: identity,
    cards: z.array(MembershipSchema).max(HTML_PROTECTION_SNAPSHOT_LIMITS.nodes),
    chapters: z.array(MembershipSchema).max(HTML_PROTECTION_SNAPSHOT_LIMITS.nodes),
    input: z.object({ matchCount: z.number().int().nonnegative(), tag: z.string().nullable(), value: z.string().nullable() }).strict(),
    count: z.object({ matchCount: z.number().int().nonnegative(), text: z.string().nullable() }).strict(),
  }).strict(),
]);
export type HtmlProtectionSnapshotBody = z.infer<typeof HtmlProtectionSnapshotBodySchema>;
export const HtmlProtectionSnapshotLimitations = [
  "Selected projection and targets only; not whole protection or cross-script closure.",
  "Closed Shadow content and iframe/object/embed documents are not collected.",
  "No semantic or visual preservation verdict; page-returned JSON is not observation authority.",
  "Physical input hash identifies supplied bytes; caller must independently bind the served document.",
] as const;
const RealmSchema = z.object({
  observerVersion: z.literal("chromium-cdp-isolated-dom-v1"), frameId: identity,
  loaderId: identity, uniqueContextId: identity,
}).strict();
export const HtmlProtectionSnapshotResultSchema = z.object({
  schemaVersion: z.literal("html-protection-snapshot-result-v1"),
  request: HtmlProtectionSnapshotRequestSchema,
  availability: z.enum(["available", "unavailable"]),
  projectionComplete: z.boolean(),
  observedAt: z.string().datetime({ offset: true }),
  physicalInput: z.object({ sha256, byteLength: z.number().int().nonnegative() }).strict(),
  realm: RealmSchema.optional(),
  body: HtmlProtectionSnapshotBodySchema.optional(),
  bodySha256: sha256.optional(), bodyUtf8Bytes: z.number().int().positive().max(HTML_PROTECTION_SNAPSHOT_LIMITS.bodyUtf8Bytes).optional(),
  gaps: z.array(GapSchema).max(512),
  limitations: z.tuple([
    z.literal(HtmlProtectionSnapshotLimitations[0]), z.literal(HtmlProtectionSnapshotLimitations[1]),
    z.literal(HtmlProtectionSnapshotLimitations[2]), z.literal(HtmlProtectionSnapshotLimitations[3]),
  ]),
}).strict().superRefine((result, ctx) => {
  if (result.availability === "available" && (!result.realm || !result.body || !result.bodySha256 || !result.bodyUtf8Bytes)) {
    ctx.addIssue({ code: "custom", message: "Available projection requires complete native material and Node digest" });
  }
  if (result.availability === "unavailable" && (result.projectionComplete || result.body || result.bodySha256 || result.bodyUtf8Bytes)) {
    ctx.addIssue({ code: "custom", message: "Unavailable observation cannot claim a body or completeness" });
  }
  if (result.body && result.body.projection !== result.request.registry.projection) ctx.addIssue({ code: "custom", message: "Wrong registered projection" });
  if (result.projectionComplete && (result.availability !== "available" || result.gaps.length || result.body?.gaps.length)) {
    ctx.addIssue({ code: "custom", message: "Selected projection completeness cannot hide gaps" });
  }
});
export type HtmlProtectionSnapshotResult = z.infer<typeof HtmlProtectionSnapshotResultSchema>;
