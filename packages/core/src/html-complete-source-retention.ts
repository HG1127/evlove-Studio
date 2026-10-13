import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { z } from "zod";
import { htmlProtectionInventory } from "./html-protection-inventory";

const MAX_CHARACTERS = 20 * 1024 * 1024;
const MAX_MAP_RANGES = 20_000;
const Input = z.object({ originalHtml: z.string().min(1).max(MAX_CHARACTERS), currentHtml: z.string().min(1).max(MAX_CHARACTERS) }).strict();
const HTML = "http://www.w3.org/1999/xhtml";
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const NAMED_PROPERTIES = new Set(["__proto__", "constructor", "prototype", "window", "self", "parent", "top", "frames", "document", "location", "name", "event", "submit", "reset", "action", "method", "elements", "length", "item", "namedItem"]);
const whitespace = (value: string) => /^[\t\n\f\r ]$/.test(value);
type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
type Range = { start: number; end: number };
type Gap = { code: string; role: "original" | "current" | "comparison"; offset?: number; cardId?: string };
export type HtmlCompleteSourceMapSegment = { original: Range; current: Range };
export type HtmlCompleteSourceErasureRange = Range & { originalInsertionOffset: number };
type ElementRecord = { element: Element; range: Range | null; inert: boolean };
const attribute = (element: Element, name: string) => element.attrs.find(item => item.name === name && !item.namespace)?.value;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Unicode scalar validation makes literal string equality an exact UTF-8 encoding fact, never physical custody. */
function utf8(html: string) {
  let bytes = 0, invalidCount = 0;
  for (let index = 0; index < html.length; index++) {
    const value = html.charCodeAt(index);
    if (value >= 0xd800 && value <= 0xdbff) {
      const next = html.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index++; } else invalidCount++;
    } else if (value >= 0xdc00 && value <= 0xdfff) invalidCount++;
    else bytes += value < 0x80 ? 1 : value < 0x800 ? 2 : 3;
  }
  return { byteLength: invalidCount ? null : bytes, invalidSurrogateCount: invalidCount };
}
function inspect(html: string, role: "original" | "current", gaps: Gap[]) {
  // This internal ID labels supplied strings only; it is not an Artifact/provenance identity.
  // A leading UTF-8 signature is outside the HTML parser's character stream. Keep it
  // in every full-source comparison/map and translate all parser offsets back by one.
  const parserOffset = html.startsWith("\uFEFF") ? 1 : 0;
  const parserHtml = html.slice(parserOffset);
  const indexed = htmlProtectionInventory({ sourceArtifactId: "supplied-complete-source", html: parserHtml });
  const inventory = { ...indexed, cards: indexed.cards.map(card => ({ ...card,
    range: card.range ? { start: card.range.start + parserOffset, end: card.range.end + parserOffset } : null })) };
  if (inventory.parseErrorCount) gaps.push({ code: "parser-errors", role });
  if (inventory.duplicateIds.length) gaps.push({ code: "duplicate-element-id", role });
  const encoding = utf8(html);
  if (encoding.invalidSurrogateCount) gaps.push({ code: "non-scalar-utf16", role });
  const document = parse(parserHtml, { scriptingEnabled: false, sourceCodeLocationInfo: true });
  const records: ElementRecord[] = [], pending: Array<{ node: Node; inert: boolean }> = [{ node: document, inert: false }];
  let visited = 0;
  while (pending.length) {
    if (++visited > 250_000) throw Error("Complete source comparison exceeds the node limit");
    const frame = pending.pop()!, node = frame.node;
    const inert = frame.inert || "tagName" in node && ["template", "noscript"].includes(node.tagName);
    if ("tagName" in node) {
      const location = node.sourceCodeLocation;
      const range = location ? { start: location.startOffset + parserOffset, end: location.endOffset + parserOffset } : null;
      records.push({ element: node, range, inert });
      if (!location?.startTag) gaps.push({ code: "implicit-element", role, ...(range ? { offset: range.start } : {}) });
      else if (!location.endTag && !(node.namespaceURI === HTML && VOID.has(node.tagName))
        && !(node.namespaceURI !== HTML && /\/>$/.test(parserHtml.slice(location.startTag.startOffset, location.startTag.endOffset)))) {
        gaps.push({ code: "implicit-end-tag", role, offset: location.startOffset + parserOffset });
      }
      if (node.tagName === "template" && "content" in node) {
        for (const child of (node as DefaultTreeAdapterTypes.Template).content.childNodes) pending.push({ node: child, inert: true });
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) pending.push({ node: child, inert });
  }
  records.sort((a, b) => (a.range?.start ?? -1) - (b.range?.start ?? -1));
  return { inventory, records, encoding, parserOffset };
}
function firstRecord(records: ElementRecord[], offset: number) {
  let low = 0, high = records.length;
  while (low < high) { const middle = (low + high) >>> 1; if ((records[middle]!.range?.start ?? -1) < offset) low = middle + 1; else high = middle; }
  return low;
}
function adjacentEnvelope(html: string, range: Range): Range {
  let { start, end } = range;
  while (start > 0 && whitespace(html[start - 1]!)) start--;
  while (end < html.length && whitespace(html[end]!)) end++;
  return { start, end };
}
function appendMap(map: HtmlCompleteSourceMapSegment[], original: Range, current: Range) {
  if (original.start === original.end) return;
  const last = map.at(-1);
  if (last && last.original.end === original.start && last.current.end === current.start) {
    last.original.end = original.end; last.current.end = current.end;
  } else map.push({ original: { ...original }, current: { ...current } });
  if (map.length > MAX_MAP_RANGES) throw Error("source-map-capacity");
}
function appendRange(ranges: HtmlCompleteSourceErasureRange[], start: number, end: number, originalInsertionOffset: number) {
  const last = ranges.at(-1);
  if (last?.end === start && last.originalInsertionOffset === originalInsertionOffset) last.end = end; else ranges.push({ start, end, originalInsertionOffset });
  if (ranges.length > MAX_MAP_RANGES) throw Error("source-map-capacity");
}

/**
 * Complete supplied source comparison only. No source snippets, hash shortcut, authorization,
 * verification status or protection verdict. A mapping erases whole parsed additional cards,
 * plus explicitly mapped ASCII whitespace adjacent to those cards; nothing else is normalized.
 */
export function compareHtmlCompleteSourceRetention(raw: { originalHtml: string; currentHtml: string }) {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) throw Error("Complete Original/current strings are the only comparison inputs");
  const { originalHtml, currentHtml } = parsed.data;
  const gaps: Gap[] = [];
  const original = inspect(originalHtml, "original", gaps), current = inspect(currentHtml, "current", gaps);
  const originalCardIds = new Set(original.inventory.cards.map(card => card.id));
  const originalNames = new Set(original.records.flatMap(({ element }) => element.attrs
    .filter(item => !item.namespace && ["id", "name"].includes(item.name)).map(item => item.value)));
  const currentIds = new Map<string, number>();
  const currentCardIds = new Set(current.inventory.cards.map(card => card.id));
  const currentArticleByStart = new Map(current.records.filter(item => item.range && item.element.tagName === "article").map(item => [item.range!.start, item]));
  for (const { element } of current.records) { const id = attribute(element, "id"); if (id !== undefined) currentIds.set(id, (currentIds.get(id) ?? 0) + 1); }
  for (const [role, inventory] of [["original", original.inventory], ["current", current.inventory]] as const) {
    for (const card of inventory.cards) if (!card.id || card.range === null) gaps.push({ code: "card-identity-or-source-unavailable", role });
  }
  for (const card of original.inventory.cards) if (card.id && !currentCardIds.has(card.id)) {
    gaps.push({ code: "original-card-missing", role: "comparison", cardId: card.id });
  }
  const additionalCards = current.inventory.cards.filter(card => !originalCardIds.has(card.id)).map(card => {
    const record = card.range ? currentArticleByStart.get(card.range.start) : undefined;
    const location = record?.element.sourceCodeLocation;
    const closed = Boolean(card.range && location?.startTag && location.endTag && location.startOffset + current.parserOffset === card.range.start
      && location.endTag.endOffset + current.parserOffset === card.range.end && /^<\/article[\t\n\f\r ]*>$/i.test(currentHtml.slice(location.endTag.startOffset + current.parserOffset, location.endTag.endOffset + current.parserOffset)));
    const hazards: string[] = [];
    if (!closed) hazards.push("additional-card-not-explicitly-closed");
    if (card.inertContext || record?.inert) hazards.push("additional-card-inert-context");
    if (!card.id || currentIds.get(card.id) !== 1) hazards.push("additional-card-not-unique");
    if (card.id && originalNames.has(card.id)) hazards.push("original-named-property-clobber");
    if (card.range) for (let recordIndex = firstRecord(current.records, card.range.start); recordIndex < current.records.length; recordIndex++) {
      const item = current.records[recordIndex]!;
      if (!item.range) continue;
      if (item.range.start >= card.range.end) break;
      if (item.range.end > card.range.end) hazards.push("additional-node-range-escapes-card");
      const element = item.element;
      if (["script", "style", "iframe", "object", "embed", "base", "animate", "animatemotion", "animatetransform", "set", "foreignobject"].includes(element.tagName.toLowerCase())) hazards.push("additional-active-or-style-element");
      if (element.tagName === "meta" && attribute(element, "http-equiv")) hazards.push("additional-document-configuration");
      if (element.tagName === "link" && (attribute(element, "rel") ?? "").split(/\s+/).some(value => value.toLowerCase() === "stylesheet")) hazards.push("additional-stylesheet-reference");
      for (const item of element.attrs) {
        if (/^on[a-z]+$/i.test(item.name)) hazards.push("additional-event-handler");
        if (["id", "name"].includes(item.name) && (originalNames.has(item.value) || NAMED_PROPERTIES.has(item.value))) hazards.push("additional-named-property-risk");
        if (["src", "srcset", "poster", "data", "action", "formaction", "xlink:href", "ping", "background"].includes(item.name) && item.value.trim()) hazards.push("additional-resource-reference");
        if (item.name === "href" && item.value.trim() && !item.value.trim().startsWith("#")) hazards.push("additional-resource-reference");
        if (item.name === "style" && /\b(?:url|image-set|image)\s*\(|@import|\\/i.test(item.value)) hazards.push("additional-inline-style-resource");
      }
    }
    const uniqueHazards = [...new Set(hazards)];
    for (const code of uniqueHazards) gaps.push({ code, role: "current", ...(card.id ? { cardId: card.id } : {}) });
    return { id: card.id, currentIndex: card.index, range: card.range ? { ...card.range } : null, closed, inertContext: card.inertContext,
      uniqueId: Boolean(card.id && currentIds.get(card.id) === 1), hazards: uniqueHazards };
  });
  const nodeRanges = additionalCards.flatMap(card => card.range ? [{ ...card.range }] : []).sort((a, b) => a.start - b.start);
  for (let index = 1; index < nodeRanges.length; index++) if (nodeRanges[index]!.start < nodeRanges[index - 1]!.end) gaps.push({ code: "overlapping-additional-cards", role: "current" });
  const sourceSequences = {
    stylesEqual: same(original.inventory.styles.map(item => item.literal), current.inventory.styles.map(item => item.literal)),
    scriptsEqual: same(original.inventory.scripts.map(item => item.literal), current.inventory.scripts.map(item => item.literal)),
    handlersEqual: same(original.inventory.handlers.map(item => item.literal), current.inventory.handlers.map(item => item.literal)),
  };
  for (const [field, equal] of Object.entries(sourceSequences)) if (!equal) gaps.push({ code: field + "-source-sequence-changed", role: "comparison" });
  const map: HtmlCompleteSourceMapSegment[] = [], whitespaceRanges: HtmlCompleteSourceErasureRange[] = [], mappedNodes: HtmlCompleteSourceErasureRange[] = [];
  let firstDifference: { originalOffset: number; currentOffset: number } | null = null;
  let available = gaps.length === 0, originalOffset = 0, currentOffset = 0;
  const outside = (end: number) => {
    const value = currentHtml.slice(currentOffset, end), expected = originalHtml.slice(originalOffset, originalOffset + value.length);
    if (value !== expected) {
      let match = 0; while (match < Math.min(value.length, expected.length) && value[match] === expected[match]) match++;
      firstDifference = { originalOffset: originalOffset + match, currentOffset: currentOffset + match };
      gaps.push({ code: "source-outside-additions-changed", role: "comparison", offset: currentOffset + match }); return false;
    }
    appendMap(map, { start: originalOffset, end: originalOffset + value.length }, { start: currentOffset, end });
    originalOffset += value.length; currentOffset = end; return true;
  };
  if (available) try {
    const groups: Array<Range & { nodes: Range[] }> = [];
    for (const range of nodeRanges) {
      const envelope = adjacentEnvelope(currentHtml, range), last = groups.at(-1);
      if (last && envelope.start <= last.end) { last.end = Math.max(last.end, envelope.end); last.nodes.push(range); }
      else groups.push({ ...envelope, nodes: [range] });
    }
    for (const group of groups) {
      if (!outside(group.start)) { available = false; break; }
      const originalWhitespaceStart = originalOffset;
      while (originalOffset < originalHtml.length && whitespace(originalHtml[originalOffset]!)) originalOffset++;
      const originalWhitespaceEnd = originalOffset;
      let matched = originalWhitespaceStart, nodeIndex = 0;
      for (let offset = group.start; offset < group.end;) {
        const node = group.nodes[nodeIndex];
        if (node && offset === node.start) { mappedNodes.push({ ...node, originalInsertionOffset: matched }); offset = node.end; nodeIndex++; continue; }
        if (!whitespace(currentHtml[offset]!)) throw Error("unmapped-non-whitespace");
        if (matched < originalWhitespaceEnd && currentHtml[offset] === originalHtml[matched]) {
          appendMap(map, { start: matched, end: matched + 1 }, { start: offset, end: offset + 1 }); matched++;
        } else appendRange(whitespaceRanges, offset, offset + 1, matched);
        offset++;
      }
      if (matched !== originalWhitespaceEnd) { available = false; gaps.push({ code: "original-adjacent-whitespace-changed", role: "comparison", offset: group.start }); break; }
      currentOffset = group.end;
    }
    if (available && (!outside(currentHtml.length) || originalOffset !== originalHtml.length)) {
      available = false;
      if (!firstDifference) { firstDifference = { originalOffset, currentOffset }; gaps.push({ code: "original-source-tail-missing", role: "comparison", offset: originalOffset }); }
    }
  } catch (error) { available = false; gaps.push({ code: error instanceof Error ? error.message : "comparison-unavailable", role: "comparison" }); }
  const reconstructed = available ? map.map(segment => currentHtml.slice(segment.current.start, segment.current.end)).join("") : null;
  const literalEqual = reconstructed === null ? null : reconstructed === originalHtml;
  const utf8Equal = literalEqual === null ? null : literalEqual && utf8(reconstructed!).byteLength === original.encoding.byteLength;
  return { schemaVersion: "html-complete-source-comparison-v1" as const, offsetUnit: "utf16" as const,
    original: { characters: originalHtml.length, ...original.encoding, parseErrorCount: original.inventory.parseErrorCount, parserLeadingBomCharacters: original.parserOffset },
    current: { characters: currentHtml.length, ...current.encoding, parseErrorCount: current.inventory.parseErrorCount, parserLeadingBomCharacters: current.parserOffset },
    additionalCards, sourceSequences, reconstruction: { available, literalEqual, utf8Equal, firstDifference },
    nodeErasureRanges: available ? mappedNodes : [], whitespaceErasureRanges: available ? whitespaceRanges : [], sourceMap: available ? map : [], gaps,
    limitations: ["Only complete supplied strings were compared; no Storage readback, byte receipt or physical custody was established.",
      "Additional node and whitespace ranges are observations, never modification permission or protected-contract changes.",
      "Literal equality after explicit erasure does not establish preserved runtime behavior, semantics, rendering or visual layout.",
      "All new content and its interactions with original scripts/styles/controls require independent runtime, semantic and visual evidence.",
      "Inert parsing, finite safety checks and a source map are not whole-protection authority, signing, Hidden settlement or Gate F acceptance."] };
}
export type HtmlCompleteSourceRetentionComparison = ReturnType<typeof compareHtmlCompleteSourceRetention>;
