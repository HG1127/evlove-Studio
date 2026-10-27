import {describe,expect,it} from "vitest";
import {assertHtmlParagraphConstruction,htmlParagraphConstructionContext,HtmlParagraphConstructionError} from "./html-paragraph-construction";
import {htmlBuildBodyEditAnchors} from "./html-text-node-edits";
import {HtmlBuildBodyContextSchema} from "@evolution/contracts";
const slide=(content:string,id="slide-64")=>`<article class="slide-card" id="${id}"><div class="slide-body">${content}</div></article>`;
const card=(text:string,id="slide-64")=>slide(`<div class="content-block"><p>${text}</p></div>`,id);
describe("known SOP paragraph construction budget",()=>{
  it("rejects a new wall of prose without rewriting it or claiming an actual UX failure",()=>{
    const original=card("配置介绍"),subject=card("配置".repeat(556));
    expect(()=>assertHtmlParagraphConstruction(original,subject)).toThrow(HtmlParagraphConstructionError);
    try{assertHtmlParagraphConstruction(original,subject);}catch(error){expect(error).toMatchObject({issues:[{section:"slide-64",role:"introductory",chars:1112,maxChars:240}]});}
  });
  it("accepts the declared boundary and distributed existing step details",()=>{
    expect(assertHtmlParagraphConstruction(card("原文"),card("字".repeat(240))).checkedParagraphs).toBe(1);
    expect(()=>assertHtmlParagraphConstruction(card("原文"),card("字".repeat(241)))).toThrow(HtmlParagraphConstructionError);
    const subject=card("简短介绍")+slide('<div class="mini-card"><p>'+"配置".repeat(100)+"</p></div>","slide-65");
    expect(()=>assertHtmlParagraphConstruction(card("原文"),subject)).not.toThrow();
  });
  it("preserves existing long Original prose, counts decoded inline text and excludes inactive markup",()=>{
    const original=card("原".repeat(500));
    expect(assertHtmlParagraphConstruction(original,original).checkedParagraphs).toBe(0);
    expect(()=>assertHtmlParagraphConstruction(original,card("原".repeat(499)+"新"))).toThrow();
    expect(()=>assertHtmlParagraphConstruction(card("原文"),card("&amp;".repeat(240)))).not.toThrow();
    expect(()=>assertHtmlParagraphConstruction("",'<template>'+card("字".repeat(1000))+'</template><script>'+"字".repeat(1000)+'</script>')).not.toThrow();
  });
  it("does not borrow a long paragraph exemption from a different section or role",()=>{
    const original=card("字".repeat(500));
    expect(()=>assertHtmlParagraphConstruction(original,card("字".repeat(500),"slide-65"))).toThrow();
    expect(()=>assertHtmlParagraphConstruction(original,slide('<div class="mini-card"><p>'+"字".repeat(500)+'</p></div>'))).toThrow();
    const duplicated=slide('<div class="content-block"><p>'+"字".repeat(500)+'</p><p>'+"字".repeat(500)+'</p></div>');
    expect(()=>assertHtmlParagraphConstruction(original,duplicated)).toThrow();
  });
  it("groups inline anchors into the complete paragraph that actually owns the 240-character budget",()=>{
    const sha="a".repeat(64),original='<html><body>'+slide('<p>前文<span>'+"字".repeat(120)+'</span><em>'+"文".repeat(100)+'</em>尾</p>')+'</body></html>';
    const anchors=htmlBuildBodyEditAnchors(original,sha),paragraphs=htmlParagraphConstructionContext(original,sha,anchors);
    expect(paragraphs).toHaveLength(1);expect(paragraphs[0]).toMatchObject({chars:223,paragraphIndex:1,anchorIds:anchors.map(a=>a.anchorId)});
    const tooLong=original.replace("字".repeat(120),"字".repeat(160));
    expect(()=>assertHtmlParagraphConstruction(original,tooLong)).toThrow(HtmlParagraphConstructionError);
    const fits=original.replace("字".repeat(120),"字".repeat(137));
    expect(assertHtmlParagraphConstruction(original,fits).checkedParagraphs).toBe(1);
    const context={schemaVersion:"html-build-body-context-v1",parentSha256:sha,anchors,components:[],paragraphGroups:paragraphs};
    expect(HtmlBuildBodyContextSchema.safeParse(context).success).toBe(true);
    expect(HtmlBuildBodyContextSchema.safeParse({...context,paragraphGroups:[{...paragraphs[0],anchorIds:["unissued"]}]}).success).toBe(false);
    expect(()=>htmlParagraphConstructionContext(original,"b".repeat(64),anchors)).toThrow("physical parent");
    expect(HtmlBuildBodyContextSchema.safeParse({...context,paragraphGroups:[paragraphs[0],paragraphs[0]]}).success).toBe(false);
  });
  it("reports a paragraph ordinal and bounded body-only excerpt without changing the existing Original exemption",()=>{
    const long="原".repeat(500),original=card(long),shifted=original.replace('<p>','<p>简短新增说明</p><p>');
    expect(assertHtmlParagraphConstruction(original,shifted).checkedParagraphs).toBe(1);
    const subject=slide('<p>短文</p><p><span>'+"新".repeat(400)+'</span><script>PRIVATE_PROGRAM</script></p>');
    try{assertHtmlParagraphConstruction(original,subject);expect.unreachable();}catch(error){
      expect(error).toMatchObject({issues:[{paragraphIndex:2,chars:400,maxChars:240,textExcerpt:"新".repeat(320)}]});
      expect((error as Error).message).toContain("slide-64 paragraph 2: 400/240");
      expect((error as Error).message).not.toMatch(/PRIVATE_PROGRAM|新/);
      expect(JSON.stringify(error)).not.toContain("PRIVATE_PROGRAM");
    }
  });
});
