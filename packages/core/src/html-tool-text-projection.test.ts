import {describe,expect,it} from "vitest";
import {projectHtmlToolCodeText} from "./html-tool-text-projection";
import {htmlNativeCodeRetention} from "./html-native-code-retention";
const source='<html><body><article class="slide-card" data-kind="tool" id="slide-64"><div class="slide-body"><p>Introduction</p><div class="mini-grid"><div class="mini-card"><p>01</p><p>Log in</p></div><div class="mini-card"><pre class="code-block"><code>02\n写 .env.local &amp; 核对</code></pre></div></div></div></article></body></html>';
const changed=source.replace("Introduction","Updated introduction");

describe("known tool renderer's paragraph text slots",()=>{
  it("projects a code-only instruction into one paragraph while retaining exact original blocks",()=>{
    const result=projectHtmlToolCodeText(source,changed);
    expect(result.projectedToolCardIds).toEqual(["slide-64"]);
    expect(result.html).toBe(changed.replace('</code></pre>','</code></pre><p>02\n写 .env.local &amp; 核对</p>'));
    expect(htmlNativeCodeRetention(source,result.html)).toMatchObject({retained:true,exactCount:2});
    // One paragraph keeps the generic-step branch; two would switch all cards to the rich-tool layout.
    expect(result.html).not.toContain('<p>02</p><p>写');
    expect(projectHtmlToolCodeText(source,result.html)).toEqual({html:result.html,projectedToolCardIds:[]});
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
