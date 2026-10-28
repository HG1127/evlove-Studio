import {describe,expect,it} from "vitest";
import {assertHtmlNumberedListConstruction,HtmlNumberedListConstructionError} from "./html-numbered-list-construction";
const html=(items:string[])=>`<html><body><article id="slide-87"><ul>${items.map(s=>`<li>${s}</li>`).join("")}</ul></article></body></html>`;
const original=html(["1. Open page","2. Phone works","3. No errors"]);
describe("numbered instruction construction",()=>{
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
