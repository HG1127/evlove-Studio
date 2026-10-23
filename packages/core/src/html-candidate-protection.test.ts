// @vitest-environment node
import { describe, expect, it } from "vitest";
import { htmlCandidateProtection, requiresHtmlProtectionBaseline } from "./html-candidate-protection";

const html = (body: string) => "<html><body>" + body + "</body></html>";
const section = '<article id="slide-51"><h2>Git &amp; 命令</h2><p>原有步骤</p></article>';
const report = (originalHtml: string, candidateHtml: string, protectedItems = ["保留 slide-51 原有标题、内容与结构"]) =>
  htmlCandidateProtection({ sourceArtifactId: "source", originalHtml, candidateHtml, protectedItems });

describe("pure complete HTML Candidate protection", () => {
  it("observes static preservation when only document wording changes, without making a runtime verdict",()=>{
    const original='<html><head><style>p{color:red}</style><script>const label="same";</script></head><body><article class="slide-card" id="slide-1"><p>old wording</p></article></body></html>';
    const result=report(original,original.replace("old wording","clearer configuration instructions"),["保留 slide 章节结构"]);
    expect(result.nativeObservation).toMatchObject({originalScriptCount:1,candidateScriptCount:1,scriptBlocksUnchanged:true,
      styleBlocksUnchanged:true,stylesheetReferencesUnchanged:true,elementTreeAndAttributesUnchanged:true,slideCardOrderUnchanged:true,
      originalSlideCardCount:1,candidateSlideCardCount:1,templateCount:0});
    expect(result.nativeObservation).not.toHaveProperty("runtimePassed");
  });
  it.each(["script","style","attributes","parent","order"])("detects changed %s even when slide IDs survive",kind=>{
    const original='<html><head><style>p{color:red}</style><script>const x=1;</script></head><body><div><p>one</p></div><p>two</p><article class="slide-card" id="slide-1"></article><article class="slide-card" id="slide-2"></article></body></html>';
    const changed=kind==="script"?original.replace("x=1","x=2"):kind==="style"?original.replace("color:red","color:blue")
      :kind==="attributes"?original.replace('<p>one','<p onclick="broken()">one'):kind==="parent"?original.replace('<div><p>one</p></div><p>two</p>','<div><p>one</p><p>two</p></div>')
      :original.replace('id="slide-1"','id="swap"').replace('id="slide-2"','id="slide-1"').replace('id="swap"','id="slide-2"');
    const facts=report(original,changed,["保留 slide 章节结构"]).nativeObservation;
    expect(kind==="script"?facts.scriptBlocksUnchanged:kind==="style"?facts.styleBlocksUnchanged:kind==="order"?facts.slideCardOrderUnchanged:facts.elementTreeAndAttributesUnchanged).toBe(false);
  });
  it("distinguishes additive document markup from changed existing controls",()=>{
    const original=html('<article id="slide-1" class="slide-card"><p>old</p><button id="next" onclick="next()">Next</button></article>');
    const expanded=original.replace("<p>old</p>","<p>clearer</p><p><strong>new detail</strong></p>");
    expect(report(original,expanded).nativeObservation).toMatchObject({elementTreeAndAttributesUnchanged:false,
      originalNamedElementsRetained:true,originalInteractiveElementSequenceRetained:true});
    expect(report(original,expanded.replace('onclick="next()"','onclick="broken()"')).nativeObservation.originalInteractiveElementSequenceRetained).toBe(false);
  });
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
