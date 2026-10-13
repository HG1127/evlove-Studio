import { parse, type DefaultTreeAdapterTypes } from "parse5";
import type { HtmlProtectionObligation } from "@evolution/contracts";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type Frame = { node: Node; path: string; inertContext: boolean; excludedText: boolean };
export type HtmlProtectionSourceRange = { start: number; end: number };
export type HtmlProtectionAttributeFact = { name: string; namespace: string; value: string; literal: string | null };
export type HtmlProtectionElementFact = { path: string; tag: string; namespace: string; inertContext: boolean; attributes: HtmlProtectionAttributeFact[] };
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const javascriptTypes = new Set(["application/ecmascript", "application/javascript", "application/x-ecmascript", "application/x-javascript",
  "text/ecmascript", "text/javascript", "text/javascript1.0", "text/javascript1.1", "text/javascript1.2", "text/javascript1.3",
  "text/javascript1.4", "text/javascript1.5", "text/jscript", "text/livescript", "text/x-ecmascript", "text/x-javascript"]);
const referenceAttributes = new Set(["src", "href", "srcset", "poster", "data", "action", "formaction"]);
const nativeControls = new Set(["button", "input", "select", "textarea", "details", "summary", "form", "audio", "video"]);
const getAttribute = (node: Element, name: string) => node.attrs.find((attribute) => attribute.name === name)?.value;
const asciiLower = (value: string) => value.replace(/[A-Z]/g, (character) => character.toLowerCase());
const asciiTrim = (value: string) => value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
function sourceRange(node: Element): HtmlProtectionSourceRange | null {
  const location = node.sourceCodeLocation;
  if (!location) return null;
  // parse5 can leave an EOF raw-text element ending at its opening tag.
  const end = node.childNodes.reduce((offset, child) => Math.max(offset, "sourceCodeLocation" in child ? child.sourceCodeLocation?.endOffset ?? 0 : 0), location.endOffset);
  return { start: location.startOffset, end };
}
function attributes(node: Element, html: string): HtmlProtectionAttributeFact[] {
  return node.attrs.map((attribute) => {
    const name = attribute.prefix ? attribute.prefix + ":" + attribute.name : attribute.name;
    const location = node.sourceCodeLocation?.attrs?.[name];
    return { name, namespace: attribute.namespace ?? "", value: attribute.value,
      literal: location ? html.slice(location.startOffset, location.endOffset) : null };
  });
}
/** Source offsets are UTF-16 offsets in the caller's complete decoded string, not byte hashes. */
function literal(node: Element, html: string) {
  const range = sourceRange(node);
  return { range, literal: range ? html.slice(range.start, range.end) : null };
}
function blockLiteral(node: Element, html: string) {
  const location = node.sourceCodeLocation;
  return { ...literal(node, html), bodyLiteral: location?.startTag
    ? html.slice(location.startTag.endOffset, location.endTag?.startOffset ?? sourceRange(node)!.end) : null,
    hasClosingTag: Boolean(location?.endTag) };
}
function frames(root: Node, initialInert = false): Frame[] {
  const result: Frame[] = [], pending: Frame[] = [{ node: root, path: "0", inertContext: initialInert, excludedText: false }];
  while (pending.length) {
    if (result.length >= 250_000) throw new Error("HTML inventory exceeds the complete node limit");
    const entry = pending.pop()!, node = entry.node;
    const isElement = "tagName" in node;
    const inertContext = entry.inertContext || (isElement && (node.tagName === "template" || node.tagName === "noscript"));
    const excludedText = entry.excludedText || (isElement && (node.tagName === "script" || node.tagName === "style"));
    result.push({ ...entry, inertContext, excludedText });
    const children: Node[] = "childNodes" in node ? node.childNodes : [];
    let elementIndex = children.filter((child) => "tagName" in child).length;
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index]!;
      const childPath = "tagName" in child ? entry.path + "/" + (--elementIndex) : entry.path + "/text-" + index;
      pending.push({ node: child, path: childPath, inertContext, excludedText });
    }
    if (isElement && node.tagName === "template" && "content" in node) {
      const templateChildren = (node as DefaultTreeAdapterTypes.Template).content.childNodes;
      for (let index = templateChildren.length - 1; index >= 0; index--) {
        pending.push({ node: templateChildren[index]!, path: entry.path + "/template/" + index, inertContext: true, excludedText });
      }
    }
  }
  return result;
}
const elementFrames = (entries: Frame[]) => entries.filter((entry): entry is Frame & { node: Element } => "tagName" in entry.node);
const text = (entries: Frame[]) => entries.flatMap((entry) => entry.node.nodeName === "#text" && "value" in entry.node && !entry.excludedText ? [entry.node.value] : []).join("");
function elementFact(entry: Frame & { node: Element }, html: string): HtmlProtectionElementFact {
  return { path: entry.path, tag: entry.node.tagName, namespace: entry.node.namespaceURI, inertContext: entry.inertContext, attributes: attributes(entry.node, html) };
}
function classifyScript(node: Element, inertContext: boolean) {
  if (inertContext) return "inert" as const;
  if (node.namespaceURI !== HTML_NAMESPACE) return "foreign" as const;
  const type = getAttribute(node, "type");
  const language = getAttribute(node, "language");
  const value = type === "" || (type === undefined && !language) ? "text/javascript" : type ?? "text/" + language;
  const lower = asciiLower(value);
  // https://html.spec.whatwg.org/multipage/scripting.html#prepare-the-script-element
  // HTML script preparation matches essence strings, not MIME parameters.
  // module/importmap/speculationrules do not trim surrounding whitespace.
  if (javascriptTypes.has(lower) || (type !== undefined && javascriptTypes.has(asciiLower(asciiTrim(type))))) return "classic" as const;
  if (lower === "module" || lower === "importmap" || lower === "speculationrules") return lower;
  return "data" as const;
}

/**
 * Static complete-source facts only. No JS, CSS, network or browser evaluation.
 * Runtime obligations are deliberately unresolved; this inventory is not a
 * complete semantic/visual protection contract and never returns a PASS.
 */
export function htmlProtectionInventory(args: { sourceArtifactId: string; html: string }) {
  if (!args.sourceArtifactId || args.sourceArtifactId.length > 512) throw new Error("Invalid source artifact identity");
  if (!args.html || args.html.length > 20 * 1024 * 1024) throw new Error("HTML inventory requires a complete bounded source string");
  const html = args.html, parseErrors: string[] = [];
  let parseErrorCount = 0;
  const document = parse(html, { scriptingEnabled: false, sourceCodeLocationInfo: true,
    onParseError: (error) => { parseErrorCount++; if (parseErrors.length < 64) parseErrors.push(error.code); } });
  const entries = elementFrames(frames(document));
  const ids = new Map<string, number>();
  for (const { node } of entries) {
    const id = getAttribute(node, "id");
    if (id !== undefined) ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  let cardNodeVisits = 0;
  const cards = entries.filter(({ node }) => node.tagName === "article" && node.namespaceURI === HTML_NAMESPACE
    && getAttribute(node, "class")?.split(/[\t\n\f\r ]+/).includes("slide-card")).map((entry, index) => {
    const cardFrames = frames(entry.node, entry.inertContext), elements = elementFrames(cardFrames);
    cardNodeVisits += cardFrames.length;
    if (cardNodeVisits > 250_000) throw new Error("HTML inventory exceeds the complete card-node limit");
    const heading = elements.find(({ node, inertContext }) => inertContext === entry.inertContext && /^h[1-6]$/.test(node.tagName))?.node;
    return { index, id: getAttribute(entry.node, "id") ?? null, path: entry.path, inertContext: entry.inertContext,
      text: text(cardFrames), nonInertText: text(cardFrames.filter((frame) => !frame.inertContext)), title: heading ? text(frames(heading)) : "",
      structure: elements.map((element) => ({ path: element.path, tag: element.node.tagName, namespace: element.node.namespaceURI, inertContext: element.inertContext })),
      attributes: elements.map((element) => elementFact(element, html)), ...literal(entry.node, html) };
  });
  if (cards.length > 5000) throw new Error("HTML inventory exceeds the complete card limit");
  const styles = entries.filter(({ node }) => node.tagName === "style").map((entry, index) => ({
    index, path: entry.path, inertContext: entry.inertContext, attributes: attributes(entry.node, html), ...blockLiteral(entry.node, html) }));
  const scripts = entries.filter(({ node }) => node.tagName === "script").map((entry, index) => {
    const kind = classifyScript(entry.node, entry.inertContext), block = blockLiteral(entry.node, html);
    const intrinsicKind = classifyScript(entry.node, false);
    const activationUnresolved = entry.inertContext && ["classic", "module", "foreign", "importmap", "speculationrules"].includes(intrinsicKind);
    const type = getAttribute(entry.node, "type") ?? "", essence = asciiLower(asciiTrim(type)).split(";")[0]!;
    const json = kind === "importmap" || kind === "speculationrules" || essence === "application/json" || essence === "text/json" || essence.endsWith("+json");
    let jsonValid: boolean | null = null;
    if (json && block.bodyLiteral !== null) { try { JSON.parse(block.bodyLiteral); jsonValid = true; } catch { jsonValid = false; } }
    return { index, path: entry.path, kind, intrinsicKind, activationUnresolved, type, src: getAttribute(entry.node, "src") ?? null,
      inertContext: entry.inertContext, nomodule: getAttribute(entry.node, "nomodule") !== undefined,
      potentialExecutable: ["classic", "module", "foreign"].includes(kind),
      runtimeConfiguration: kind === "importmap" || kind === "speculationrules", jsonValid,
      attributes: attributes(entry.node, html), ...block };
  });
  const references = entries.flatMap((entry) => attributes(entry.node, html).filter((attribute) => referenceAttributes.has(attribute.name) || attribute.name === "xlink:href")
    .map((attribute) => ({ path: entry.path, tag: entry.node.tagName, elementId: getAttribute(entry.node, "id") ?? null, inertContext: entry.inertContext, ...attribute })));
  const handlers = entries.flatMap((entry) => attributes(entry.node, html).filter((attribute) => /^on[a-z]+$/.test(attribute.name))
    .map((attribute) => ({ path: entry.path, tag: entry.node.tagName, elementId: getAttribute(entry.node, "id") ?? null, inertContext: entry.inertContext, ...attribute })));
  const runtimeObligations: HtmlProtectionObligation[] = [];
  function unknown(id: string, target: string, description: string) {
    runtimeObligations.push({ id, sourceArtifactId: args.sourceArtifactId, kind: "unknown-runtime", target, description, evidenceKind: "browser", support: "unresolved" });
  }
  for (const script of scripts) if (script.potentialExecutable || script.runtimeConfiguration || script.activationUnresolved) {
    unknown("runtime-script:" + script.index, "script[" + script.index + "]", "Script behavior or runtime configuration is not understood by static HTML scanning");
  }
  for (const [index, handler] of handlers.entries()) unknown("runtime-handler:" + index, handler.path + "@" + handler.name,
    "Inline event handler needs independently specified execution and state observations");
  for (const [index, reference] of references.entries()) if (asciiLower(reference.value.replace(/[\t\n\r]/g, "")).trimStart().startsWith("javascript:")) {
    unknown("runtime-url:" + index, reference.path + "@" + reference.name, "JavaScript URL behavior has not been evaluated");
  }
  for (const [index, entry] of entries.entries()) {
    if (nativeControls.has(entry.node.tagName) || (entry.node.tagName === "a" && getAttribute(entry.node, "href") !== undefined)) {
      unknown("runtime-control:" + index, entry.path, "Native control, navigation or form behavior needs explicit browser observations");
    }
    if (entry.node.tagName === "iframe" || entry.node.tagName === "object" || entry.node.tagName === "embed") {
      unknown("runtime-embedded:" + index, entry.path, "Embedded document or plugin behavior is outside the static inventory");
    }
  }
  const explicitTag = (tag: string) => {
    const node = entries.find((entry) => entry.node.tagName === tag)?.node;
    return { startTag: Boolean(node?.sourceCodeLocation?.startTag), endTag: Boolean(node?.sourceCodeLocation?.endTag) };
  };
  return { schemaVersion: "html-protection-inventory-v1" as const, sourceArtifactId: args.sourceArtifactId, readWholeFile: true as const,
    sourceCharacters: html.length, parseErrors, parseErrorCount,
    explicit: { html: explicitTag("html"), head: explicitTag("head"), body: explicitTag("body") },
    cards, styles, scripts, references, handlers, documentElements: entries.map((entry) => elementFact(entry, html)),
    duplicateIds: [...ids].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count })),
    runtimeObligations,
    limitations: ["Static facts do not prove browser behavior, visual preservation or core method semantics.",
      "Source literals are exact decoded-string slices; byte identity must be checked separately against the actual file receipt.",
      "HTML reference attributes are indexed; CSS URLs, dynamic JS resources and embedded documents are not resolved.",
      "Data/template/noscript classifications describe intrinsic parsing; other executable scripts can subsequently consume or activate their content."] };
}
export type HtmlProtectionInventory = ReturnType<typeof htmlProtectionInventory>;
