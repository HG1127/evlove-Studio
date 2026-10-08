import { parse, type DefaultTreeAdapterTypes } from "parse5";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const preservesSequence = (before: string[], after: string[]) => {
  let index = 0;
  for (const token of after) if (token === before[index]) index++;
  return index === before.length;
};
const protectsSlideStructure = (items: string[]) => items.some((item) =>
  /slide.{0,16}(?:章节|结构|页面|页数|card)|(?:章节|结构|页面|页数).{0,16}slide/i.test(item));
function protectedSlideIds(items: string[]) {
  const ids = new Set<string>();
  for (const item of items) for (const match of item.matchAll(/\bslide-(\d+)((?:\/\d+)*)/gi)) {
    ids.add("slide-" + match[1]);
    for (const suffix of match[2].split("/").filter(Boolean)) ids.add("slide-" + suffix);
  }
  return [...ids];
}

/** Generic prose remains an independent assessment; only explicit HTML scopes are deterministic. */
export function requiresHtmlProtectionBaseline(items: string[]) {
  return protectsSlideStructure(items) || protectedSlideIds(items).length > 0;
}

/** A pure HTML5 tree walk: no browser, script evaluation, network or serialized-file rewrite. */
function descendants(root: Node) {
  const result: Node[] = [];
  const pending: Node[] = "childNodes" in root ? [...root.childNodes].reverse() : [];
  while (pending.length) {
    const node = pending.pop()!;
    result.push(node);
    if ("childNodes" in node) for (let index = node.childNodes.length - 1; index >= 0; index--) pending.push(node.childNodes[index]!);
  }
  return result;
}
const elements = (nodes: Node[]) => nodes.filter((node): node is Element => "tagName" in node);
const attribute = (node: Element, name: string) => node.attrs.find((attr) => attr.name === name)?.value;
const textNodes = (nodes: Node[]) => nodes.flatMap((node) =>
  node.nodeName === "#text" && "value" in node && normalize(node.value) ? [normalize(node.value)] : []);
const textContent = (nodes: Node[]) => nodes.flatMap((node) =>
  node.nodeName === "#text" && "value" in node ? [node.value] : []).join("");
const slideCardIds = (nodes: Element[]) => nodes.flatMap((node) => {
  const id = attribute(node, "id");
  return node.tagName === "article" && id && attribute(node, "class")?.split(/\s+/).includes("slide-card") ? [id] : [];
});
function ids(nodes: Element[]) {
  const counts = new Map<string, number>();
  const first = new Map<string, Element>();
  for (const node of nodes) {
    const id = attribute(node, "id");
    if (id === undefined) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!first.has(id)) first.set(id, node);
  }
  return { counts, first };
}

/** Both inputs must be complete files. Never use a parsed excerpt as protection evidence. */
export function htmlCandidateProtection(input: {
  sourceArtifactId: string; originalHtml: string; candidateHtml: string; protectedItems: string[];
}) {
  const original = elements(descendants(parse(input.originalHtml, { scriptingEnabled: false })));
  const candidate = elements(descendants(parse(input.candidateHtml, { scriptingEnabled: false })));
  const originalIds = ids(original), candidateIds = ids(candidate);
  const newDuplicateIds = [...candidateIds.counts].filter(([id, count]) =>
    count > 1 && count > (originalIds.counts.get(id) ?? 1)).map(([id]) => id);
  // Actual file identities are authoritative when inferred protection prose guesses a count.
  const originalSlideIds = protectsSlideStructure(input.protectedItems) ? slideCardIds(original) : [];
  const candidateSlideIds = new Set(slideCardIds(candidate));
  const missingSlideIds = [...new Set(originalSlideIds)].filter((id) => !candidateSlideIds.has(id));
  const protectedIds = protectedSlideIds(input.protectedItems);
  const protectedSections = protectedIds.flatMap((id) => {
    const before = originalIds.first.get(id);
    if (!before) return [];
    const after = candidateIds.first.get(id);
    const beforeNodes = descendants(before), afterNodes = after ? descendants(after) : [];
    const title = (nodes: Node[]) => {
      const heading = elements(nodes).find((node) => /^h[1-6]$/.test(node.tagName));
      return heading ? normalize(textContent(descendants(heading))) : "";
    };
    return [{
      id, originalFound: true, candidateFound: Boolean(after),
      textRetained: Boolean(after) && preservesSequence(textNodes(beforeNodes), textNodes(afterNodes)),
      structureRetained: Boolean(after) && before.tagName === after!.tagName && preservesSequence(elements(beforeNodes).map((node) => node.tagName), elements(afterNodes).map((node) => node.tagName)),
      titleRetained: Boolean(after) && title(beforeNodes) === title(afterNodes),
      originalCharacters: normalize(textContent(beforeNodes)).length,
      candidateCharacters: normalize(textContent(afterNodes)).length,
    }];
  });
  const unresolvedProtectedIds = protectedIds.filter((id) => !originalIds.first.has(id));
  const issues = [
    ...newDuplicateIds.map((id) => "新增重复 ID: " + id),
    ...(missingSlideIds.length ? ["保护的原始 slide-card 缺失 " + missingSlideIds.length + "/" + originalSlideIds.length + "：" + missingSlideIds.slice(0, 6).join("、")] : []),
    ...protectedSections.filter((section) => !section.textRetained || !section.structureRetained || !section.titleRetained)
      .map((section) => "保护章节 " + section.id + " 的原内容、标题或结构未完整保留"),
  ];
  return { sourceArtifactId: input.sourceArtifactId, readWholeFiles: true, newDuplicateIds, protectedSections, unresolvedProtectedIds, originalSlideCount: originalSlideIds.length, missingSlideIds, issues };
}
