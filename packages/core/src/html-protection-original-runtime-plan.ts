import {
  BrowserStepSchema, HTML_PROTECTION_SNAPSHOT_LIMITS, HtmlProtectionArtifactIdentitySchema,
  HtmlProtectionSnapshotRegistrySchema, type BrowserStep, type HtmlProtectionSnapshotRequest,
} from "@evolution/contracts";
import { htmlProtectionInventory, type HtmlProtectionElementFact } from "./html-protection-inventory";
import type { HtmlProtectionFiniteRuntimeProfile } from "./html-protection-obligation-plan";
import type { HtmlProtectionSnapshotRegisteredScopes } from "./html-protection-snapshot-comparison";

const HTML = "http://www.w3.org/1999/xhtml";
const VERSION = "original-slide-runtime-plan-v1";
const TARGET_LIMIT = 5000;
const nativeTags = new Set(["button", "input", "select", "textarea", "details", "summary", "form", "audio", "video"]);
type Registry = HtmlProtectionSnapshotRequest["registry"];
type Role = "card" | "chapter" | "native-control" | "sidebar" | "progress" | "top" | "reveal" | "check-item";
type Gap = { code: string; sourcePaths: string[]; parentObligationIds: string[] };
type Target = {
  targetId: string; sourcePath: string; tag: string; namespace: string; id: string | null;
  roles: Role[]; selector: string | null; identityKind: "unique-id" | "structural-path" | "unavailable";
  originalElementIds: string[]; coarseParentIds: string[];
};
type Batch = { batchId: string; stateId: string; registry: Registry; registeredScopes: HtmlProtectionSnapshotRegisteredScopes };
type SearchState = {
  stateId: string; stateKind: "boot" | "query" | "clear";
  stateIntent: "boot" | "query-positive" | "query-negative" | "clear"; predecessorStateId: string | null;
  proposedActions: BrowserStep[]; requiredCapability: "native-boot-observation" | "stateful-browser-actions-unavailable";
  inputValue: string; expectedVisibleCardIds: string[]; expectedVisibleChapterIds: string[];
  registeredScopes: HtmlProtectionSnapshotRegisteredScopes;
};
const attribute = (element: HtmlProtectionElementFact, name: string) =>
  element.attributes.find(item => item.name === name && item.namespace === "")?.value;
const classes = (element: HtmlProtectionElementFact) => (attribute(element, "class") ?? "").split(/[\t\n\f\r ]+/);
const hasClass = (element: HtmlProtectionElementFact, value: string) => classes(element).includes(value);
// Closed CSS strings, never selectors/programs supplied by the page, Candidate or AI.
const cssId = (id: string) => '[id="' + Array.from(id, character => "\\" + character.codePointAt(0)!.toString(16) + " ").join("") + '"]';
const parentPath = (path: string) => path.slice(0, path.lastIndexOf("/"));

/**
 * Finite observation proposals derived from the complete decoded Original alone.
 * originalSha256 is metadata checked by the trusted physical reader, NOT a hash
 * computed or authenticated here. Returned material stays in private collector memory.
 * This adds unresolved children; it cannot discharge coarse parents/residuals,
 * prove JS causality, change frozen papers, or supply execution/provenance authority.
 */
export function htmlProtectionOriginalRuntimePlan(args: { sourceArtifactId: string; originalSha256: string; html: string }) {
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length !== 3
    || Object.keys(args).some(key => !["sourceArtifactId", "originalSha256", "html"].includes(key))) {
    throw Error("Original runtime plan accepts only complete Original source and independently checked metadata");
  }
  const identity = HtmlProtectionArtifactIdentitySchema.pick({ sourceArtifactId: true, sha256: true }).strict()
    .parse({ sourceArtifactId: args.sourceArtifactId, sha256: args.originalSha256 });
  const html = args.html;
  if (typeof html !== "string") throw Error("Complete decoded Original required");
  const inventory = htmlProtectionInventory({ sourceArtifactId: identity.sourceArtifactId, html });
  const elements = inventory.documentElements, byPath = new Map(elements.map(element => [element.path, element]));
  const duplicateIds = new Set(inventory.duplicateIds.map(item => item.id)), gaps: Gap[] = [];
  const gap = (code: string, sourcePaths: string[] = [], parentObligationIds: string[] = []) => gaps.push({ code, sourcePaths, parentObligationIds });
  const coarseParents = inventory.runtimeObligations.map(parent => ({ ...parent }));
  const parentsByPath = new Map<string, string[]>();
  for (const parent of coarseParents) {
    const path = parent.target.replace(/@[^@]*$/, "");
    if (byPath.has(path)) parentsByPath.set(path, [...(parentsByPath.get(path) ?? []), parent.id]);
  }
  if (inventory.parseErrorCount) gap("original-parser-uncertainty");
  if (!Object.values(inventory.explicit).every(tag => tag.startTag && tag.endTag)) gap("implicit-original-document");
  for (const duplicate of inventory.duplicateIds) gap("duplicate-original-id", elements.filter(item => attribute(item, "id") === duplicate.id).map(item => item.path));
  const cardPaths = new Set(inventory.cards.map(card => card.path));
  function roles(element: HtmlProtectionElementFact): Role[] {
    const result: Role[] = [];
    if (cardPaths.has(element.path)) result.push("card");
    if (hasClass(element, "chapter")) result.push("chapter");
    if (nativeTags.has(element.tag) || element.tag === "a" && attribute(element, "href") !== undefined) result.push("native-control");
    if (hasClass(element, "sidebar")) result.push("sidebar");
    if (attribute(element, "id") === "progress") result.push("progress");
    if (attribute(element, "id") === "top") result.push("top");
    if (hasClass(element, "reveal")) result.push("reveal");
    if (hasClass(element, "check-item")) result.push("check-item");
    return result;
  }
  function selectorFor(element: HtmlProtectionElementFact): { selector: string | null; identityKind: Target["identityKind"] } {
    const id = attribute(element, "id");
    const reject = (code: string) => { gap(code, [element.path], parentsByPath.get(element.path)); return { selector: null, identityKind: "unavailable" as const }; };
    if (inventory.parseErrorCount) return reject("target-parser-uncertainty");
    if (element.inertContext || element.path.includes("/template/")) return reject("inert-target-unavailable");
    if (element.namespace !== HTML) return reject("foreign-target-unavailable");
    if (id !== undefined) {
      if (!id.length || duplicateIds.has(id) || id.includes("\0")) return reject("target-id-unavailable");
      const selector = cssId(id);
      if (selector.length > 500) return reject("target-selector-budget");
      return { selector, identityKind: "unique-id" };
    }
    // Missing IDs stay explicit; root/ordered body comparison must detect moved/replaced roots.
    gap("target-without-original-id", [element.path], parentsByPath.get(element.path));
    const pieces = element.path.split("/");
    if (pieces[0] !== "0" || pieces.length > 128 || pieces.slice(1).some(piece => !/^(0|[1-9]\d*)$/.test(piece))) return reject("invalid-original-dom-path");
    const chain: string[] = [];
    for (let length = 2; length <= pieces.length; length++) {
      const ancestor = byPath.get(pieces.slice(0, length).join("/"));
      if (!ancestor || ancestor.namespace !== HTML || ancestor.inertContext || !/^[a-z][a-z0-9-]*$/.test(ancestor.tag)) return reject("unsupported-original-dom-path");
      chain.push(ancestor.tag + ":nth-child(" + (Number(pieces[length - 1]) + 1) + ")");
    }
    const selector = chain.join(" > ");
    if (!selector.length || selector.length > 500) return reject("target-selector-budget");
    return { selector, identityKind: "structural-path" };
  }
  const targets: Target[] = elements.flatMap((element, index) => {
    const selectedRoles = roles(element);
    return selectedRoles.length ? [{ targetId: "original-element:" + index, sourcePath: element.path, tag: element.tag, namespace: element.namespace,
      id: attribute(element, "id") ?? null, roles: selectedRoles, ...selectorFor(element),
      originalElementIds: [], coarseParentIds: parentsByPath.get(element.path) ?? [] }] : [];
  });
  const targetByPath = new Map(targets.map(target => [target.sourcePath, target]));
  let ancestryOverflow = false;
  // Enumerate IDs through ancestors once, never O(targets * all descendants).
  for (const element of elements) {
    const id = attribute(element, "id");
    if (id === undefined || element.inertContext) continue;
    let path = element.path, depth = 0;
    while (byPath.has(path) && ++depth <= 128) {
      const target = targetByPath.get(path);
      if (target) {
        if (!id.length || duplicateIds.has(id)) {
          target.selector = null; target.identityKind = "unavailable";
          gap("subtree-id-unavailable", [target.sourcePath, element.path], target.coarseParentIds);
        } else target.originalElementIds.push(id);
      }
      path = parentPath(path);
    }
    if (depth > 128) { ancestryOverflow = true; gap("original-ancestry-budget", [element.path]); }
  }
  for (const target of targets) if (target.originalElementIds.length > HTML_PROTECTION_SNAPSHOT_LIMITS.nodes) {
    target.selector = null; target.identityKind = "unavailable"; gap("original-subtree-id-budget", [target.sourcePath]);
  }
  const sourceBase = { sourceArtifactId: identity.sourceArtifactId, originalSha256: identity.sha256 };
  const bootBatches: Batch[] = [], eligible = targets.filter(target => target.selector !== null);
  if (targets.length > TARGET_LIMIT) gap("runtime-target-plan-budget");
  else if (!ancestryOverflow) for (let start = 0; start < eligible.length; start += HTML_PROTECTION_SNAPSHOT_LIMITS.targets) {
    const selected = eligible.slice(start, start + HTML_PROTECTION_SNAPSHOT_LIMITS.targets), batchId = "original-boot:" + bootBatches.length;
    const registry = HtmlProtectionSnapshotRegistrySchema.parse({ schemaVersion: "html-protection-snapshot-registry-v1",
      originalSha256: identity.sha256, projection: "boot-subtree-v1", targets: selected.map(target => ({ targetId: target.targetId, selector: target.selector! })) });
    bootBatches.push({ batchId, stateId: "original-runtime:boot", registry,
      registeredScopes: { ...sourceBase, projection: "boot-subtree-v1", targets: selected.map(target => ({ targetId: target.targetId,
        root: { name: target.tag.toUpperCase(), namespace: target.namespace, id: target.id }, originalElementIds: [...target.originalElementIds] })) } });
  }
  const cards = elements.filter(element => hasClass(element, "slide-card")), chapters = elements.filter(element => hasClass(element, "chapter"));
  const controls = elements.filter(element => nativeTags.has(element.tag) || element.tag === "a" && attribute(element, "href") !== undefined);
  const cardChapter = cards.map(card => {
    let path = parentPath(card.path);
    while (byPath.has(path)) {
      const ancestor = byPath.get(path)!;
      if (hasClass(ancestor, "chapter")) return { cardPath: card.path, chapterPath: path, cardId: attribute(card, "id") ?? null, chapterId: attribute(ancestor, "id") ?? null };
      path = parentPath(path);
    }
    return { cardPath: card.path, chapterPath: null, cardId: attribute(card, "id") ?? null, chapterId: null };
  });
  const searchStates: SearchState[] = [];
  let searchRegistry: Registry | null = null;
  const inputs = elements.filter(element => attribute(element, "id") === "search"), counts = elements.filter(element => attribute(element, "id") === "searchCount");
  const searchPrerequisites = inventory.parseErrorCount === 0 && inputs.length === 1 && counts.length === 1
    && inputs[0]!.tag === "input" && inputs[0]!.namespace === HTML && !inputs[0]!.inertContext
    && !inputs[0]!.attributes.some(item => ["disabled", "readonly"].includes(item.name))
    && [undefined, "text", "search"].includes(attribute(inputs[0]!, "type"))
    && counts[0]!.namespace === HTML && !counts[0]!.inertContext && cards.length > 0 && chapters.length > 0
    && cards.length === inventory.cards.length && cards.every(card => !hasClass(card, "chapter")) && cards.every(card => cardPaths.has(card.path) && attribute(card, "data-search") !== undefined)
    && [...cards, ...chapters].every(element => element.namespace === HTML && !element.inertContext
      && Boolean(attribute(element, "id")) && !duplicateIds.has(attribute(element, "id")!))
    && cardChapter.every(item => item.chapterId !== null)
    && chapters.every(chapter => cardChapter.some(item => item.chapterPath === chapter.path))
    && cards.length <= HTML_PROTECTION_SNAPSHOT_LIMITS.nodes && chapters.length <= HTML_PROTECTION_SNAPSHOT_LIMITS.nodes;
  if (!searchPrerequisites) gap("search-original-scope-unavailable", [...inputs, ...counts, ...cards, ...chapters].map(element => element.path));
  else {
    const positive = attribute(cards[0]!, "data-search")!.match(/[\p{L}\p{N}]{2,32}/u)?.[0], lowerSource = html.toLowerCase();
    let negative: string | null = null;
    for (let index = 0; index < 128; index++) {
      const value = "__evolution_original_no_match_" + index + "__";
      if (!lowerSource.includes(value)) { negative = value; break; }
    }
    if (!positive || !negative) gap("search-original-query-unavailable", cards.map(element => element.path));
    else {
      searchRegistry = HtmlProtectionSnapshotRegistrySchema.parse({ schemaVersion: "html-protection-snapshot-registry-v1",
        originalSha256: identity.sha256, projection: "search-membership-v1", targetId: "original-search-catalog",
        cardSelector: ".slide-card", chapterSelector: ".chapter", inputSelector: "#search", countSelector: "#searchCount" });
      const cardIds = cards.map(card => attribute(card, "id")!), chapterIds = chapters.map(chapter => attribute(chapter, "id")!);
      function state(kind: SearchState["stateKind"], suffix: "boot" | "positive" | "negative" | "clear", value: string, predecessor: string | null, action: boolean) {
        const visible = cards.filter(card => attribute(card, "data-search")!.includes(value)).map(card => attribute(card, "id")!);
        const visibleChapters = chapterIds.filter(id => cardChapter.some(item => item.chapterId === id && visible.includes(item.cardId!)));
        const stateId = "original-runtime:search:" + suffix;
        searchStates.push({ stateId, stateKind: kind, stateIntent: kind === "query" ? (suffix === "positive" ? "query-positive" : "query-negative") : kind,
          predecessorStateId: predecessor,
          proposedActions: action ? [BrowserStepSchema.parse({ action: "fill", selector: "#search", value })] : [],
          requiredCapability: action ? "stateful-browser-actions-unavailable" : "native-boot-observation", inputValue: value,
          expectedVisibleCardIds: visible, expectedVisibleChapterIds: visibleChapters,
          registeredScopes: { ...sourceBase, projection: "search-membership-v1", targetId: "original-search-catalog",
            cardIds: [...cardIds], chapterIds: [...chapterIds], stateKind: kind, inputValue: value } });
        return stateId;
      }
      const boot = state("boot", "boot", attribute(inputs[0]!, "value") ?? "", null, false);
      const matched = state("query", "positive", positive, boot, true), empty = state("query", "negative", negative, matched, true);
      state("clear", "clear", "", empty, true);
      gap("search-js-causality-unverified", inputs.map(element => element.path), parentsByPath.get(inputs[0]!.path));
      gap("search-state-execution-unavailable", inputs.map(element => element.path), parentsByPath.get(inputs[0]!.path));
    }
  }
  const runtimeProfile: HtmlProtectionFiniteRuntimeProfile = { id: VERSION, sourceArtifactId: identity.sourceArtifactId,
    refinements: targets.length > TARGET_LIMIT || ancestryOverflow ? [] : coarseParents.flatMap(parent => {
      const path = parent.target.replace(/@[^@]*$/, ""), target = targetByPath.get(path);
      if (!target?.selector) return [];
      const children = [{ id: "original-runtime:" + parent.id + ":structure", target: target.selector,
        description: "Observe complete selected Original target structure at native boot; not control behavior or handler causality" }];
      if (searchRegistry && path === inputs[0]!.path) for (const item of searchStates) children.push({
        id: "original-runtime:" + parent.id + ":" + item.stateId, target: "original-search-catalog",
        description: "Proposed complete Original-ID membership observation in " + item.stateKind + " state; no execution or semantic completeness claim" });
      return [{ parentObligationId: parent.id, children }];
    }) };
  if (runtimeProfile.refinements.reduce((count, item) => count + item.children.length, 0) > TARGET_LIMIT) {
    gap("runtime-profile-child-budget"); runtimeProfile.refinements = [];
  }
  for (const parent of coarseParents) gap("coarse-runtime-unresolved", [], [parent.id]);
  for (const handler of inventory.handlers) gap("original-handler-causality-unknown", [handler.path]);
  if (inventory.scripts.some(script => script.potentialExecutable || script.activationUnresolved || script.runtimeConfiguration)) gap("script-generated-state-unenumerated");
  if (elements.some(element => element.inertContext || element.tag === "template")) gap("template-activation-unavailable");
  const copyTargets = targets.filter(target => {
    const element = byPath.get(target.sourcePath)!;
    return ["copy-slide", "copy-btn", "prompt-copy-all"].some(name => hasClass(element, name));
  });
  if (copyTargets.length) gap("copy-material-projection-unavailable", copyTargets.map(target => target.sourcePath), copyTargets.flatMap(target => target.coarseParentIds));
  return { schemaVersion: VERSION, sourceArtifactId: identity.sourceArtifactId, originalSha256: identity.sha256,
    census: { documentElements: elements.length, cards: inventory.cards.length, chapters: chapters.length,
      scripts: inventory.scripts.map(script => ({ index: script.index, sourcePath: script.path, kind: script.kind,
        potentialExecutable: script.potentialExecutable, runtimeConfiguration: script.runtimeConfiguration, inertContext: script.inertContext,
        src: script.src, type: script.type, sourceRange: script.range ? { ...script.range } : null, hasClosingTag: script.hasClosingTag })),
      controls: controls.map(element => ({ sourcePath: element.path, tag: element.tag, id: attribute(element, "id") ?? null,
        href: element.tag === "a" ? attribute(element, "href") ?? null : null, inertContext: element.inertContext,
        attributes: element.attributes.map(item => ({ name: item.name, namespace: item.namespace, value: item.value })),
        parentObligationIds: [...(parentsByPath.get(element.path) ?? [])] })),
      buttons: controls.filter(element => element.tag === "button").length, anchors: elements.filter(element => element.tag === "a").length,
      inputs: controls.filter(element => element.tag === "input").length, inlineHandlers: inventory.handlers.length,
      copyTargets: copyTargets.map(target => target.targetId), cardChapter },
    targets, bootBatches, search: { registry: searchRegistry, states: searchStates, membershipPrediction: "literal-data-search-substring-v1" },
    runtimeProfile, expectedScope: { coarseParents, mandatoryResidualParentIds: coarseParents.map(parent => parent.id),
      unobservedTargetIds: targets.filter(target => target.selector === null || targets.length > TARGET_LIMIT || ancestryOverflow).map(target => target.targetId) }, gaps,
    limitations: [
      "Original SHA is caller-verified physical metadata; decoded parsing supplies no byte hash or authority.",
      "Registries/proposed actions require trusted stateful execution; current cloud fresh Page only observes boot.",
      "Original static IDs/substring predictions are expected finite scope, not proof of post-script material, handlers or semantics.",
      "All coarse parents and mandatory residuals remain unresolved; known search cannot discharge unknown runtime.",
      "Copy/template/dynamic JS, responsive/hover/checkbox/navigation effects, visual and semantic scope remain incomplete.",
      "Original IDs/root scope do not prohibit legitimate explanatory additions; policy and core-method semantics need independent evaluation.",
      "No proof, signing, whole PASS, artifact mutation, frozen-paper rewrite or settlement is produced.",
    ] };
}
export type HtmlProtectionOriginalRuntimePlan = ReturnType<typeof htmlProtectionOriginalRuntimePlan>;
