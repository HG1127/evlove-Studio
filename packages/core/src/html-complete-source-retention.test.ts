import { describe, expect, it } from "vitest";
import { compareHtmlCompleteSourceRetention } from "./html-complete-source-retention";

const card = (id: string, body = "Additional explanation") => `<article class="slide-card" id="${id}"><h2>Title ${id}</h2><p>${body}</p></article>`;
const original = '\uFEFF<!doctype html>\r\n<html lang="en"><head><meta charset="UTF-8"><title>Original title</title><!-- head comment -->'
  + '<style id="original-style">.slide-card{display:block} pre{white-space:pre}</style>'
  + '<script id="original-script">const preserved="<article class=slide-card id=fake>not markup</article>";</script></head>'
  + '<body data-owner="original"><header id="header">Outside original content Ω 😀</header><input id="search" type="text">'
  + '<button id="old-button" onclick="void 0">Old control</button><a id="old-link" href="#old">Old reference</a>'
  + '\r\n' + card("old", "Original method &amp; exact wording") + '\r\n'
  + '<template id="inert"><div data-note="retained">Inert original text</div></template>'
  + '<noscript><p>Original fallback text</p></noscript><pre id="spacing">  Original\n\tspacing  </pre>'
  + '<footer id="footer">Outside footer text</footer></body></html><!-- exact tail -->\r\n';
const add = (html: string, addition: string) => html.replace('</body>', addition + '</body>');
const compare = (currentHtml: string, originalHtml = original) => compareHtmlCompleteSourceRetention({ originalHtml, currentHtml });
function reconstruct(current: string, result: ReturnType<typeof compare>) {
  const ranges = [...result.nodeErasureRanges, ...result.whitespaceErasureRanges].sort((a, b) => a.start - b.start);
  let offset = 0, text = "";
  for (const range of ranges) { expect(range.start).toBeGreaterThanOrEqual(offset); text += current.slice(offset, range.start); offset = range.end; }
  return text + current.slice(offset);
}
function checkCompleteMap(current: string, result: ReturnType<typeof compare>, expected = original) {
  const rebuilt = reconstruct(current, result);
  expect(rebuilt).toBe(expected);
  expect(new TextEncoder().encode(rebuilt)).toEqual(new TextEncoder().encode(expected));
  expect(result.sourceMap.map(segment => current.slice(segment.current.start, segment.current.end)).join("")).toBe(expected);
  expect(result.sourceMap.map(segment => expected.slice(segment.original.start, segment.original.end)).join("")).toBe(expected);
  for (const segment of result.sourceMap) expect(current.slice(segment.current.start, segment.current.end)).toBe(expected.slice(segment.original.start, segment.original.end));
  for (const range of [...result.nodeErasureRanges, ...result.whitespaceErasureRanges]) {
    expect(range.originalInsertionOffset).toBeGreaterThanOrEqual(0);
    expect(range.originalInsertionOffset).toBeLessThanOrEqual(expected.length);
  }
  expect(result.original.byteLength).toBe(new TextEncoder().encode(expected).byteLength);
  for (const range of result.whitespaceErasureRanges) expect(current.slice(range.start, range.end)).toMatch(/^[\t\n\f\r ]+$/);
}

describe("complete supplied HTML source retention facts", () => {
  it("reconstructs every Original character, including BOM, CRLF, head/body, comments, styles/scripts, attrs, references, inert text and tail", () => {
    const current = add(original, card("new"));
    const result = compare(current);
    expect(result.gaps).toEqual([]);
    expect(result.reconstruction).toMatchObject({ available: true, literalEqual: true, utf8Equal: true });
    expect(result.additionalCards).toHaveLength(1);
    expect(result.additionalCards[0]).toMatchObject({ id: "new", closed: true, uniqueId: true });
    expect(current.slice(result.nodeErasureRanges[0]!.start, result.nodeErasureRanges[0]!.end)).toBe(card("new"));
    checkCompleteMap(current, result);
  });
  it("maps only added adjacent whitespace while retaining original significant whitespace exactly", () => {
    const current = original.replace('<footer', '\n  ' + card("new") + '\r\n\t<footer');
    const result = compare(current);
    expect(result.reconstruction.utf8Equal).toBe(true);
    expect(result.whitespaceErasureRanges.length).toBeGreaterThan(0);
    checkCompleteMap(current, result);
  });
  it("retains the original adjacent whitespace through multiple parsed additions", () => {
    const current = original.replace('<template', '\n' + card("new-one") + '\r\n' + card("new-two") + '\t<template');
    const result = compare(current);
    expect(result.reconstruction.utf8Equal).toBe(true);
    expect(result.nodeErasureRanges).toHaveLength(2);
    checkCompleteMap(current, result);
  });
  it("compares complete synthetic 111-card source with three additional cards", () => {
    const full = '<!doctype html><html><head><title>Full synthetic input</title></head><body><!-- outside -->'
      + Array.from({ length: 111 }, (_, index) => card('old-' + index, 'Original full content ' + index)).join('\n') + '</body></html><!-- tail -->';
    const current = add(full, '\n' + card("new-one") + '\n' + card("new-two") + '\n' + card("new-three") + '\n');
    const result = compare(current, full);
    expect(result.reconstruction.utf8Equal).toBe(true);
    expect(result.additionalCards).toHaveLength(3);
    checkCompleteMap(current, result, full);
  });
  it("still parses equal complete inputs and reports only comparison facts", () => {
    const result = compare(original);
    expect(result.reconstruction.utf8Equal).toBe(true);
    expect(result.nodeErasureRanges).toEqual([]);
    for (const field of ["passed", "authorized", "complete", "verificationStatus", "wholeProtectionPassed", "proof", "originalHtml", "currentHtml"]) expect(result).not.toHaveProperty(field);
    expect(result.limitations.join(" ")).toMatch(/runtime.*semantics.*visual|runtime.*semantic.*visual/);
    checkCompleteMap(original, result);
  });
  it.each([
    ["head text", (value: string) => value.replace("Original title", "Changed title")],
    ["body attribute", (value: string) => value.replace('data-owner="original"', 'data-owner="changed"')],
    ["Original card text", (value: string) => value.replace("Original method &amp; exact wording", "Changed method")],
    ["Original card title", (value: string) => value.replace("Title old", "Changed card title")],
    ["outside content", (value: string) => value.replace("Outside footer text", "Changed footer")],
    ["comment", (value: string) => value.replace("head comment", "changed comment")],
    ["style", (value: string) => value.replace("display:block", "display:none")],
    ["script", (value: string) => value.replace('const preserved=', 'const changed=')],
    ["reference", (value: string) => value.replace('href="#old"', 'href="#other"')],
    ["handler", (value: string) => value.replace('onclick="void 0"', 'onclick="void 1"')],
    ["inert text", (value: string) => value.replace("Inert original text", "Changed inert text")],
    ["significant whitespace", (value: string) => value.replace("  Original\n\tspacing  ", "Original spacing")],
    ["tail", (value: string) => value.replace("exact tail", "changed tail")],
    ["BOM", (value: string) => value.slice(1)],
  ] as const)("retains %s differences outside additions", (_name, mutate) => {
    const result = compare(add(mutate(original), card("new")));
    expect(result.reconstruction.available).toBe(false);
    expect(result.nodeErasureRanges).toEqual([]);
    expect(result.gaps.length).toBeGreaterThan(0);
  });
  it("does not normalize modified original whitespace beside a new card", () => {
    const before = '<!doctype html><html><head><title>Whitespace</title></head><body>Original\r\n</body></html>';
    const current = before.replace('\r\n</body>', '\n' + card("new") + '</body>');
    const result = compare(current, before);
    expect(result.reconstruction.available).toBe(false);
    expect(result.gaps.some(gap => gap.code === "original-adjacent-whitespace-changed")).toBe(true);
  });
  it.each(["<!-- " + card("fake") + " -->", '<script type="application/json">' + JSON.stringify(card("fake")) + '</script>'])("never erases card-like text that is not an actual parsed card", addition => {
    const result = compare(add(original, addition));
    expect(result.additionalCards).toEqual([]);
    expect(result.reconstruction.available).toBe(false);
  });
  it.each([
    card("new", '<script src="https://example.invalid/x.js"></script>'),
    card("new", '<style>.slide-card{display:none}</style>'),
    card("new", '<link rel="stylesheet" href="https://example.invalid/x.css">'),
    card("new", '<button onclick="void 0">new control</button>'),
    card("new", '<img src="https://example.invalid/image.png">'),
    card("new", '<input name="search">'),
    card("document"),
  ])("retains active, resource and named-property differences within additional nodes", addition => {
    const result = compare(add(original, addition));
    expect(result.reconstruction.available).toBe(false);
    expect(result.additionalCards.some(item => item.hazards.length > 0)).toBe(true);
    expect(result.nodeErasureRanges).toEqual([]);
  });
  it.each([card("old"), card("search"), card("new") + card("new")])("refuses duplicate or clobbering element identities", addition => {
    const result = compare(add(original, addition));
    expect(result.reconstruction.available).toBe(false);
    expect(result.gaps.some(gap => gap.code === "duplicate-element-id")).toBe(true);
  });
  it("refuses removed Original cards and nested overlapping additional ranges", () => {
    expect(compare(original.replace(card("old", "Original method &amp; exact wording"), "")).gaps.some(gap => gap.code === "original-card-missing")).toBe(true);
    const overlap = compare(add(original, card("outer", card("inner"))));
    expect(overlap.additionalCards).toHaveLength(2);
    expect(overlap.reconstruction.available).toBe(false);
    expect(overlap.gaps.some(gap => gap.code === "overlapping-additional-cards")).toBe(true);
  });
  it("does not erase unclosed or inert new cards", () => {
    for (const current of [add(original, '<article class="slide-card" id="new"><p>not explicitly closed</p>'), original.replace('</template>', card("new") + '</template>')]) {
      const result = compare(current);
      expect(result.reconstruction.available).toBe(false);
      expect(result.additionalCards.some(item => !item.closed || item.inertContext)).toBe(true);
    }
  });
  it.each(['<html><body>implicit document</body></html>', '<!doctype html><html><head><title>implicit tbody</title></head><body><table><tr><td>x</td></tr></table></body></html>'])("retains parser/implicit uncertainty even for equal strings", value => {
    const result = compare(value, value);
    expect(result.reconstruction.available).toBe(false);
    expect(result.gaps.some(gap => gap.code.startsWith("implicit") || gap.code === "parser-errors")).toBe(true);
  });
  it("does not replace invalid UTF-16 with U+FFFD to claim UTF-8 equality", () => {
    const value = original.replace("Outside footer text", "bad surrogate \ud800");
    const result = compare(value, value);
    expect(result.original.byteLength).toBeNull();
    expect(result.reconstruction.available).toBe(false);
    expect(result.gaps.some(gap => gap.code === "non-scalar-utf16")).toBe(true);
  });
  it("rejects claimed permissions, hashes or caller-selected erasure ranges", () => {
    for (const extra of [{ authorized: true }, { sha256: "a".repeat(64) }, { erasureRanges: [{ start: 0, end: original.length }] }]) {
      expect(() => compareHtmlCompleteSourceRetention({ originalHtml: original, currentHtml: original, ...extra } as Parameters<typeof compareHtmlCompleteSourceRetention>[0])).toThrow(/only comparison inputs/);
    }
  });
});
