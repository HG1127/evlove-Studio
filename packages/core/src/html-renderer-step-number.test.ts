import {describe,expect,it} from "vitest";
import {assertHtmlRendererStepNumbers,HtmlRendererStepNumberError} from "./html-renderer-step-number";
const html=(detail:string,label="01")=>`<html><body><article class="slide-card" data-kind="tool" id="slide-64"><div class="slide-body"><div class="mini-grid"><div class="mini-card"><p>${label}</p><p>${detail}</p></div></div></div></article></body></html>`;
const original=html("PRIVATE_SOURCE_REQUIREMENT");
describe("retained tool step labels and detail text",()=>{
  it("binds the measured renderer's text-lines wrapper without treating arbitrary wrappers as visible slots",()=>{
    const wrapped=original.replace('<p>01</p>','<div class="text-lines"><p>01</p>').replace('</p></div></div></div>','</p></div></div></div></div>');
    expect(()=>assertHtmlRendererStepNumbers(wrapped,wrapped.replace('PRIVATE_SOURCE_REQUIREMENT','01\nNew check'))).toThrow(HtmlRendererStepNumberError);
    const unknown=wrapped.replace('class="text-lines"','class="unclassified"');
    expect(assertHtmlRendererStepNumbers(unknown,unknown.replace('PRIVATE_SOURCE_REQUIREMENT','01\nNew check')).checkedCards).toBe(0);
  });
  it("keeps feedback prefixes bounded even when the proposal inserts excessive whitespace",()=>{
    let observed:unknown;try{assertHtmlRendererStepNumbers(original,html('步骤'+" ".repeat(10000)+'01：new instruction'));}catch(error){observed=error;}
    expect(observed).toBeInstanceOf(HtmlRendererStepNumberError);
    expect((observed as HtmlRendererStepNumberError).issues[0]?.detailPrefix).toBe('步骤01');
    expect(JSON.stringify(observed).length).toBeLessThan(500);
  });
  it.each(["01\nPRIVATE_NEW_CHECK","01. PRIVATE_NEW_CHECK","1、PRIVATE_NEW_CHECK","步骤 1：PRIVATE_NEW_CHECK","01"])("rejects a newly repeated label: %s",detail=>{
    const subject=html(detail);expect(()=>assertHtmlRendererStepNumbers(original,subject)).toThrow(HtmlRendererStepNumberError);
    try{assertHtmlRendererStepNumbers(original,subject);}catch(error){expect(error).toMatchObject({code:"HTML_RENDERER_STEP_NUMBER_ECHO",issues:[{section:"slide-64",gridIndex:1,cardIndex:1,label:"01"}]});expect(JSON.stringify(error)).not.toContain("PRIVATE_");}
    expect(subject).toBe(html(detail));
  });
  it.each(["1 个项目，并核对项目归属","1.5 版本参数","01.5 is a decimal","检查配置并保留所有操作与参数","02 不是当前标签"])("preserves meaningful quantities and nonmatching prose: %s",detail=>{
    expect(assertHtmlRendererStepNumbers(original,html(detail)).checkedCards).toBe(1);
  });
  it("does not treat a plain count as an echo of a single-digit label",()=>{
    expect(assertHtmlRendererStepNumbers(html("Original","1"),html("1 个项目","1")).checkedCards).toBe(1);
    expect(()=>assertHtmlRendererStepNumbers(html("Original","1"),html("步骤1：新增检查","1"))).toThrow();
  });
  it("retains inherited echoes while rejecting a newly introduced echo in another card",()=>{
    const inherited=html("01 Old repeated detail");expect(assertHtmlRendererStepNumbers(inherited,inherited).checkedCards).toBe(1);
    expect(()=>assertHtmlRendererStepNumbers(inherited,html("01 Old repeated detail plus additional facts"))).not.toThrow();
    const source=inherited.replace('</div></div></div>','</div><div class="mini-card"><p>02</p><p>Original check</p></div></div></div>');
    expect(()=>assertHtmlRendererStepNumbers(source,source.replace('Original check','02 Added check'))).toThrow();
  });
  it("does not guess correspondence across changed grid/card shapes, labels or unrelated renderers",()=>{
    const bad=html("01 Echo");
    for(const subject of [bad.replace('<p>01</p>','<p>02</p>'),bad.replace('<div class="mini-card">','<div class="mini-card"><p>Extra</p>'),bad.replace('data-kind="tool"','data-kind="guide"'),bad.replace('<div class="mini-grid">','<div class="wrapper"><div class="mini-grid">').replace('</article>','</div></article>')]){
      expect(assertHtmlRendererStepNumbers(original,subject).checkedCards).toBe(0);
    }
  });
  it("ignores inert code and ambiguous duplicate section identities",()=>{
    expect(assertHtmlRendererStepNumbers(original,'<template>'+html("01 Echo")+'</template>').checkedCards).toBe(0);
    expect(assertHtmlRendererStepNumbers(original,html("01 Echo")+html("01 Echo")).checkedCards).toBe(0);
    expect(assertHtmlRendererStepNumbers(html('<code>01 Example</code>'),html('<code>01 Changed example</code>')).checkedCards).toBe(1);
  });
});
