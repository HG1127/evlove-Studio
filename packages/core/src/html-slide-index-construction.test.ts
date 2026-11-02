import {describe,expect,it} from "vitest";
import {assertHtmlSlideIndexConstruction,HtmlSlideIndexConstructionError} from "./html-slide-index-construction";
const card=(id:string,label:string,body="Source content")=>`<article class="slide-card" id="${id}"><div class="slide-index">${label}</div><div class="slide-body"><p>${body}</p></div></article>`;
const original=card("slide-97","097")+card("slide-98","098");
describe("Original slide index construction binding",()=>{
 it("keeps labels bound to their source cards while allowing body and inline markup changes",()=>{
  expect(assertHtmlSlideIndexConstruction(original,original.replace('Source content','Detailed source content'))).toMatchObject({checkedCards:2,unboundOriginalCards:0,originalStructureAmbiguous:false});
  expect(assertHtmlSlideIndexConstruction(original,original.replace('>098<','><span>098</span><'))).toMatchObject({checkedCards:2});
 });
 it.each([['empty',card('slide-97','097')+card('slide-98','')],['wrong',card('slide-97','097')+card('slide-98','099')],
  ['swapped',card('slide-97','098')+card('slide-98','097')],['removed card',card('slide-97','097')],
  ['duplicate card',original+card('slide-98','098')],['duplicate label',original.replace('>098<','>098</div><div class="slide-index">098<')]])("rejects a changed source label: %s",(_,subject)=>{
  expect(()=>assertHtmlSlideIndexConstruction(original,subject)).toThrow(HtmlSlideIndexConstructionError);
 });
 it("reports only bounded observed-label details and never repairs source bytes",()=>{
  const bad=card('slide-97','097')+card('slide-98','x'.repeat(500));
  try{assertHtmlSlideIndexConstruction(original,bad);}catch(e){expect(e).toMatchObject({code:'HTML_SLIDE_INDEX_RETENTION_FAILED',issues:[{section:'slide-98',expectedIndex:'098',observedIndexes:['x'.repeat(32)],observedIndexCount:1}]});}
  expect(bad).toContain('x'.repeat(500));expect(original).toContain('>098<');
 });
 it("does not invent index protection for unsupported or ambiguous Original structure",()=>{
  for(const source of ['<p>Ordinary text</p>',card('slide-98','Appendix'),card('slide-98',''),original+card('slide-98','098')]){
   expect(assertHtmlSlideIndexConstruction(source,source).checkedCards).toBe(0);
  }
  expect(assertHtmlSlideIndexConstruction(original+card('slide-98','098'),original)).toMatchObject({checkedCards:0,originalStructureAmbiguous:true});
 });
 it("ignores inert/code labels and rejects duplicated live labels instead",()=>{
  const inert=`<template>${card('slide-98','999')}</template><pre>${card('slide-98','999')}</pre>`;
  expect(assertHtmlSlideIndexConstruction(original,original+inert).checkedCards).toBe(2);
  expect(()=>assertHtmlSlideIndexConstruction(original,original.replace('</article>','<div class="slide-index">097</div></article>'))).toThrow();
 });
});
