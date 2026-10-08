// @vitest-environment node
import { describe, expect, it } from "vitest";
import { htmlCandidateProtection, requiresHtmlProtectionBaseline } from "./html-candidate-protection";

const html = (body: string) => "<html><body>" + body + "</body></html>";
const section = '<article id="slide-51"><h2>Git &amp; 命令</h2><p>原有步骤</p></article>';
const report = (originalHtml: string, candidateHtml: string, protectedItems = ["保留 slide-51 原有标题、内容与结构"]) =>
  htmlCandidateProtection({ sourceArtifactId: "source", originalHtml, candidateHtml, protectedItems });

describe("pure complete HTML Candidate protection", () => {
  it("works without a browser DOMParser and preserves additive nodes", () => {
    expect(typeof globalThis.DOMParser).toBe("undefined");
    const result = report(html(section), html(section.replace("</article>", "<p>新增操作示例</p></article>")));
    expect(result.issues).toEqual([]);
    expect(result.protectedSections[0]).toMatchObject({ id: "slide-51", textRetained: true, titleRetained: true, structureRetained: true });
  });
  it("parses unquoted attributes and equivalent entity-encoded IDs/text", () => {
    const original = '<ARTICLE id=slide-51><h2>Git &amp; 命令</h2><p>原有步骤</p></ARTICLE>';
    const changed = '<article id="slide&#45;51"><h2>Git &#38; 命令</h2><p>原有步骤</p><p>新增</p></article>';
    expect(report(html(original), html(changed)).issues).toEqual([]);
  });
  it.each(["comments", "script", "template"])("does not mistake %s markup for retained original slides", (kind) => {
    const original = html('<article id=slide-51 class=slide-card>正文</article>');
    const fake = kind === "comments" ? '<!--<article id=slide-51 class=slide-card>正文</article>-->'
      : kind === "script" ? '<script>const markup = "<article id=slide-51 class=slide-card>正文</article>";</script>'
      : '<template><article id=slide-51 class=slide-card>正文</article></template>';
    expect(report(original, html(fake), ["保留 slide 章节结构"]).missingSlideIds).toEqual(["slide-51"]);
  });
  it("neither executes scripts nor fetches resources", () => {
    const markup = html(section + '<script>throw new Error("executed")</script><img src="https://invalid.example/a">');
    expect(report(markup, markup).issues).toEqual([]);
  });
  it("allows inherited duplicates, but rejects any increased duplicate count", () => {
    const original = html(section + section);
    expect(report(original, original).newDuplicateIds).toEqual([]);
    expect(report(original, html(section + section + section)).newDuplicateIds).toEqual(["slide-51"]);
  });
  it("rejects a protected root-tag replacement as structure loss", () => {
    const changed = section.replace(/article/g, "section");
    expect(report(html(section), html(changed)).protectedSections[0]!.structureRetained).toBe(false);
  });
  it("requires a baseline only for explicit supported protection scopes", () => {
    expect(requiresHtmlProtectionBaseline(["保护 slide-51/52"])).toBe(true);
    expect(requiresHtmlProtectionBaseline(["保留 83 个 slide 章节结构"])).toBe(true);
    expect(requiresHtmlProtectionBaseline(["保持既有品牌语气"])).toBe(false);
  });
  it("keeps missing original scopes unresolved rather than claiming observed failure", () => {
    const result = report(html(section), html(section), ["保护 slide-99"]);
    expect(result.protectedSections).toEqual([]);
    expect(result.unresolvedProtectedIds).toEqual(["slide-99"]);
    expect(result.issues).toEqual([]);
  });
  it("allows changes to unprotected slide content under ID-only structural protection", () => {
    const original = html('<article id=slide-51 class=slide-card>旧正文</article>');
    expect(report(original, original.replace("旧正文", "新正文"), ["保留 slide 章节结构"]).issues).toEqual([]);
  });
});
