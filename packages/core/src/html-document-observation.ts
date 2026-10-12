import { parse, type DefaultTreeAdapterTypes } from "parse5";

type Node = DefaultTreeAdapterTypes.Node;
type Section = { tag: string; id: string; title: string; textCharacters: number };
const excludedText = new Set(["script", "style"]);
const blockTags = new Set(["article", "section", "div", "p", "li", "pre", "table", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6"]);

/** Complete inert HTML5 indexing. Observations are facts, never an acceptance verdict. */
export function htmlDocumentObservation(html: string) {
  const parseErrors: string[] = [];
  const document = parse(html, { scriptingEnabled: false, sourceCodeLocationInfo: true,
    onParseError: (error) => { if (parseErrors.length < 32) parseErrors.push(error.code); } });
  const counts: Record<string, number> = Object.create(null) as Record<string, number>;
  const ids = new Map<string, number>();
  const sections: Section[] = [];
  const slideIds: string[] = [];
  const text: string[] = [];
  const explicit = { html: false, head: false, body: false, bodyEnd: false, htmlEnd: false };
  const pending: Array<{ node: Node; excluded: boolean; section?: Section; heading: boolean; verbatim: boolean }> = [
    { node: document, excluded: false, heading: false, verbatim: false },
  ];
  let visited = 0;
  while (pending.length) {
    if (++visited > 250_000) throw new Error("HTML node count exceeds the complete observation limit");
    const entry = pending.pop()!;
    const node = entry.node;
    let { excluded, section, heading, verbatim } = entry;
    if ("tagName" in node) {
      const tag = node.tagName;
      counts[tag] = (counts[tag] ?? 0) + 1;
      const id = node.attrs.find((attribute) => attribute.name === "id")?.value;
      if (id !== undefined) ids.set(id, (ids.get(id) ?? 0) + 1);
      if (tag === "article" && node.attrs.find((attribute) => attribute.name === "class")?.value.split(/\s+/).includes("slide-card")) slideIds.push(id ?? "[missing id]");
      if (tag === "html" || tag === "head" || tag === "body") {
        explicit[tag] = Boolean(node.sourceCodeLocation?.startTag);
        if (tag === "body") explicit.bodyEnd = Boolean(node.sourceCodeLocation?.endTag);
        if (tag === "html") explicit.htmlEnd = Boolean(node.sourceCodeLocation?.endTag);
      }
      excluded ||= excludedText.has(tag);
      verbatim ||= tag === "pre" || tag === "code" || tag === "textarea";
      if (!excluded && (tag === "article" || tag === "section") && id) {
        section = { tag, id, title: "", textCharacters: 0 };
        sections.push(section);
        text.push(`\n[${tag}#${id}]\n`);
      } else if (!excluded && blockTags.has(tag)) text.push("\n");
      heading ||= /^h[1-6]$/.test(tag);
    } else if (node.nodeName === "#text" && "value" in node && !excluded) {
      const value = verbatim ? node.value : node.value.replace(/\s+/g, " ");
      if (value) {
        text.push(value);
        if (section) {
          section.textCharacters += value.length;
          if (heading) section.title += value + " ";
        }
      }
    }
    const children: Node[] = "childNodes" in node ? [...node.childNodes] : [];
    // Inert template text is indexed separately, never presented as rendered text.
    if ("tagName" in node && node.tagName === "template" && "content" in node) {
      text.push("\n[inert template content]\n");
      children.push(...(node as DefaultTreeAdapterTypes.Template).content.childNodes);
    }
    for (let index = children.length - 1; index >= 0; index--) pending.push({ node: children[index]!, excluded, section, heading, verbatim });
  }
  const placeholders = [...html.matchAll(/\bTODO\b|\bFIXME\b|保持原有其余内容不变|\[\.\.\.truncated by Evolve Studio\.\.\.\]/gi)];
  const structure = {
    schemaVersion: "html-document-observation-v1", readWholeFile: true,
    sourceCharacters: html.length, explicit, parseErrors,
    elementCounts: counts, slideCardCount: slideIds.length, slideIds,
    duplicateIds: [...ids].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count })),
    sections: sections.map((section) => ({ ...section, title: section.title.trim() })),
    placeholderOccurrenceCount: placeholders.length,
    placeholderOccurrences: placeholders.slice(0, 32).map((match) => ({ offset: match.index, token: match[0] })),
    limitations: ["Static HTML5 tree and text only; no scripts, styles, visual rendering or browser interaction were executed.", "Placeholder occurrences are observations; quoted tutorial examples are not automatically product defects."],
  };
  return { structure, documentText: text.join("") };
}
