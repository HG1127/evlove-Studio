import { HtmlProtectionObligationSchema, type HtmlProtectionObligation } from "@evolution/contracts";
import type { HtmlProtectionInventory } from "./html-protection-inventory";
import { htmlProtectionContentScope, type HtmlProtectionFrozenContentContract } from "./html-protection-content-scope";

const PROOF_OBLIGATION_LIMIT = 5000;
type Kind = HtmlProtectionObligation["kind"];
type EvidenceKind = HtmlProtectionObligation["evidenceKind"];
export type HtmlProtectionPlanGap = {
  code: string;
  target: string;
  obligationIds: string[];
  description: string;
};
/** Expected finite subscopes only: this is neither an execution capability nor a modification permission. */
export type HtmlProtectionFiniteRuntimeProfile = {
  id: string;
  sourceArtifactId: string;
  refinements: readonly {
    parentObligationId: string;
    children: readonly { id: string; target: string; description: string }[];
  }[];
};
export type HtmlProtectionRuntimeScope = {
  parentObligationId: string;
  residualObligationId: string;
  children: { profileChildId: string; obligationId: string }[];
};

function closed(value: unknown, keys: readonly string[], name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key))) throw new Error("Invalid closed " + name);
}
function identity(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.length || value.length > 512) throw new Error("Invalid " + name);
}
function refinements(profile: HtmlProtectionFiniteRuntimeProfile | undefined, original: HtmlProtectionInventory) {
  const byParent = new Map<string, HtmlProtectionFiniteRuntimeProfile["refinements"][number]>();
  if (profile === undefined) return byParent;
  closed(profile, ["id", "sourceArtifactId", "refinements"], "runtime profile");
  identity(profile.id, "runtime profile identity");
  if (profile.sourceArtifactId !== original.sourceArtifactId || !Array.isArray(profile.refinements)
    || profile.refinements.length > PROOF_OBLIGATION_LIMIT) throw new Error("Runtime profile must target this Original inventory");
  const parents = new Set(original.runtimeObligations.map((obligation) => obligation.id)), childIds = new Set<string>();
  for (const refinement of profile.refinements as HtmlProtectionFiniteRuntimeProfile["refinements"]) {
    closed(refinement, ["parentObligationId", "children"], "runtime refinement");
    if (!parents.has(refinement.parentObligationId) || byParent.has(refinement.parentObligationId)
      || !Array.isArray(refinement.children) || !refinement.children.length) throw new Error("Invalid or duplicate runtime parent");
    for (const child of refinement.children as HtmlProtectionFiniteRuntimeProfile["refinements"][number]["children"]) {
      closed(child, ["id", "target", "description"], "runtime child");
      identity(child.id, "runtime child identity");
      if (childIds.has(child.id)) throw new Error("Duplicate runtime child identity");
      childIds.add(child.id);
      if (childIds.size > PROOF_OBLIGATION_LIMIT) throw new Error("Runtime profile exceeds the finite child limit");
      // Reuse the public contract for target/description validation. No caller-supplied support or evidence kind.
      HtmlProtectionObligationSchema.parse({ id: child.id, sourceArtifactId: original.sourceArtifactId,
        kind: "browser-behavior", target: child.target, description: child.description, evidenceKind: "browser", support: "unresolved" });
    }
    byParent.set(refinement.parentObligationId, refinement);
  }
  return byParent;
}
const hasLiteral = (fact: { range: { start: number; end: number } | null; literal: string | null }, sourceCharacters: number) =>
  fact.literal !== null && fact.range !== null && Number.isInteger(fact.range.start) && Number.isInteger(fact.range.end)
  && fact.range.start >= 0 && fact.range.end >= fact.range.start && fact.range.end <= sourceCharacters
  && fact.literal.length === fact.range.end - fact.range.start;

/**
 * Independent expected scope, derived only from the complete Original's Core inventory.
 * The caller must obtain that inventory from the authoritative Original via htmlProtectionInventory.
 * The retained decoded facts are not byte provenance; accepting an inventory-shaped DTO does not authenticate it.
 * Frozen content requirements may choose independent semantic refinement evidence; they are not modification authority.
 * No Candidate, proof, observed receipt, AI result or modification authorization is accepted here.
 * Supported describes indexed static scope, never a preservation result. All semantic/visual/runtime
 * scopes remain unresolved. Profiles only add expected children and cannot discharge a parent or residual.
 */
export function htmlProtectionObligationPlan(args: {
  originalInventory: HtmlProtectionInventory;
  runtimeProfile?: HtmlProtectionFiniteRuntimeProfile;
  frozenContentContract?: HtmlProtectionFrozenContentContract;
}) {
  if (!args || typeof args !== "object" || Object.keys(args).some((key) => !["originalInventory", "runtimeProfile", "frozenContentContract"].includes(key))) {
    throw new Error("HTML protection plan accepts only Original inventory and expected runtime scope");
  }
  const original = structuredClone(args.originalInventory);
  if (!original || original.schemaVersion !== "html-protection-inventory-v1" || original.readWholeFile !== true
    || !Number.isInteger(original.sourceCharacters) || original.sourceCharacters <= 0
    || !Number.isInteger(original.parseErrorCount) || original.parseErrorCount < 0
    || !Array.isArray(original.parseErrors) || original.parseErrors.length > original.parseErrorCount) {
    throw new Error("HTML protection plan requires a complete Core Original inventory");
  }
  identity(original.sourceArtifactId, "Original source artifact identity");
  for (const key of ["cards", "styles", "scripts", "references", "handlers", "documentElements", "duplicateIds", "runtimeObligations", "limitations"] as const) {
    if (!Array.isArray(original[key])) throw new Error("Missing complete Original inventory: " + key);
  }
  const parentIds = new Set<string>();
  for (const item of original.runtimeObligations) {
    const parent = HtmlProtectionObligationSchema.parse(item);
    if (parent.sourceArtifactId !== original.sourceArtifactId || parent.kind !== "unknown-runtime" || parentIds.has(parent.id)
      || parent.id.startsWith("plan:")) throw new Error("Invalid Original coarse runtime identity or unresolved scope");
    parentIds.add(parent.id);
  }
  const contentScope = args.frozenContentContract ? htmlProtectionContentScope({ sourceArtifactId: original.sourceArtifactId, frozenContract: args.frozenContentContract }) : undefined;
  const semanticContent = contentScope?.mode === "semantic-refinement";
  const operational = contentScope?.operationalScope;
  const profile = refinements(operational ? undefined : args.runtimeProfile, original);
  const requiredObligations: HtmlProtectionObligation[] = [], gaps: HtmlProtectionPlanGap[] = [];
  function obligation(id: string, kind: Kind, target: string, description: string, evidenceKind: EvidenceKind, supported = false) {
    const item = HtmlProtectionObligationSchema.parse({ id: "plan:" + id, sourceArtifactId: original.sourceArtifactId,
      kind, target, description, evidenceKind, support: supported ? "supported" : "unresolved" });
    requiredObligations.push(item);
    return item.id;
  }
  function gap(code: string, target: string, obligationIds: string[], description: string) {
    gaps.push({ code, target, obligationIds, description });
  }
  const explicitDocument = Object.values(original.explicit).every((tag) => tag.startTag && tag.endTag);
  const parsedClean = original.parseErrorCount === 0, documentIndexed = parsedClean && explicitDocument;
  const attributesIndexed = original.documentElements.every((element) => element.attributes.every((attribute) => attribute.literal !== null));
  const document = {
    format: obligation("document:format", "html-format", "document", "Preserve original complete HTML format, including markup outside indexed cards and blocks", "static"),
    content: obligation("document:content", semanticContent ? "core-method" : "html-format", "document",
      semanticContent ? "Independently establish retention of every Original meaning while evaluating the frozen content refinement requirements, including content outside cards" : "Preserve complete original document content, including content outside cards", semanticContent ? "semantic" : "static"),
    structure: obligation("document:structure", "html-format", "document", "Preserve the full original ordered document element structure, namespaces and inert contexts", "static", documentIndexed),
    attributes: obligation("document:attributes", "html-format", "document", "Preserve every original document element attribute and its owning element", "static", documentIndexed && attributesIndexed),
    sequences: obligation("document:sequences", "html-format", "document", "Preserve complete original card, style, script, reference and handler sequences; additions require independent policy", "static", documentIndexed),
    semantic: obligation("document:semantic", "core-method", "document", "Independently establish preservation of all original core methods and document meaning", "semantic"),
    visual: obligation("document:visual", "visual-layout", "document", "Independently establish original visual, layout and responsive preservation", "visual"),
    runtimeResidual: obligation("document:runtime-residual", "unknown-runtime", "document", "Unenumerated dynamic resources, CSS effects, data consumption, inert activation and other runtime behavior remain unresolved", "browser"),
  };
  for (const code of contentScope?.gaps ?? []) gap(code, "document", [document.content], "Stored literal retention and content refinement requirements conflict; no permission or evidence result is inferred.");
  gap("complete-document-source-unindexed", "document", [document.format, document.content],
    "The inventory has no whole-document literal or complete non-card text index; those obligations cannot be claimed from indexed fragments.");
  gap("physical-provenance-required", "document", [],
    "Decoded source facts do not supply the independently frozen original/executed byte hashes, receipts or Mission/test/criterion/paper binding.");
  if (!parsedClean) gap("html-parser-repair", "document", [document.structure, document.attributes, document.sequences],
    "Original parse diagnostics are retained; repaired parsing must not be treated as exact complete source preservation.");
  if (!explicitDocument) gap("implicit-document-tags", "document", [document.structure, document.attributes, document.sequences],
    "Implicit or unterminated html/head/body tags are retained as a source limitation.");
  if (!attributesIndexed) gap("document-attribute-source-unavailable", "document", [document.attributes],
    "At least one original element attribute has no literal source location.");
  const duplicates = new Set(original.duplicateIds.map((item) => item.id));
  for (const item of original.duplicateIds) gap("duplicate-element-id", "document", [], "Duplicate original element identity: " + item.id);
  const cards = original.cards.map((card, index) => {
    if (card.index !== index) throw new Error("Original card inventory must retain source-order identities");
    const target = "card[" + index + "]";
    const identifiable = card.id !== null && card.id.length > 0 && !duplicates.has(card.id);
    const indexed = parsedClean && identifiable && hasLiteral(card, original.sourceCharacters)
      && card.attributes.every((element) => element.attributes.every((attribute) => attribute.literal !== null));
    const contentObligationId = obligation("card:" + index + ":content", "card-content", target,
      semanticContent ? "Independently establish retention of all Original card content and method meaning while evaluating the frozen refinement requirements" : "Preserve all original decoded card content and significant whitespace",
      semanticContent ? "semantic" : "static", !semanticContent && indexed);
    const staticObligationIds = [
      ...(!semanticContent ? [contentObligationId] : []),
      obligation("card:" + index + ":title", "card-title", target, "Preserve the complete original card title or its original absence", "static", indexed),
      obligation("card:" + index + ":structure", "card-structure", target, "Preserve the complete original card element structure, namespaces and inert contexts", "static", indexed),
      obligation("card:" + index + ":attributes", "card-attributes", target, "Preserve every attribute on every original card element", "static", indexed),
    ];
    if (!identifiable) gap("card-identity-unresolved", target, staticObligationIds,
      "A missing, empty or duplicate original card ID must not be replaced by positional Candidate matching.");
    if (!hasLiteral(card, original.sourceCharacters)) gap("card-source-unavailable", target, staticObligationIds,
      "Complete original card source locations are unavailable.");
    if (!indexed) gap("card-static-scope-unresolved", target, staticObligationIds,
      "At least one identity, parsing or source-location prerequisite remains unresolved.");
    return { originalIndex: index, id: card.id, path: card.path, contentObligationId, staticObligationIds,
      semanticObligationId: obligation("card:" + index + ":semantic", "core-method", target, "Independently establish preservation of this original card's method and meaning", "semantic"),
      visualObligationId: obligation("card:" + index + ":visual", "visual-layout", target, "Independently establish preservation of this original card's rendering and layout", "visual") };
  });
  // A card-order scope cannot be marked indexed when original matching identities are missing or ambiguous.
  if (cards.some((card) => card.id === null || !card.id.length || duplicates.has(card.id))) {
    requiredObligations.find((item) => item.id === document.sequences)!.support = "unresolved";
  }
  const styles = original.styles.map((block, index) => {
    if (block.index !== index) throw new Error("Original style inventory must retain source order");
    const supported = parsedClean && hasLiteral(block, original.sourceCharacters) && block.bodyLiteral !== null && block.hasClosingTag;
    const id = obligation("style:" + index, "embedded-css", "style[" + index + "]", "Preserve the entire original style literal, attributes, body, inert context and source order", "static", supported);
    if (!supported) gap("style-source-unresolved", "style[" + index + "]", [id], "Original style literal, closing tag or parsing is incomplete.");
    return id;
  });
  const scripts = original.scripts.map((block, index) => {
    if (block.index !== index) throw new Error("Original script inventory must retain source order");
    const supported = parsedClean && hasLiteral(block, original.sourceCharacters) && block.bodyLiteral !== null && block.hasClosingTag;
    const id = obligation("script:" + index, "embedded-script", "script[" + index + "]", "Preserve the entire original script literal, attributes, type, body, inert context and source order; static equality is not behavior", "static", supported);
    if (!supported) gap("script-source-unresolved", "script[" + index + "]", [id], "Original script literal, closing tag or parsing is incomplete.");
    return id;
  });
  const references = original.references.map((fact, index) => {
    const id = obligation("reference:" + index, "external-reference", "reference[" + index + "]",
      "Preserve this complete original reference attribute, owner, namespace, inert context and source order", "static", parsedClean && fact.literal !== null);
    if (fact.literal === null) gap("reference-source-unavailable", "reference[" + index + "]", [id], "Original reference literal is unavailable.");
    return id;
  });
  const handlers = original.handlers.map((fact, index) => {
    const id = obligation("handler:" + index, "inline-handler", "handler[" + index + "]",
      "Preserve this complete original handler attribute, owner, namespace, inert context and source order; static equality is not execution", "static", parsedClean && fact.literal !== null);
    if (fact.literal === null) gap("handler-source-unavailable", "handler[" + index + "]", [id], "Original handler literal is unavailable.");
    return id;
  });
  const runtime: HtmlProtectionRuntimeScope[] = original.runtimeObligations.map((parent, index) => {
    requiredObligations.push({ ...parent }); // Exact coarse parent survives all refinements.
    const children = [...(profile.get(parent.id)?.children ?? [])].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      .map((child, childIndex) => ({ profileChildId: child.id, obligationId: obligation("runtime:" + index + ":child:" + childIndex,
        "browser-behavior", child.target, child.description, "browser") }));
    const residualObligationId = obligation("runtime:" + index + ":residual", "unknown-runtime", parent.target,
      "Unenumerated behavior of this original coarse runtime scope remains required beyond any finite profile children", "browser");
    return { parentObligationId: parent.id, residualObligationId, children };
  });
  if (operational) obligation("document:confirmed-operational-runtime-v2", "browser-behavior", "document",
    "Verify every Original startup-registered control and required state, full native document material and every Original-derived viewport; no unknown future behavior is claimed", "browser");
  const ids = new Set(requiredObligations.map((item) => item.id));
  if (ids.size !== requiredObligations.length) throw new Error("Duplicate generated obligation identity");
  const unresolvedObligationIds = requiredObligations.filter((item) => item.support === "unresolved").map((item) => item.id);
  if (requiredObligations.length > PROOF_OBLIGATION_LIMIT) gap("single-proof-capacity-exceeded", "document", [],
    "The complete expected scope exceeds the existing 5000-obligation proof contract; no items were truncated.");
  const byEvidenceKind = Object.fromEntries((["static", "browser", "semantic", "visual", "manual"] as const)
    .map((kind) => [kind, requiredObligations.filter((item) => item.evidenceKind === kind).length])) as Record<EvidenceKind, number>;
  return { schemaVersion: "html-protection-obligation-plan-v1" as const, sourceArtifactId: original.sourceArtifactId,
    originalInventory: original, requiredObligations,
    scope: { document, cards, styles, scripts, references, handlers, runtime },
    runtimeProfileId: operational ? null : args.runtimeProfile?.id ?? null, contentScope: contentScope ?? null,
    expectedCoverage: { obligationCount: requiredObligations.length, byEvidenceKind, unresolvedObligationIds,
      originalFactCounts: { cards: original.cards.length, styles: original.styles.length, scripts: original.scripts.length,
        references: original.references.length, handlers: original.handlers.length, documentElements: original.documentElements.length,
        coarseRuntimeScopes: original.runtimeObligations.length },
      singleProofObligationLimit: PROOF_OBLIGATION_LIMIT, fitsSingleProof: requiredObligations.length <= PROOF_OBLIGATION_LIMIT },
    gaps, limitations: [...original.limitations,
      "This plan declares expected scope and indexed facts, not observed preservation, completeness, authorization or PASS.",
      "Finite profiles add unresolved expected children; every coarse parent and mandatory residual remains required.",
      "Semantic and visual obligations require independent observations; static literals and search assertions cannot discharge them."] };
}
export type HtmlProtectionObligationPlan = ReturnType<typeof htmlProtectionObligationPlan>;
