import {describe,expect,it} from "vitest";
import {fastHash} from "./stable-hash";
import {htmlNativeProgramIdentity} from "./html-native-program-identity";
const html='<html><head><script>function copy(){return true}</script></head><body><button onclick="copy()">复制</button><p>旧说明</p><pre>  code\n    indentation</pre></body></html>';
describe("HTML executable surface identity",()=>{
  it("does not treat a prose change as a program change and emits only digests/counts",()=>{
    const first=htmlNativeProgramIdentity(html,fastHash),next=htmlNativeProgramIdentity(html.replace("旧说明","更具体的新说明"),fastHash);
    expect(first).toEqual(next);expect(JSON.stringify(first)).not.toMatch(/function copy|onclick|indentation/);
    expect(first).toMatchObject({scriptCount:1,inlineExecutableAttributeCount:1,templateCount:0,frameCount:0,externalScriptCount:0,unlocated:false});
  });
  it.each([html.replace('return true','return false'),html.replace('onclick="copy()"','onclick="other()"'),html.replace('</body>','<a href="javascript:other()">x</a></body>'),html.replace('</body>','<template><script>other()</script></template></body>'),html.replace('</body>','<iframe srcdoc="other()"></iframe></body>')])("detects changed executable surfaces",candidate=>{
    expect(htmlNativeProgramIdentity(candidate,fastHash).signature).not.toBe(htmlNativeProgramIdentity(html,fastHash).signature);
  });
  it("records exact code whitespace independently from executable behavior",()=>{
    const first=htmlNativeProgramIdentity(html,fastHash),next=htmlNativeProgramIdentity(html.replace('    indentation','indentation'),fastHash);
    expect(first.signature).toBe(next.signature);expect(first.codeBlockDigests).not.toEqual(next.codeBlockDigests);
  });
  it("binds inline styles, style blocks and stylesheet references without exposing CSS",()=>{
    const css='<html><head><style>PRIVATE_STYLE</style><link rel="stylesheet" href="theme.css"></head><body><p style="PRIVATE_INLINE">text</p></body></html>';
    const first=htmlNativeProgramIdentity(css,fastHash);
    expect(first).toMatchObject({styleCount:1,inlineStyleAttributeCount:1,stylesheetReferenceCount:1});
    expect(JSON.stringify(first)).not.toMatch(/PRIVATE_|theme\.css/);
    for(const changed of [css.replace('PRIVATE_STYLE','changed'),css.replace('PRIVATE_INLINE','changed'),css.replace('theme.css','other.css')]){
      expect(htmlNativeProgramIdentity(changed,fastHash).styleSignature).not.toBe(first.styleSignature);
      expect(htmlNativeProgramIdentity(changed,fastHash).signature).toBe(first.signature);
    }
  });
  it("keeps SVG geometry and media scope separate from the program signature",()=>{
    const first=htmlNativeProgramIdentity(html.replace('</body>','<svg><path d="M0 0 L1 1"/></svg></body>'),fastHash);
    const next=htmlNativeProgramIdentity(html.replace('</body>','<svg><path d="M0 0 L2 2"/></svg><img src="image.png"></body>'),fastHash);
    expect(first.signature).toBe(next.signature);expect(first.visualBlockDigests).not.toEqual(next.visualBlockDigests);
    expect(first.mediaCount).toBe(0);expect(next.mediaCount).toBe(1);
  });
});
