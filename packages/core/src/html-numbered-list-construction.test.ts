import {describe,expect,it} from "vitest";
import {assertHtmlNumberedListConstruction,HtmlNumberedListConstructionError} from "./html-numbered-list-construction";
const html=(items:string[])=>`<html><body><article id="slide-87"><ul>${items.map(s=>`<li>${s}</li>`).join("")}</ul></article></body></html>`;
const original=html(["1. Open page","2. Phone works","3. No errors"]);
describe("numbered instruction construction",()=>{
  it("checks explicit consecutive paragraph steps in known slide text containers",()=>{
    const wrap=(items:string[])=>`<article class="slide-card" id="slide-97"><div class="text-lines">${items.map(s=>`<p>${s}</p>`).join("\n")}</div></article>`;
    const source=wrap(["1. Open","2. Authorize","3. Deploy"]);
    const bad=wrap(["1. Open","2. Authorize","2. Authorize and verify","3. Deploy"]);
    expect(()=>assertHtmlNumberedListConstruction(source,bad)).toThrow(HtmlNumberedListConstructionError);
    try{assertHtmlNumberedListConstruction(source,bad);}catch(e){expect(e).toMatchObject({issues:[{section:"slide-97",itemIndex:3,expectedNumber:3,observedNumber:2},{section:"slide-97",itemIndex:4,expectedNumber:4,observedNumber:3}],listContext:{groups:[{prefixNumbers:[1,2,2,3],originalSourceLists:[{prefixNumbers:[1,2,3]}]}]}});}
    expect(assertHtmlNumberedListConstruction(source,wrap(["1. <strong>Open</strong>","2. Authorize and verify","3. Check scope","4. Deploy"]))).toMatchObject({checkedLists:1});
    expect(bad).toContain("2. Authorize and verify");
  });
  it("limits paragraph numbering to explicit runs and preserves unchanged source defects",()=>{
    const wrap=(s:string)=>`<article id="slide-97"><div class="text-lines">${s}</div></article>`;
    const legacy=wrap('<p>1. First</p><p>3. Last</p>');
    expect(assertHtmlNumberedListConstruction(legacy,legacy).checkedLists).toBe(0);
    expect(()=>assertHtmlNumberedListConstruction(legacy,legacy.replace('First','Edited first'))).toThrow();
    for(const prose of ['<p>15 分钟</p><p>240 字</p>','<p>2.5 version</p><p>3.5 version</p>','<p>01</p><p>04</p>','<p>1. Single example</p><p>Ordinary prose</p>'])
      expect(assertHtmlNumberedListConstruction('',wrap(prose)).checkedLists).toBe(0);
    expect(assertHtmlNumberedListConstruction('','<div class="text-lines"><p>1. One</p><p>3. Three</p></div>').checkedLists).toBe(0);
    expect(assertHtmlNumberedListConstruction('',wrap('<pre><p>1. One</p><p>3. Three</p></pre>')).checkedLists).toBe(0);
    expect(()=>assertHtmlNumberedListConstruction('',wrap('<p>1. One</p><!-- formatting --><p>3. Three</p>'))).toThrow();
  });
  it("checks steps across individual renderer content blocks without duplicate group reports",()=>{
    const wrap=(items:string[])=>`<article id="slide-97"><div class="slide-body">${items.map(s=>`<div class="content-block"><p>${s}</p></div>`).join('')}</div></article>`;
    const source=wrap(['1. Open','2. Authorize','3. Deploy']);
    expect(()=>assertHtmlNumberedListConstruction(source,wrap(['1. Open','2. Authorize','2. Verify','3. Deploy']))).toThrow();
    expect(assertHtmlNumberedListConstruction(source,wrap(['1. Open','2. Authorize and verify','3. Deploy']))).toMatchObject({checkedLists:1});
    const nested='<article id="slide-97"><div class="slide-body"><div class="content-block"><div class="text-lines"><p>1. One</p><p>3. Three</p></div></div></div></article>';
    try{assertHtmlNumberedListConstruction('',nested);}catch(e){expect((e as HtmlNumberedListConstructionError).listContext?.groups).toHaveLength(1);}
  });
  it("reports source numbering and parser-created empty rows without prescribing the damaged sequence's start",()=>{
    const source=html(["1. Confirm requirement","2. List files","3. List boundaries","4. Run locally","5. Check build","6. User checks","7. Commit"]);
    const bad=source.replace('1. Confirm requirement','<li>5. Check build with recovery</li>');
    let error:unknown;try{assertHtmlNumberedListConstruction(source,bad);}catch(e){error=e;}
    expect(error).toBeInstanceOf(HtmlNumberedListConstructionError);
    expect(error).toMatchObject({listContext:{schemaVersion:"numbered-list-construction-context-v1",numberHintsAreNotRenumberingTargets:true,omittedGroupCount:0,
      groups:[{section:"slide-87",itemCount:8,prefixNumbers:[null,5,2,3,4,5,6,7],emptyItemIndexes:[1],originalSourceLists:[{listIndex:1,itemCount:7,prefixNumbers:[1,2,3,4,5,6,7],emptyItemIndexes:[]}]}]}});
    expect(JSON.stringify((error as HtmlNumberedListConstructionError).listContext)).not.toContain('Confirm requirement');
    expect(()=>assertHtmlNumberedListConstruction(source,source.replace('5. Check build','5. <strong>Check build</strong> with recovery'))).not.toThrow();
  });
  it("omits an oversized list shape explicitly while keeping the same failed validation",()=>{
    const bad=html(Array.from({length:12000},()=>"1. Repeated item"));let error:unknown;
    try{assertHtmlNumberedListConstruction(original,bad);}catch(e){error=e;}
    expect(error).toBeInstanceOf(HtmlNumberedListConstructionError);
    const context=(error as HtmlNumberedListConstructionError).listContext!;
    expect(context.groups).toEqual([]);expect(context.omittedGroupCount).toBe(1);expect(JSON.stringify(context).length).toBeLessThanOrEqual(20000);
  });
  it("rejects the measured class of duplicated replacement while leaving bytes untouched",()=>{
    const bad=html(["1. Open page","3. No errors with recovery","3. No errors"]);
    expect(()=>assertHtmlNumberedListConstruction(original,bad)).toThrow(HtmlNumberedListConstructionError);
    try{assertHtmlNumberedListConstruction(original,bad);}catch(error){expect(error).toMatchObject({code:"HTML_NUMBERED_LIST_INCOHERENT",issues:[{section:"slide-87",listIndex:1,itemIndex:2,expectedNumber:2,observedNumber:3}]});}
    expect(bad).toContain("3. No errors with recovery");
  });
  it.each([{items:["1. A","3. C"]},{items:["1. A","unlabelled B","3. C"]},{items:["2. B","1. A"]}])("rejects a changed broken group $items",({items})=>{
    expect(()=>assertHtmlNumberedListConstruction(original,html(items))).toThrow(HtmlNumberedListConstructionError);
  });
  it("allows additional steps, rewritten checks and coherent renumbering",()=>{
    expect(assertHtmlNumberedListConstruction(original,html(["1. Open and verify","2. New independent step","3. Phone works","4. No errors"])).checkedLists).toBe(1);
    expect(assertHtmlNumberedListConstruction(original,html(["步骤 1：打开","步骤 2：窄屏","步骤 3：错误"])).checkedLists).toBe(1);
    expect(assertHtmlNumberedListConstruction(original,html(["04. Substep A","05. Substep B"])).checkedLists).toBe(1);
  });
  it("leaves unchanged legacy malformed lists intact but does not bless a modified malformed copy",()=>{
    const old=html(["1. A","3. C"]);expect(assertHtmlNumberedListConstruction(old,old).checkedLists).toBe(0);
    expect(()=>assertHtmlNumberedListConstruction(old,html(["1. Modified A","3. C"]))).toThrow();
    expect(assertHtmlNumberedListConstruction(old,html(["1. A","2. Corrected C"])).checkedLists).toBe(1);
  });
  it("treats normal bullets, native list markers and decimal text as outside this text-prefix check",()=>{
    for(const candidate of [html(["Open page","Phone works"]),'<ol><li>A</li><li>B</li></ol>',html(["2.5 version","3.5 version"])])expect(()=>assertHtmlNumberedListConstruction(original,candidate)).not.toThrow();
  });
  it("excludes inert/program/code content and evaluates nested list numbering independently",()=>{
    const bad=html(["1. A","4. B"]);
    expect(assertHtmlNumberedListConstruction("",`<template>${bad}</template><script>${bad}</script><pre>${bad}</pre>`).checkedLists).toBe(0);
    expect(()=>assertHtmlNumberedListConstruction("",'<ul><li>1. Parent<ul><li>1. Child</li><li>3. Child</li></ul></li><li>2. Parent</li></ul>')).toThrow();
  });
  it("does not silently exempt an extra malformed duplicate of a legacy group",()=>{
    const old=html(["1. A","3. C"]);expect(()=>assertHtmlNumberedListConstruction(old,old.replace('</article>','<ul><li>1. A</li><li>3. C</li></ul></article>'))).toThrow();
  });
});
