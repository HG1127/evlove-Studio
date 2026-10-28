import {describe,expect,it} from "vitest";
import {projectHtmlToolCodeText} from "./html-tool-text-projection";
import {htmlNativeCodeRetention} from "./html-native-code-retention";
const source='<html><body><article class="slide-card" data-kind="tool" id="slide-64"><div class="slide-body"><p>Introduction</p><div class="mini-grid"><div class="mini-card"><p>01</p><p>Log in</p></div><div class="mini-card"><pre class="code-block"><code>02\n写 .env.local &amp; 核对</code></pre></div></div></div></article></body></html>';
const changed=source.replace("Introduction","Updated introduction");

describe("known tool renderer's paragraph text slots",()=>{
  it("projects a code-only instruction into one paragraph while retaining exact original blocks",()=>{
    const result=projectHtmlToolCodeText(source,changed);
    expect(result.projectedToolCardIds).toEqual(["slide-64"]);
    expect(result.html).toBe(changed.replace('</code></pre>','</code></pre><p>写 .env.local &amp; 核对</p>'));
    expect(htmlNativeCodeRetention(source,result.html)).toMatchObject({retained:true,exactCount:2});
    // One paragraph keeps the generic-step branch; two would switch all cards to the rich-tool layout.
    expect(result.html).not.toContain('<p>02</p><p>写');
    expect(projectHtmlToolCodeText(source,result.html)).toEqual({html:result.html,projectedToolCardIds:[]});
  });
  it("keeps unmatched numbers, unnumbered instructions and multiline content without guessing",()=>{
    for(const value of ['05\n写 .env.local &amp; 核对','2\n写 .env.local &amp; 核对','02.\n写 .env.local &amp; 核对','写 .env.local &amp; 核对','02\n写 .env.local\n核对参数']){
      const original=source.replace('02\n写 .env.local &amp; 核对',value),subject=original.replace('Introduction','Updated');
      expect(projectHtmlToolCodeText(original,subject).html).toContain('</code></pre><p>'+value+'</p>');
    }
  });
  it("binds the generated number to both Original and Candidate positions across direct grids",()=>{
    const split=source.replace('</p></div><div class="mini-card"><pre','</p></div></div><div class="mini-grid"><div class="mini-card"><pre');
    expect(projectHtmlToolCodeText(split,split.replace('Introduction','Updated')).html).toContain('</code></pre><p>写 .env.local &amp; 核对</p>');
    const inserted=changed.replace('<div class="mini-card"><pre','<div class="mini-card"><p>Inserted step</p></div><div class="mini-card"><pre');
    expect(projectHtmlToolCodeText(source,inserted).html).toContain('</code></pre><p>02\n写 .env.local &amp; 核对</p>');
    const relocatedOriginal=source.replace('<div class="mini-card"><pre','<div class="mini-card"><p>Existing step</p></div><div class="mini-card"><pre');
    expect(projectHtmlToolCodeText(relocatedOriginal,changed).html).toContain('</code></pre><p>02\n写 .env.local &amp; 核对</p>');
  });
  it("does not infer generated numbering for nested grids/cards or indirect grid layouts",()=>{
    for(const transform of [
      (s:string)=>s.replace('<div class="mini-grid">','<div class="wrapper"><div class="mini-grid">').replace('</article>','</div></article>'),
      (s:string)=>s.replace('<div class="mini-grid">','<div class="mini-grid"><div class="mini-card"><div class="mini-grid">').replace('</article>','</div></div></article>'),
    ]){
      const original=transform(source),subject=original.replace('Introduction','Updated');
      expect(projectHtmlToolCodeText(original,subject).html).toContain('</code></pre><p>02\n写 .env.local &amp; 核对</p>');
    }
  });
  it("leaves an existing old projection and every original code byte unchanged",()=>{
    const old=changed.replace('</code></pre>','</code></pre><p>02\n写 .env.local &amp; 核对</p>');
    expect(projectHtmlToolCodeText(source,old)).toEqual({html:old,projectedToolCardIds:[]});
    const crlf=source.replace('02\n写','02\r\n写'),projected=projectHtmlToolCodeText(crlf,crlf.replace('Introduction','Updated'));
    expect(projected.html).toContain('<code>02\r\n写 .env.local &amp; 核对</code>');
    expect(projected.html).toContain('</code></pre><p>写 .env.local &amp; 核对</p>');
    expect(htmlNativeCodeRetention(crlf,projected.html).retained).toBe(true);
  });
  it("does not mutate an unchanged Original or infer a text slot for unrelated renderers and structures",()=>{
    expect(projectHtmlToolCodeText(source,source).html).toBe(source);
    for(const transform of [
      (s:string)=>s.replace('data-kind="tool"','data-kind="guide"'),
      (s:string)=>s.replace('class="mini-grid"','class="unrelated"'),
      (s:string)=>s.replace('class="mini-card"><pre','class="mini-card" contenteditable="true"><pre'),
      (s:string)=>s.replace('<code>','<code class="language-js">'),
      (s:string)=>s.replace('<pre class="code-block">','<div><pre class="code-block">').replace('</pre>','</pre></div>'),
    ]){const original=transform(source),subject=transform(changed);expect(projectHtmlToolCodeText(original,subject).html).toBe(subject);}
  });
  it("rejects ambiguous, unbound or markup-bearing code rather than injecting it into the renderer",()=>{
    const card='<div class="mini-card"><pre class="code-block"><code>02\n写 .env.local &amp; 核对</code></pre></div>';
    const duplicated=source.replace(card,card+card);
    expect(projectHtmlToolCodeText(duplicated,duplicated.replace("Introduction","Updated")).projectedToolCardIds).toEqual([]);
    const unbound=changed.replace('写 .env.local','new code');
    expect(projectHtmlToolCodeText(source,unbound)).toEqual({html:unbound,projectedToolCardIds:[]});
    for(const value of ['&lt;img src=x onerror=bad()&gt;',"x".repeat(241)]){
      const original=source.replace('02\n写 .env.local &amp; 核对',value),subject=original.replace("Introduction","Updated");
      expect(projectHtmlToolCodeText(original,subject).html).toBe(subject);
    }
  });
  it("preserves existing visible paragraphs and does not create another copy",()=>{
    const original=source.replace('</pre>','</pre><p>Existing instruction</p>'),subject=original.replace("Introduction","Updated");
    expect(projectHtmlToolCodeText(original,subject)).toEqual({html:subject,projectedToolCardIds:[]});
  });
  it("does not duplicate table-cell text that the other known tool branch already renders",()=>{
    const row=(n:number)=>`<div class="mini-grid cols-3"><div class="mini-card"><pre class="code-block"><code>Existing table row ${n}</code></pre></div><div class="mini-card"><p>B</p></div><div class="mini-card"><p>C</p></div></div>`;
    const original='<html><body><article class="slide-card" data-kind="tool" id="slide-64"><div class="slide-body"><p>Introduction</p>'+row(1)+row(2)+row(3)+'</div></article></body></html>',subject=original.replace('Introduction','Updated');
    expect(projectHtmlToolCodeText(original,subject)).toEqual({html:subject,projectedToolCardIds:[]});
  });
});
