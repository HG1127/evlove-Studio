import {describe,expect,it} from "vitest";
import {assertHtmlParagraphConstruction,HtmlParagraphConstructionError} from "./html-paragraph-construction";
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
});
