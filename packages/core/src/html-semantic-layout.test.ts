import {describe,expect,it} from "vitest";
import {assertHtmlKnownSemanticLayout,htmlKnownSemanticComponents,HtmlSemanticLayoutError} from "./html-semantic-layout";

const component=(label="非常适合",content="内部工具、流程清晰的软件")=>`<div class="content-block"><div class="text-lines"><p><b>${label}</b></p><p>${content}</p></div></div>`;
const html=(content:string)=>`<html><head><script>const untouched=true;</script></head><body><article class="slide-card" id="slide-11"><div class="slide-body">${content}</div></article></body></html>`;
describe("known renderer two-paragraph component contract",()=>{
  it("rejects the actual failure shape: a third paragraph prevents the original semantic-card conversion",()=>{
    const original=html(component()),subject=original.replace("</p></div>","</p><p>完成检查：记录结果</p></div>");
    expect(htmlKnownSemanticComponents(original)).toEqual([{section:"slide-11",label:"非常适合",paragraphCount:2}]);
    expect(()=>assertHtmlKnownSemanticLayout(original,subject)).toThrow(HtmlSemanticLayoutError);
    try{assertHtmlKnownSemanticLayout(original,subject);}catch(error){expect((error as HtmlSemanticLayoutError).issues).toEqual([{section:"slide-11",label:"非常适合",expectedParagraphs:2,actualParagraphs:3,code:"paragraph-count-changed"}]);}
  });
  it("permits actual prose refinement and new paragraphs/lists outside the removed component",()=>{
    const original=html(component()),subject=html(component("非常适合","内部工具、流程清晰的软件；先确认目标用户")+"<p>完成检查：记录负责人和结果。</p><ul><li>失败时保留现场。</li></ul>");
    expect(()=>assertHtmlKnownSemanticLayout(original,subject)).not.toThrow();
    expect(subject).toContain("先确认目标用户");expect(subject).toContain("失败时保留现场");
  });
  it("does not permit moving new prose beside the slots where the runtime would discard it",()=>{
    const original=html(component()),subject=original.replace("</div></div>","</div><p>新增完成检查</p></div>");
    expect(()=>assertHtmlKnownSemanticLayout(original,subject)).toThrow(HtmlSemanticLayoutError);
  });
  it.each(["removed","label","duplicate","relocated"])("rejects %s original components without inventing a style verdict",kind=>{
    const original=html(component());let subject=original;
    if(kind==="removed")subject=html("");
    if(kind==="label")subject=subject.replace("非常适合","完全改写的标签");
    if(kind==="duplicate")subject=html(component()+component());
    if(kind==="relocated")subject=subject.replace("slide-11","slide-12");
    expect(()=>assertHtmlKnownSemanticLayout(original,subject)).toThrow(HtmlSemanticLayoutError);
  });
  it("preserves existing duplicate labels in their ordered slots and ignores unrelated label-like prose",()=>{
    const original=html(component()+component("非常适合","第二个原有分类"));
    expect(()=>assertHtmlKnownSemanticLayout(original,original)).not.toThrow();
    expect(()=>assertHtmlKnownSemanticLayout(original,original.replace("第二个原有分类","第二个原有分类；增加说明"))).not.toThrow();
    expect(htmlKnownSemanticComponents(html('<p>非常适合</p><div class="text-lines"><p>注意事项</p><p>无 content-block 父级</p></div>'))).toEqual([]);
  });
});
