import { describe, expect, it } from "vitest";
import { HtmlProtectionObligationSchema } from "@evolution/contracts";
import { htmlProtectionInventory } from "./html-protection-inventory";
import { compareHtmlProtectionFiles } from "./html-protection-file-comparison";

const wrap = (body: string, head = "") => "<!doctype html><html><head>" + head + "</head><body>" + body + "</body></html>";
const card = (id: string, content = "Original method", attributes = "") => '<article class="slide-card" id="' + id + '" ' + attributes + '><h2>Title ' + id + "</h2><div><p>" + content + "</p></div></article>";
const inventory = (html: string) => htmlProtectionInventory({ sourceArtifactId: "source", html });
const compare = (originalHtml: string, currentHtml: string) => compareHtmlProtectionFiles({ sourceArtifactId: "source", originalHtml, currentHtml });

describe("complete inert HTML protection inventory", () => {
  it("indexes every actual card, independently of an inferred prose count", () => {
    const html = wrap(Array.from({ length: 111 }, (_, index) => card("slide-" + (index + 1), "Method " + index)).join(""));
    const result = inventory(html);
    expect(result.cards).toHaveLength(111);
    expect(result.cards[55]!.text).toContain("Method 55");
    expect(result.cards[110]!.title).toBe("Title slide-111");
    expect(result.cards[55]!.structure.map((item) => item.tag)).toEqual(["article", "h2", "div", "p"]);
    expect(result.cards[55]!.attributes[0]!.attributes.find((item) => item.name === "id")?.value).toBe("slide-56");
    expect(result).not.toHaveProperty("pass");
    expect(result).not.toHaveProperty("verificationStatus");
  });
  it("retains complete text and significant whitespace, without CSS/JS becoming document text", () => {
    const html = wrap(card("one", "A &amp; B") + '<article class="slide-card" id="code"><h1>Heading</h1><pre>a  b\n  c</pre><style>secret-css</style><script>secret-js</script></article>');
    const result = inventory(html);
    expect(result.cards[0]!.text).toContain("A & B");
    expect(result.cards[1]!.text).toContain("a  b\n  c");
    expect(result.cards[1]!.text).not.toContain("secret-js");
    expect(result.cards[1]!.text).not.toContain("secret-css");
  });
  it("does not execute user scripts or fetch references", () => {
    delete (globalThis as { htmlInventoryExecuted?: boolean }).htmlInventoryExecuted;
    inventory(wrap('<script>globalThis.htmlInventoryExecuted=true; throw Error("must not run")</script><img src="https://example.invalid/private">'));
    expect((globalThis as { htmlInventoryExecuted?: boolean }).htmlInventoryExecuted).toBeUndefined();
  });
  it("reads script/style literals from source offsets, preserving CRLF and supplementary characters", () => {
    const html = wrap("😀" + card("one"), "<style>\r\na { color: red }\r\n</style><script>\r\nlet a = 1;\r\n</script>");
    const result = inventory(html);
    expect(result.styles[0]!.bodyLiteral).toBe("\r\na { color: red }\r\n");
    expect(result.scripts[0]!.bodyLiteral).toBe("\r\nlet a = 1;\r\n");
    expect(result.cards[0]!.literal).toBe(card("one"));
    expect(result.scripts[0]!.literal).toBe("<script>\r\nlet a = 1;\r\n</script>");
  });
  it.each([
    ["", "classic"], ['type=""', "classic"], ['type=" TEXT/JAVASCRIPT "', "classic"],
    ['type="text/javascript; charset=utf-8"', "data"], ['type="MoDuLe"', "module"], ['type=" module "', "data"],
    ['type="application/json"', "data"], ['type="application/ld+json"', "data"],
    ['type="importmap"', "importmap"], ['type="speculationrules"', "speculationrules"],
    ['language="javascript1.2"', "classic"], ['language="vbscript"', "data"],
  ])("classifies intrinsic script type %s as %s without execution", (attributes, kind) => {
    expect(inventory(wrap("<script " + attributes + ">{}</script>")).scripts[0]!.kind).toBe(kind);
  });
  it("distinguishes JSON data from executable and runtime configuration scripts", () => {
    const result = inventory(wrap('<script type="application/json">{"value":1}</script><script type="application/ld+json">{broken}</script><script type="importmap">{"imports":{}}</script><script src="a.js"></script><script type="module">import "x"</script>'));
    expect(result.scripts.map((item) => item.jsonValid)).toEqual([true, false, true, null, null]);
    expect(result.scripts.map((item) => item.potentialExecutable)).toEqual([false, false, false, true, true]);
    expect(result.runtimeObligations.filter((item) => item.id.startsWith("runtime-script:"))).toHaveLength(3);
  });
  it("indexes inert template/noscript contents without claiming they were rendered", () => {
    const result = inventory(wrap('<template>' + card("inert") + '<script>throw 1</script></template><noscript><script>throw 2</script></noscript>'));
    expect(result.cards[0]!.inertContext).toBe(true);
    expect(result.cards[0]!.text).toContain("Original method");
    expect(result.cards[0]!.nonInertText).toBe("");
    expect(result.cards[0]!.title).toBe("Title inert");
    expect(result.scripts.map((item) => item.kind)).toEqual(["inert", "inert"]);
    expect(result.scripts.every((item) => item.intrinsicKind === "classic" && item.activationUnresolved)).toBe(true);
    expect(result.runtimeObligations.filter((item) => item.id.startsWith("runtime-script:"))).toHaveLength(2);
  });
  it("retains every handler/ref literal and leaves unrelated runtime obligations unresolved", () => {
    const result = inventory(wrap('<a id="link" href="java&#10;script:save()" onclick="save(1)">go</a><button onmouseover="unknown()">x</button><iframe srcdoc="&lt;script&gt;x()&lt;/script&gt;"></iframe><img srcset="a.png 1x, b.png 2x">'));
    expect(result.handlers.map((item) => item.name)).toEqual(["onclick", "onmouseover"]);
    expect(result.references.map((item) => item.name)).toEqual(["href", "srcset"]);
    expect(result.handlers[0]!.literal).toBe('onclick="save(1)"');
    expect(result.runtimeObligations.some((item) => item.id.startsWith("runtime-url:"))).toBe(true);
    expect(result.runtimeObligations.some((item) => item.id.startsWith("runtime-embedded:"))).toBe(true);
    expect(result.runtimeObligations.every((item) => item.support === "unresolved" && item.kind === "unknown-runtime")).toBe(true);
    expect(result.runtimeObligations.every((item) => HtmlProtectionObligationSchema.safeParse(item).success)).toBe(true);
  });
  it("reports parser repair and unterminated blocks rather than synthesizing complete markup", () => {
    const result = inventory("<html><body><script>broken");
    expect(result.parseErrorCount).toBeGreaterThan(0);
    expect(result.explicit.html!.endTag).toBe(false);
    expect(result.scripts[0]!.hasClosingTag).toBe(false);
    expect(result.scripts[0]!.bodyLiteral).toBe("broken");
  });
});

describe("policy-independent HTML protection differences", () => {
  it("compares all original cards while allowing additions to be reported separately", () => {
    const result = compare(wrap(card("one") + card("two")), wrap(card("new", "Authorized addition") + card("one") + card("two")));
    expect(result.cards.every((item) => item.match === "unique-id" && item.textEqual && item.attributesEqual && item.structureEqual)).toBe(true);
    expect(result.addedCardIndexes).toEqual([0]);
    expect(result.originalOrderPreserved).toBe(true);
    expect(result).not.toHaveProperty("pass");
    expect(result).not.toHaveProperty("issues");
  });
  it.each([
    [card("one", "Changed method"), "textEqual"],
    [card("one").replace("Title one", "Changed title"), "titleEqual"],
    [card("one").replace("<div><p>", "<section><p>").replace("</p></div>", "</p></section>"), "structureEqual"],
    [card("one", "Original method", 'data-search="changed"'), "attributesEqual"],
  ])("reports changes beyond retained card identity without deciding permission", (current, field) => {
    const result = compare(wrap(card("one")), wrap(current));
    expect(result.cards[0]!.match).toBe("unique-id");
    expect(result.cards[0]![field as "textEqual"]).toBe(false);
    expect(result).not.toHaveProperty("failed");
  });
  it("does not replace missing/duplicate/unidentified cards with positional guesses", () => {
    const result = compare(wrap(card("one") + card("two") + '<article class="slide-card"><p>No ID</p></article>'), wrap(card("one") + card("one")));
    expect(result.cards.map((item) => item.match)).toEqual(["ambiguous", "missing", "unidentified"]);
    expect(result.cards.every((item) => item.textEqual === null)).toBe(true);
    expect(result.originalOrderPreserved).toBeNull();
    expect(result.current.duplicateIds).toEqual([{ id: "one", count: 2 }]);
  });
  it("retains original order facts and detects reorder separately from additions", () => {
    expect(compare(wrap(card("one") + card("two")), wrap(card("two") + card("one"))).originalOrderPreserved).toBe(false);
  });
  it("does not conflate CRLF normalized text with identical script/style source literals", () => {
    const before = wrap(card("one"), "<style>\r\na{}\r\n</style><script>\r\nx()\r\n</script>");
    const after = before.replaceAll("\r\n", "\n");
    const result = compare(before, after);
    expect(result.styles.bodyLiteralSequenceEqual).toBe(false);
    expect(result.scripts.bodyLiteralSequenceEqual).toBe(false);
    expect(result.cards[0]!.textEqual).toBe(true);
  });
  it("compares whole tags and source sequences, including attributes and ordering", () => {
    const before = wrap('<button id="one" onclick="one()">x</button>', '<style media="screen">a{}</style><style>b{}</style><script src="one.js"></script>');
    const changed = before.replace('media="screen"', 'media="print"').replace("one.js", "two.js").replace("one()", "two()");
    const result = compare(before, changed);
    expect(result.styles.literalSequenceEqual).toBe(false);
    expect(result.styles.bodyLiteralSequenceEqual).toBe(true);
    expect(result.scripts.literalSequenceEqual).toBe(false);
    expect(result.referencesSequenceEqual).toBe(false);
    expect(result.handlersSequenceEqual).toBe(false);
  });
});

it("does not claim a unique card identity when another element duplicates its DOM ID", () => {
  const result = compare(wrap(card("one")), wrap(card("one") + '<div id="one">duplicate outside the card</div>'));
  expect(result.cards[0]!.match).toBe("ambiguous");
  expect(result.cards[0]!.textEqual).toBeNull();
  expect(result.current.duplicateIds).toEqual([{ id: "one", count: 2 }]);
});
