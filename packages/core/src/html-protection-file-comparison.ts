import { htmlProtectionInventory, type HtmlProtectionInventory } from "./html-protection-inventory";

const same = (before: unknown, after: unknown) => JSON.stringify(before) === JSON.stringify(after);
function indexCards(inventory: HtmlProtectionInventory) {
  const byId = new Map<string, HtmlProtectionInventory["cards"]>();
  for (const card of inventory.cards) if (card.id !== null) {
    const items = byId.get(card.id) ?? []; items.push(card); byId.set(card.id, items);
  }
  return byId;
}
function literalSequence(before: Array<{ literal: string | null; bodyLiteral: string | null }>, after: Array<{ literal: string | null; bodyLiteral: string | null }>) {
  const readable = [...before, ...after].every((block) => block.literal !== null && block.bodyLiteral !== null);
  return { originalCount: before.length, currentCount: after.length,
    literalSequenceEqual: readable ? same(before.map((block) => block.literal), after.map((block) => block.literal)) : null,
    bodyLiteralSequenceEqual: readable ? same(before.map((block) => block.bodyLiteral), after.map((block) => block.bodyLiteral)) : null };
}
const semanticAttributes = (card: HtmlProtectionInventory["cards"][number]) => card.attributes.map((element) => ({
  ...element, attributes: element.attributes.map(({ name, namespace, value }) => ({ name, namespace, value })),
}));
const referenceSequence = (inventory: HtmlProtectionInventory) => inventory.references.map(({ tag, elementId, inertContext, name, namespace, value, literal }) =>
  ({ tag, elementId, inertContext, name, namespace, value, literal }));
const handlerSequence = (inventory: HtmlProtectionInventory) => inventory.handlers.map(({ tag, elementId, inertContext, name, namespace, value, literal }) =>
  ({ tag, elementId, inertContext, name, namespace, value, literal }));

/**
 * Full source comparison facts, not a protection decision. Policy must decide
 * which differences are authorized; candidate additions are reported separately.
 * Missing/duplicate card IDs are never replaced by positional guesses.
 */
export function compareHtmlProtectionFiles(args: { sourceArtifactId: string; originalHtml: string; currentHtml: string }) {
  const original = htmlProtectionInventory({ sourceArtifactId: args.sourceArtifactId, html: args.originalHtml });
  const current = htmlProtectionInventory({ sourceArtifactId: args.sourceArtifactId, html: args.currentHtml });
  const beforeById = indexCards(original), afterById = indexCards(current);
  const duplicateIds = new Set([...original.duplicateIds, ...current.duplicateIds].map((item) => item.id));
  const cards = original.cards.map((before) => {
    const matches = before.id === null ? [] : afterById.get(before.id) ?? [];
    const match = before.id === null ? "unidentified" : duplicateIds.has(before.id) || beforeById.get(before.id)!.length !== 1 || matches.length > 1
      ? "ambiguous" : matches.length === 0 ? "missing" : "unique-id";
    const after = match === "unique-id" ? matches[0]! : undefined;
    return { originalIndex: before.index, id: before.id, match, currentIndex: after?.index ?? null,
      textEqual: after ? before.text === after.text : null, titleEqual: after ? before.title === after.title : null,
      structureEqual: after ? same(before.structure, after.structure) : null,
      attributesEqual: after ? same(semanticAttributes(before), semanticAttributes(after)) : null,
      sourceLiteralEqual: after && before.literal !== null && after.literal !== null ? before.literal === after.literal : null };
  });
  const allMatched = cards.every((card) => card.match === "unique-id");
  const originalOrderPreserved = allMatched ? cards.every((card, index) => index === 0 || card.currentIndex! > cards[index - 1]!.currentIndex!) : null;
  return { schemaVersion: "html-protection-diff-v1" as const, readWholeFiles: true as const, sourceArtifactId: args.sourceArtifactId,
    original, current, cards, originalOrderPreserved,
    addedCardIndexes: current.cards.filter((card) => card.id !== null && !beforeById.has(card.id)).map((card) => card.index),
    unidentifiedCurrentCardIndexes: current.cards.filter((card) => card.id === null).map((card) => card.index),
    styles: literalSequence(original.styles, current.styles), scripts: literalSequence(original.scripts, current.scripts),
    referencesSequenceEqual: same(referenceSequence(original), referenceSequence(current)),
    handlersSequenceEqual: same(handlerSequence(original), handlerSequence(current)),
    referenceOwnerPathsEqual: same(original.references.map((item) => item.path), current.references.map((item) => item.path)),
    handlerOwnerPathsEqual: same(original.handlers.map((item) => item.path), current.handlers.map((item) => item.path)),
    documentStructureEqual: same(original.documentElements.map(({ path, tag, namespace, inertContext }) => ({ path, tag, namespace, inertContext })),
      current.documentElements.map(({ path, tag, namespace, inertContext }) => ({ path, tag, namespace, inertContext }))),
    limitations: ["Differences are observations, not product failures; editable scopes and authorized additions require separate policy.",
      "Matching literals, card IDs and attributes do not establish semantic, visual or runtime preservation."] };
}
export type HtmlProtectionFileComparison = ReturnType<typeof compareHtmlProtectionFiles>;
