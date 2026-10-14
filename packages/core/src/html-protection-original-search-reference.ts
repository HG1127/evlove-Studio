import { z } from "zod";
import {
  HTML_PROTECTION_SNAPSHOT_LIMITS,
  HtmlProtectionSnapshotResultSchema,
  type HtmlProtectionSnapshotBody,
  type HtmlProtectionSnapshotResult,
} from "@evolution/contracts";
import {
  compareHtmlProtectionSnapshots,
  type HtmlProtectionSnapshotComparisonExpected,
} from "./html-protection-snapshot-comparison";

type Role = "original" | "executed";
type Search = Extract<HtmlProtectionSnapshotBody, { projection: "search-membership-v1" }>;
type Member = Search["cards"][number];
const identity = z.string().min(1).max(512);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const uniqueIds = z.array(identity).max(HTML_PROTECTION_SNAPSHOT_LIMITS.nodes)
  .refine(ids => new Set(ids).size === ids.length, "Duplicate Original reference ID");

/** Independently registered Original expectations, not an authenticated profile or change permission. */
export const HtmlProtectionOriginalSearchReferenceSchema = z.object({
  schemaVersion: z.literal("html-protection-original-search-reference-v1"),
  sourceArtifactId: identity,
  originalSha256: sha256,
  policyVersion: identity,
  planSha256: sha256,
  registrySha256: sha256,
  stateId: identity,
  targetId: identity,
  expectedOriginalVisibleCardIds: uniqueIds,
  // Fixed decimal visible/total slots. These strings are literal material, never executable expressions.
  countTemplate: z.object({
    prefix: z.string().max(HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes),
    separator: z.string().max(HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes),
    suffix: z.string().max(HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes),
  }).strict().refine(template => new TextEncoder().encode(template.prefix + template.separator + template.suffix).byteLength
    <= HTML_PROTECTION_SNAPSHOT_LIMITS.textUtf8Bytes - 16, "Counter template exceeds native text limit").optional(),
}).strict();
export type HtmlProtectionOriginalSearchReference = z.infer<typeof HtmlProtectionOriginalSearchReferenceSchema>;
export type HtmlProtectionOriginalSearchReferenceFact = {
  scope: string;
  role: Role | "paired";
  field: string;
  status: "match" | "changed" | "missing" | "unavailable" | "observed";
  expected?: unknown;
  observed?: unknown;
};
export type HtmlProtectionOriginalSearchReferenceGap = { code: string; scope: string; role?: Role };

// Conservatively recognized computed display values. Unknown/noncomputed values cannot supply membership.
const displays = new Set([
  "none", "contents", "block", "inline", "inline-block", "flow-root", "list-item",
  "flex", "inline-flex", "grid", "inline-grid", "table", "inline-table", "table-row-group",
  "table-header-group", "table-footer-group", "table-row", "table-cell", "table-column-group",
  "table-column", "table-caption", "ruby", "ruby-base", "ruby-text", "ruby-base-container", "ruby-text-container",
  "block flow", "inline flow", "block flow-root", "inline flow-root", "block flex", "inline flex",
  "block grid", "inline grid", "block table", "inline table", "inline ruby", "block flow list-item",
  "inline flow list-item", "block flow-root list-item", "inline flow-root list-item",
]);
const attributes = ["id", "tag", "namespace", "classAttribute", "hidden", "display", "ancestorDisplayNone", "chapterId"] as const;
const sameIds = (expected: readonly string[], observed: readonly string[]) =>
  expected.length === observed.length && expected.every((id, index) => id === observed[index]);
function membership(rows: readonly Member[]) {
  if (rows.some(row => !displays.has(row.display))) return undefined;
  return rows.filter(row => !row.hidden && row.display !== "none" && !row.ancestorDisplayNone).map(row => row.id!);
}

/**
 * Add narrow search facts without replacing any strict comparison fact, gap or additional item.
 * Expected/reference values must be independently registered from the trusted Original profile.
 * Schema, realm, stability and matching values do not authenticate the controller or served bytes.
 * Native hidden/display membership is not visual visibility, behavior closure, semantic preservation,
 * change authorization, paired Hidden evidence or whole protection. No acceptance verdict is produced.
 */
export function compareHtmlProtectionOriginalSearchReference(args: {
  original: HtmlProtectionSnapshotResult;
  executed: HtmlProtectionSnapshotResult;
  expected: HtmlProtectionSnapshotComparisonExpected;
  reference: HtmlProtectionOriginalSearchReference;
}) {
  const inputs = args ?? {} as typeof args;
  const strictComparison = compareHtmlProtectionSnapshots({ original: inputs.original, executed: inputs.executed, expected: inputs.expected });
  const referenceFacts: HtmlProtectionOriginalSearchReferenceFact[] = [];
  const gaps: HtmlProtectionOriginalSearchReferenceGap[] = [];
  const gap = (code: string, scope: string, role?: Role) => gaps.push({ code, scope, ...(role ? { role } : {}) });
  const result = () => ({ schemaVersion: "html-protection-original-search-reference-facts-v1" as const,
    strictComparison, referenceFacts, gaps, limitations: [
      "Only selected Original-reference search facts; all strict changes, gaps and additional items remain unresolved observations.",
      "The caller independently authenticates Original profile registration, physical served bytes and controller observations; serialized expectations are not provenance or change permission.",
      "Native hidden/display membership is not visual visibility: opacity, clipping, layout, meaning and all runtime branches remain outside these facts.",
      "Chapter empty-state policy is not registered by this reference schema; no class token is interpreted as an empty-state verdict.",
      "No paired Hidden, safety, authorization, verification, acceptance or whole-protection verdict is produced.",
    ] });
  if (!args || Object.keys(args).length !== 4 || !["original", "executed", "expected", "reference"].every(key => Object.hasOwn(args, key))) {
    gap("invalid-reference-arguments", "comparison"); return result();
  }
  if (strictComparison.expectedComparison?.projection !== "search-membership-v1"
    || strictComparison.facts.some(fact => fact.status === "unavailable")
    || strictComparison.gaps.some(item => !["additional-card", "additional-chapter"].includes(item.code))) {
    gap("strict-search-projection-unavailable", "comparison"); return result();
  }
  const parsed = HtmlProtectionOriginalSearchReferenceSchema.safeParse(args.reference);
  if (!parsed.success) { gap("invalid-independent-search-reference", "comparison"); return result(); }
  const reference = parsed.data, scopes = args.expected.registeredScopes;
  const registeredCardIds = new Set(scopes.projection === "search-membership-v1" ? scopes.cardIds : []);
  if (scopes.projection !== "search-membership-v1"
    || reference.sourceArtifactId !== args.expected.binding.original.sourceArtifactId
    || reference.originalSha256 !== args.expected.binding.original.sha256
    || reference.policyVersion !== args.expected.policyVersion || reference.planSha256 !== args.expected.planSha256
    || reference.registrySha256 !== args.expected.registrySha256 || reference.stateId !== args.expected.stateId
    || reference.targetId !== scopes.targetId
    || reference.expectedOriginalVisibleCardIds.some(id => !registeredCardIds.has(id))) {
    gap("unbound-independent-search-reference", "comparison"); return result();
  }
  const snapshots = { original: HtmlProtectionSnapshotResultSchema.safeParse(args.original), executed: HtmlProtectionSnapshotResultSchema.safeParse(args.executed) };
  if (!snapshots.original.success || !snapshots.executed.success) { gap("strict-search-projection-unavailable", "comparison"); return result(); }
  const before = snapshots.original.data.body, after = snapshots.executed.data.body;
  if (before?.projection !== "search-membership-v1" || after?.projection !== "search-membership-v1") {
    gap("strict-search-projection-unavailable", "comparison"); return result();
  }
  const scope = scopes.targetId;
  const fact = (role: Role | "paired", field: string, expected: unknown, observed: unknown, status: HtmlProtectionOriginalSearchReferenceFact["status"]) =>
    referenceFacts.push({ scope, role, field, status, ...(expected === undefined ? {} : { expected }), ...(observed === undefined ? {} : { observed }) });
  const expectedVisibleSet = new Set(reference.expectedOriginalVisibleCardIds);
  const expectedVisible = scopes.cardIds.filter(id => expectedVisibleSet.has(id));
  for (const role of ["original", "executed"] as const) {
    const body = role === "original" ? before : after;
    for (const kind of ["cards", "chapters"] as const) {
      const expectedIds = kind === "cards" ? scopes.cardIds : scopes.chapterIds;
      const expectedSet = new Set(expectedIds), observed = body[kind].filter(row => expectedSet.has(row.id!)).map(row => row.id!);
      const observedSet = new Set(observed);
      fact(role, kind + ".original-relative-order", expectedIds, observed,
        expectedIds.some(id => !observedSet.has(id)) ? "missing" : sameIds(expectedIds, observed) ? "match" : "changed");
    }
    const visible = membership(body.cards);
    const actualCardIds = new Set(body.cards.map(row => row.id));
    const missingOriginal = scopes.cardIds.some(id => !actualCardIds.has(id));
    if (visible === undefined) {
      gap("unknown-native-display", scope, role);
      fact(role, "cards.original-native-visible-membership", expectedVisible, undefined, "unavailable");
      fact(role, "count.own-native-membership-text", undefined, body.count.text, "unavailable");
    } else {
      const originalVisible = visible.filter(id => registeredCardIds.has(id));
      fact(role, "cards.original-native-visible-membership", expectedVisible, originalVisible,
        missingOriginal ? "missing" : expectedVisible.length === originalVisible.length
          && originalVisible.every(id => expectedVisibleSet.has(id)) ? "match" : "changed");
      if (reference.countTemplate) {
        const ownExpectedText = reference.countTemplate.prefix + visible.length + reference.countTemplate.separator
          + body.cards.length + reference.countTemplate.suffix;
        fact(role, "count.own-native-membership-text", ownExpectedText, body.count.text,
          ownExpectedText === body.count.text ? "match" : "changed");
      } else {
        gap("original-count-template-unavailable", scope, role);
        fact(role, "count.own-native-membership-text", undefined, body.count.text, "unavailable");
      }
      fact(role, "cards.all-native-visible-IDs", undefined, visible, "observed");
      fact(role, "cards.all-native-counts", undefined, { visible: visible.length, total: body.cards.length }, "observed");
    }
  }
  // Pair by Original ID, never by shifted array position or the first N executed items.
  for (const kind of ["cards", "chapters"] as const) {
    const expectedIds = kind === "cards" ? scopes.cardIds : scopes.chapterIds;
    const originalRows = new Map(before[kind].map(row => [row.id, row]));
    const executedRows = new Map(after[kind].map(row => [row.id, row]));
    for (const id of expectedIds) for (const attribute of attributes) {
      const original = originalRows.get(id)![attribute], executed = executedRows.get(id)?.[attribute];
      fact("paired", kind + "[" + id + "]." + attribute, original, executed,
        executed === undefined ? "missing" : original === executed ? "match" : "changed");
    }
  }
  gap("chapter-empty-state-template-unavailable", scope);
  fact("paired", "chapters.empty-state", undefined, undefined, "unavailable");
  return result();
}
export type HtmlProtectionOriginalSearchReferenceFacts = ReturnType<typeof compareHtmlProtectionOriginalSearchReference>;
