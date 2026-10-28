import {describe,expect,it} from "vitest";
import {assertHtmlNumberedListConstruction,HtmlNumberedListConstructionError} from "./html-numbered-list-construction";
const html=(items:string[])=>`<html><body><article id="slide-87"><ul>${items.map(s=>`<li>${s}</li>`).join("")}</ul></article></body></html>`;
const original=html(["1. Open page","2. Phone works","3. No errors"]);
describe("numbered instruction construction",()=>{
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
