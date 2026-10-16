import { HtmlProtectionSemanticFrozenRequirementsSchema, type HtmlProtectionObligation, type HtmlProtectionSemanticFrozenRequirements } from "@evolution/contracts";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { compareHtmlProtectionFiles, type HtmlProtectionFileComparison } from "./html-protection-file-comparison";
import { htmlProtectionInventory } from "./html-protection-inventory";
import type { HtmlProtectionObligationPlan } from "./html-protection-obligation-plan";
import { htmlProtectionContentScope } from "./html-protection-content-scope";
type Status = "verified" | "failed" | "unverified";
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const HTML_PROTECTION_SEMANTIC_REQUIREMENT_SCOPE_POLICY = "html-protection-semantic-requirement-scope-v1-complete-frozen-input";
const contentWords = /(?:正文|文本|文字|内容|说明|解释|\b(?:body|text|content|wording|explanation)\b)/i;
const refinementWords = /(?:细化|细致|细节|更完整|更全面|更直白|更易.{0,8}理解|补充|\b(?:refine|clarify|elaborate|expand|more detailed|easier to understand)\b)/i;
const negativeWords = /(?:不得|禁止|不能|不允许|无需|不应|不要|\b(?:not|never|no|cannot|without)\b)/i;
const literalWords = /(?:逐字|逐句|原样|保持不变|不得更改|原文.{0,8}(?:不变|一致)|\b(?:verbatim|byte.identical|character.for.character|unmodified|unedited|unchanged|unaltered|no changes)\b)/i;
const modificationWords = /(?:修改|改写|重写|更改|调整|删除|替换|\b(?:alter|modify|change|edit|rewrite|delete|replace)\b)/i;
const clauses = (value: string) => value.split(/[。；;，,\n]/).map(item => item.trim()).filter(Boolean);
type SemanticRequirementScope = { obligationId: string; mode: "semantic-refinement" | "literal-retention" | "unknown";
  verificationStatus: "verified" | "failed" | "unverified"; editableCardIds: string[]; editableWholeDocumentBody: boolean; refinementCriterionIds: string[];
  protectedCriterionIds: string[]; gaps: string[] };
/** Narrow, deterministic region interpretation. Unknown natural-language scope is retained, never guessed by the model. */
function semanticRegions(statement: string, cardIds: readonly string[]) {
  if (/(?:除外|以外|之外|其余|其他|除了|部分|指定|\b(?:except|excluding|outside|unless|but|other|selected|some|specific)\b)/i.test(statement)) return { known: false, cardIds: [] as string[], documentBody: false };
  const selector = /#([\p{L}\p{N}_:-]+)|\[\s*id\s*=\s*["']([^"']+)["']\s*\]/gu;
  const selectors = [...statement.matchAll(selector)].map(match => match[1] ?? match[2]!);
  // This bounded grammar is deliberately not a free-text authorization parser. Residual words may hide a narrower scope.
  const residual = statement.replace(selector, " ").replace(/\b(?:refine|clarify|elaborate|expand|more|detailed|easier|to|understand|only|body|text|content|wording|explanation|explanations|card|cards|of|the|in|and|for|all|entire|whole|original|existing|keep|preserve|retain|do|must|not|never|no|modify|change|edit|rewrite|delete|replace|verbatim|unmodified|unedited)\b/gi, " ")
    .replace(/(?:细化|细致|细节|更完整|更全面|更直白|更易理解|补充|所有|全部|整个|全文|仅|只|正文|文本|文字|内容|说明|解释|卡片|原始|原有|保持|保留|禁止|不得|不允许|修改|改写|重写|更改|删除|替换|逐字|逐句|原样|的|中|和|与)/g, " ").replace(/[\s\p{P}\p{S}]/gu, "");
  if (residual) return { known: false, cardIds: [] as string[], documentBody: false };
  if (selectors.length) return selectors.every(id => cardIds.includes(id))
    ? { known: true, cardIds: [...new Set(selectors)], documentBody: false } : { known: false, cardIds: [] as string[], documentBody: false };
  // Unqualified or named/positional regions need independent interpretation. A source-wide refinement flag supplies no region permission.
  if (contentWords.test(statement) && /(?:所有|全部|整个|全文|\b(?:all|entire|whole)\b)/i.test(statement)
    && !/(?:除了|除外|部分|指定|\b(?:except|excluding|selected|some|specific)\b)/i.test(statement)) return { known: true, cardIds: [...cardIds], documentBody: !/(?:卡片|\bcard[s]?\b)/i.test(statement) };
  return { known: false, cardIds: [] as string[], documentBody: false };
}
type SemanticTextNode = { path: string; cardId?: string; body: boolean; start: number; end: number; literal: string };
function semanticTextNodes(html: string, plan: HtmlProtectionObligationPlan) {
  let errors = 0;
  const root = parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false, onParseError: () => { errors++; } });
  type Frame = { node: DefaultTreeAdapterTypes.Node; path: string; cardId?: string; blocked: boolean; inBody: boolean };
  const pending: Frame[] = [{ node: root, path: "0", blocked: false, inBody: false }], result: SemanticTextNode[] = [];
  const cardsByPath = new Map(plan.scope.cards.map(card => [card.path, card]));
  let visited = 0;
  while (pending.length) {
    const frame = pending.pop()!, node = frame.node;
    if (++visited > 250000) throw Error("html-protection-semantic-complete-text-node-capacity");
    const element = "tagName" in node ? node : undefined;
    const expectedCard = cardsByPath.get(frame.path);
    const cardId = expectedCard?.id ?? frame.cardId;
    const inBody = frame.inBody || element?.tagName === "body";
    const blocked = frame.blocked || Boolean(element && (/^(?:script|style|template|noscript|h[1-6]|button|input|textarea|select|option|a)$/i.test(element.tagName)
      || element.namespaceURI !== "http://www.w3.org/1999/xhtml"));
    if (node.nodeName === "#text" && "value" in node) {
      const location = node.sourceCodeLocation;
      if (!location) return { complete: false, nodes: [] as SemanticTextNode[] };
      result.push({ path: frame.path, cardId, body: !blocked && inBody, start: location.startOffset, end: location.endOffset,
        literal: html.slice(location.startOffset, location.endOffset) });
    }
    const children: DefaultTreeAdapterTypes.Node[] = "childNodes" in node ? node.childNodes : [];
    let elementIndex = children.filter(child => "tagName" in child).length;
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index]!, path = "tagName" in child ? frame.path + "/" + (--elementIndex) : frame.path + "/text-" + index;
      pending.push({ node: child, path, cardId, blocked, inBody });
    }
    if (element?.tagName === "template" && "content" in element) {
      const children = (element as DefaultTreeAdapterTypes.Template).content.childNodes;
      for (let index = children.length - 1; index >= 0; index--) pending.push({ node: children[index]!, path: frame.path + "/template/" + index, cardId, blocked: true, inBody });
    }
  }
  return { complete: errors === 0, nodes: result };
}
/** Independently constrain edits to Original regions from the exact frozen rubric and explicit editable/protected scope.
 * This produces neither modification authority nor preservation PASS: observed meaning still needs full grounded observations.
 */
export function deriveHtmlProtectionSemanticRequirementScopes(args: { plan: HtmlProtectionObligationPlan;
  frozenRequirements: HtmlProtectionSemanticFrozenRequirements; originalHtml: string; executedHtml: string }) {
  const frozen = HtmlProtectionSemanticFrozenRequirementsSchema.parse(args.frozenRequirements), plan = args.plan;
  if (frozen.sourceArtifactId !== plan.sourceArtifactId || new Set(frozen.rubric.map(item => item.id)).size !== frozen.rubric.length
    || new Set(frozen.paper.map(item => item.id)).size !== frozen.paper.length
    || frozen.paper.filter(item => equal(item, frozen.testCase)).length !== 1 || !frozen.testCase.criterionIds.includes(frozen.criterionId)
    || frozen.rubric.filter(item => item.id === frozen.criterionId && item.hardGate && item.protectedConstraint
      && (!item.artifactIds.length || item.artifactIds.includes(plan.sourceArtifactId))).length !== 1) throw Error("html-protection-semantic-frozen-paper-scope-invalid");
  if (!equal(htmlProtectionInventory({ sourceArtifactId: plan.sourceArtifactId, html: args.originalHtml }), plan.originalInventory)) throw Error("html-protection-semantic-original-inventory-drift");
  const contentScope = htmlProtectionContentScope({ sourceArtifactId: plan.sourceArtifactId,
    frozenContract: { protectionCriterionId: frozen.criterionId, rubric: frozen.rubric } });
  if (!equal(contentScope, plan.contentScope)) throw Error("html-protection-semantic-frozen-content-plan-drift");
  const ids = plan.scope.cards.flatMap(card => card.id ? [card.id] : []), gaps: string[] = [...(plan.contentScope?.gaps ?? [])];
  if (ids.length !== plan.scope.cards.length || new Set(ids).size !== ids.length || plan.originalInventory.duplicateIds.length) gaps.push("html-protection-semantic-original-card-scope-ambiguous");
  const relevant = frozen.rubric.filter(item => !item.artifactIds.length || item.artifactIds.includes(plan.sourceArtifactId));
  const permitted = new Set<string>(), editable = new Set<string>(), denied = new Set<string>(), refinementCriterionIds: string[] = [], protectedCriterionIds: string[] = [];
  let permittedDocumentBody = false, editableDocumentBody = false, deniedDocumentBody = false;
  const refinements = relevant.filter(item => plan.contentScope?.refinementCriterionIds.includes(item.id));
  for (const criterion of refinements) for (const statement of clauses(criterion.requirement)) {
    if (!contentWords.test(statement) || !refinementWords.test(statement) || negativeWords.test(statement)) {
      if (!literalWords.test(statement) && (/#[\p{L}\p{N}_:-]+|\[\s*id\s*=/u.test(statement)
        || contentWords.test(statement) && /(?:仅|保留|不变|\b(?:only|except|must|remain|keep|retain|preserve)\b)/i.test(statement))) gaps.push("html-protection-semantic-refinement-constraint-unknown:" + criterion.id);
      continue;
    }
    const region = semanticRegions(statement, ids); refinementCriterionIds.push(criterion.id);
    if (!region.known) gaps.push("html-protection-semantic-refinement-region-unknown:" + criterion.id);
    else { region.cardIds.forEach(id => permitted.add(id)); permittedDocumentBody ||= region.documentBody; }
  }
  for (const statement of frozen.editableItems.flatMap(clauses)) {
    const region = semanticRegions(statement, ids);
    if (!contentWords.test(statement) || negativeWords.test(statement) || !region.known) gaps.push("html-protection-semantic-editable-region-unknown");
    else { region.cardIds.forEach(id => editable.add(id)); editableDocumentBody ||= region.documentBody; }
  }
  if (refinements.length && (!refinementCriterionIds.length || !editable.size)) gaps.push("html-protection-semantic-explicit-editable-region-missing");
  if (permitted.size && editable.size && ![...permitted].some(id => editable.has(id))) gaps.push("html-protection-semantic-rubric-editable-region-conflict");
  const restrictions = [...relevant.filter(item => item.protectedConstraint || item.hardGate).map(item => ({ id: item.id, text: item.requirement, explicitProtectedItem: false })),
    ...frozen.protectedItems.map((text, index) => ({ id: "protected-item:" + index, text, explicitProtectedItem: true }))];
  for (const restriction of restrictions) for (const statement of clauses(restriction.text)) {
    const explicitRegion = /#[\p{L}\p{N}_:-]+|\[\s*id\s*=/u.test(statement), namedRegion = contentWords.test(statement) || /(?:卡片|\bcard[s]?\b)/i.test(statement) || explicitRegion;
    if (!(literalWords.test(statement) || namedRegion && negativeWords.test(statement) && modificationWords.test(statement)
      || restriction.explicitProtectedItem && explicitRegion)) continue;
    const region = semanticRegions(statement, ids); protectedCriterionIds.push(restriction.id);
    if (!region.known) gaps.push("html-protection-semantic-protected-region-unknown:" + restriction.id);
    else { region.cardIds.forEach(id => denied.add(id)); deniedDocumentBody ||= region.documentBody; }
  }
  const allowed = new Set([...permitted].filter(id => editable.has(id) && !denied.has(id)));
  const editableWholeDocumentBody = permittedDocumentBody && editableDocumentBody && !deniedDocumentBody;
  const original = semanticTextNodes(args.originalHtml, plan), executed = semanticTextNodes(args.executedHtml, plan);
  const complete = original.complete && executed.complete && original.nodes.length === executed.nodes.length
    && original.nodes.every((node, index) => node.path === executed.nodes[index]?.path && node.cardId === executed.nodes[index]?.cardId && node.body === executed.nodes[index]?.body);
  if (!complete) gaps.push("html-protection-semantic-complete-text-partition-unavailable");
  const mayEdit = (node: SemanticTextNode) => !gaps.length && node.body && (node.cardId ? allowed.has(node.cardId) : editableWholeDocumentBody);
  const forbidden = complete ? original.nodes.filter((node, index) => !mayEdit(node) && node.literal !== executed.nodes[index]!.literal) : [];
  const mask = (html: string, nodes: SemanticTextNode[]) => { let result = "", at = 0; for (const node of nodes.filter(mayEdit)) {
    result += html.slice(at, node.start) + "<!--frozen-editable-text:" + node.path + "-->"; at = node.end;
  } return result + html.slice(at); };
  const documentMismatch = complete && mask(args.originalHtml, original.nodes) !== mask(args.executedHtml, executed.nodes);
  const scopes: SemanticRequirementScope[] = plan.requiredObligations.filter(item => item.evidenceKind === "semantic").map(item => {
    const card = plan.scope.cards.find(card => card.semanticObligationId === item.id || card.contentObligationId === item.id);
    const failed = !gaps.length && (card ? forbidden.some(node => node.cardId === card.id) : documentMismatch);
    return { obligationId: item.id, mode: gaps.length ? "unknown" : card && !allowed.has(card.id!) ? "literal-retention" : allowed.size ? "semantic-refinement" : "literal-retention",
      verificationStatus: failed ? "failed" : gaps.length ? "unverified" : "verified", editableCardIds: [...allowed], editableWholeDocumentBody,
      refinementCriterionIds: [...new Set(refinementCriterionIds)], protectedCriterionIds: [...new Set(protectedCriterionIds)], gaps: [...new Set(gaps)] };
  });
  return { policyVersion: HTML_PROTECTION_SEMANTIC_REQUIREMENT_SCOPE_POLICY, frozenRequirements: frozen,
    sourceScopedCriteria: relevant, editableCardIds: [...allowed], editableWholeDocumentBody, scopes, gaps: [...new Set(gaps)] };
}
/** Full-source comparison over independently pinned physical inputs; this supplies static observations only. */
export function deriveHtmlProtectionStaticObservations(args: { plan: HtmlProtectionObligationPlan;
  originalHtml: string; executedHtml: string }) {
  const comparison = compareHtmlProtectionFiles({ sourceArtifactId: args.plan.sourceArtifactId, originalHtml: args.originalHtml, currentHtml: args.executedHtml });
  if (!equal(comparison.original, args.plan.originalInventory)) throw Error("Static Original inventory differs from independently derived complete plan");
  // Frozen content refinement does not authorize adding cards, controls, executable domains or structural regions.
  // New-card existence is a fact, never a source of permission. Compare the entire physical tree unchanged.
  const supported = comparison.unidentifiedCurrentCardIndexes.length === 0
    && comparison.current.duplicateIds.length === 0 && comparison.original.duplicateIds.length === 0;
  const projected = args.executedHtml;
  const projectedInventory = htmlProtectionInventory({ sourceArtifactId: args.plan.sourceArtifactId, html: projected });
  const projectionClean = supported && comparison.original.parseErrorCount === 0 && projectedInventory.parseErrorCount === 0;
  const elements = (inventory: HtmlProtectionFileComparison["original"]) => inventory.documentElements.map(({ path, tag, namespace, inertContext }) => ({ path, tag, namespace, inertContext }));
  const attributes = (inventory: HtmlProtectionFileComparison["original"]) => inventory.documentElements.map(({ path, tag, namespace, inertContext, attributes }) => ({ path, tag, namespace, inertContext,
    attributes: attributes.map(({ name, namespace, value }) => ({ name, namespace, value })) }));
  const staticFacts: Array<{ obligationId: string; verificationStatus: Status; fact: string }> = [];
  const supportedObligationIds: string[] = [];
  function record(id: string, known: boolean, matches: boolean | null, fact: string) {
    if (known) supportedObligationIds.push(id);
    staticFacts.push({ obligationId: id, verificationStatus: !known || matches === null ? "unverified" : matches ? "verified" : "failed", fact });
  }
  const document = args.plan.scope.document;
  const explicit = Object.values(projectedInventory.explicit).every(value => value.startTag && value.endTag);
  record(document.format, projectionClean && explicit, true, "Complete physical UTF-8 HTML documents parsed with explicit document tags");
  if (args.plan.requiredObligations.find(item => item.id === document.content)?.evidenceKind === "static") {
    // Exact full text is sufficient for this STATIC obligation only. Semantic,
    // visual and runtime obligations remain separate and require their own ports.
    record(document.content, true, args.originalHtml === args.executedHtml ? true : null, "Full-document literal content comparison; additions/refinement require separate evidence");
  }
  record(document.structure, projectionClean, equal(elements(comparison.original), elements(projectedInventory)), "Entire ordered Original element structure without implicit new-region permission");
  record(document.attributes, projectionClean, equal(attributes(comparison.original), attributes(projectedInventory)), "Every Original element attribute with its complete owning element");
  record(document.sequences, projectionClean, comparison.originalOrderPreserved === true
    && comparison.styles.literalSequenceEqual === true && comparison.scripts.literalSequenceEqual === true
    && comparison.referencesSequenceEqual && comparison.handlersSequenceEqual, "Full card/script/style/reference/handler source sequence");
  for (const card of args.plan.scope.cards) {
    const fact = comparison.cards[card.originalIndex]!;
    for (const id of card.staticObligationIds) {
      const type = args.plan.requiredObligations.find(item => item.id === id)!.kind;
      const value = type === "card-content" ? fact.textEqual : type === "card-title" ? fact.titleEqual : type === "card-structure" ? fact.structureEqual : fact.attributesEqual;
      record(id, comparison.original.parseErrorCount === 0 && comparison.current.parseErrorCount === 0
        && (fact.match === "unique-id" || fact.match === "missing"), fact.match === "missing" ? false : value, "Independently matched complete Original card " + card.originalIndex + " " + type);
    }
  }
  args.plan.scope.styles.forEach((id, index) => record(id, comparison.original.styles[index]!.literal !== null && comparison.current.styles[index]?.literal !== null,
    comparison.original.styles[index]!.literal === comparison.current.styles[index]?.literal, "Entire embedded CSS literal/attributes and source order"));
  args.plan.scope.scripts.forEach((id, index) => record(id, comparison.original.scripts[index]!.literal !== null && comparison.current.scripts[index]?.literal !== null,
    comparison.original.scripts[index]!.literal === comparison.current.scripts[index]?.literal, "Entire embedded script literal/attributes and source order"));
  args.plan.scope.references.forEach((id, index) => record(id, projectionClean,
    equal(comparison.original.references[index], projectedInventory.references[index]), "Complete original reference and owning projected source scope"));
  args.plan.scope.handlers.forEach((id, index) => record(id, projectionClean,
    equal(comparison.original.handlers[index], projectedInventory.handlers[index]), "Complete original handler and owning projected source scope"));
  return { comparison, staticFacts, supportedObligationIds,
    limitations: ["Complete new-card/region additions receive no implicit modification or runtime authority.", "Static source observations do not establish semantic, visual, browser or unknown residual preservation."] };
}
/** Change support only after independent indexed capability derivation; unknown runtime is never silently resolved. */
export function supportHtmlProtectionObservedObligations(required: readonly HtmlProtectionObligation[], supportedIds: readonly string[]) {
  const supported = new Set(supportedIds), expected = new Set(required.map(item => item.id));
  if (supported.size !== supportedIds.length || [...supported].some(id => !expected.has(id))) throw Error("Supported HTML protection scope is duplicated or foreign");
  return required.map(item => supported.has(item.id) && item.kind !== "unknown-runtime" ? { ...item, support: "supported" as const } : { ...item });
}
