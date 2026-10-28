// @vitest-environment node
import {describe,expect,it} from "vitest";
import {HTML_NATIVE_PROFILE_ID} from "@evolution/contracts";
import {htmlNativeCodeRetention,htmlNativeProgramIdentity} from "@evolution/core";
import {compileKnownHtmlDerivedMetadata,identifyHtmlNativeSubjects,isKnownHtmlNativeSubject,nativeHtmlSha256,type HtmlNativeProfile} from "./profile";

const original='<html><head><style>p{color:red}</style><script>const keep=true;</script></head><body><article class="slide-card" id="slide-1" data-search="old"><div class="slide-body"><p>old</p><pre>  exact code</pre></div></article></body></html>';
const subject=original.replace('<p>old</p>','<p>new_configuration</p>');
const identity=htmlNativeProgramIdentity(original,nativeHtmlSha256);
const profiles:HtmlNativeProfile[]=[{id:HTML_NATIVE_PROFILE_ID,programSignature:identity.signature,styleSignature:identity.styleSignature}];
describe("pure native renderer profile identification",()=>{
  it("projects an existing code-only tool instruction only under the bound renderer without changing its code",()=>{
    const card='<article class="slide-card" data-kind="tool" id="slide-64"><div class="slide-body"><div class="mini-grid"><div class="mini-card"><pre class="code-block"><code>05\n写 .env.local</code></pre></div></div></div></article>';
    const source=original.replace('</body>',card+'</body>'),next=source.replace('<p>old</p>','<p>Updated</p>');
    expect(compileKnownHtmlDerivedMetadata(source,next).html).toBe(next);
    const compiled=compileKnownHtmlDerivedMetadata(source,next,profiles);
    expect(compiled).toMatchObject({projectedToolCardIds:["slide-64"]});
    expect(compiled.html).toContain('<code>05\n写 .env.local</code></pre><p>05\n写 .env.local</p>');
    expect(identifyHtmlNativeSubjects(source,compiled.html,profiles)?.originalCodeBlocksRetained).toBe(true);
    expect(compileKnownHtmlDerivedMetadata(source,compiled.html,profiles).html).toBe(compiled.html);
  });
  it("rejects a known component's third paragraph before deriving or freezing bytes, while preserving unknown-renderer behavior",()=>{
    const component='<div class="content-block"><div class="text-lines"><p>非常适合</p><p>内部工具</p></div></div>';
    const source=original.replace("<p>old</p>",component),broken=source.replace("<p>内部工具</p>","<p>内部工具</p><p>完成检查</p>");
    expect(compileKnownHtmlDerivedMetadata(source,broken).html).toBe(broken);
    expect(()=>compileKnownHtmlDerivedMetadata(source,broken,profiles)).toThrow(/two-paragraph/);
    const corrected=source.replace(component,component+"<p>完成检查：记录负责人。</p>");
    expect(compileKnownHtmlDerivedMetadata(source,corrected,profiles).html).toContain("完成检查：记录负责人。");
  });
  it("preserves the code number but does not duplicate a bound fifth-step number in the derived display slot",()=>{
    const steps=[1,2,3,4].map(n=>`<div class="mini-card"><p>0${n}</p><p>Existing step ${n}</p></div>`).join("");
    const card='<article class="slide-card" data-kind="tool" id="slide-64"><div class="slide-body"><div class="mini-grid">'+steps+'<div class="mini-card"><pre class="code-block"><code>05\n写 .env.local</code></pre></div></div></div></article>';
    const source=original.replace('</body>',card+'</body>'),next=source.replace('<p>old</p>','<p>Updated</p>');
    const compiled=compileKnownHtmlDerivedMetadata(source,next,profiles);
    expect(compiled.html).toContain('<code>05\n写 .env.local</code></pre><p>写 .env.local</p>');
    expect(compiled.html).not.toContain('</code></pre><p>05');
    expect(identifyHtmlNativeSubjects(source,compiled.html,profiles)?.originalCodeBlocksRetained).toBe(true);
    expect(compileKnownHtmlDerivedMetadata(source,compiled.html,profiles).html).toBe(compiled.html);
  });
  it("leaves an unknown renderer unchanged rather than assuming its data-search attribute is executable coverage",()=>{
    expect(isKnownHtmlNativeSubject(subject)).toBe(false);
    expect(compileKnownHtmlDerivedMetadata(original,subject)).toEqual({html:subject,updatedIds:[],reflowedIds:[]});
    expect(identifyHtmlNativeSubjects(original,subject)).toBeUndefined();
  });
  it("recognizes matching program/style surfaces separately from semantic quality",()=>{
    expect(identifyHtmlNativeSubjects(original,subject,profiles)).toMatchObject({originalCodeBlocksRetained:true,protection:{scriptBlocksUnchanged:true,styleBlocksUnchanged:true}});
    const changed=subject.replace('  exact code',' altered example');
    expect(identifyHtmlNativeSubjects(original,changed,profiles)).toMatchObject({originalCodeBlocksRetained:false});
  });
  it.each(["script","style","image","template","frame"])("declines changed or unsupported %s surfaces",kind=>{
    let changed=subject;
    if(kind==="script")changed=changed.replace('keep=true','keep=false');
    if(kind==="style")changed=changed.replace('color:red','color:blue');
    if(kind==="image")changed=changed.replace('</body>','<img src="private.png"></body>');
    if(kind==="template")changed=changed.replace('</body>','<template>unknown</template></body>');
    if(kind==="frame")changed=changed.replace('</body>','<iframe></iframe></body>');
    expect(identifyHtmlNativeSubjects(original,changed,profiles)).toBeUndefined();
  });
  it("retains appended numbered prose without claiming its original full digest is unchanged",()=>{
    const source=original.replace("  exact code","9. 保存结果。\n10. 检查失败原因。");
    const next=source.replace("10. 检查失败原因。","10. 检查失败原因。\n补充说明：失败时保留现场。");
    const result=identifyHtmlNativeSubjects(source,next,profiles)!;
    expect(result.original.codeBlockDigests).not.toEqual(result.subject.codeBlockDigests);
    expect(result).toMatchObject({originalCodeBlocksRetained:true,codeBlockRetention:{exactCount:0,extendedInstructionCount:1}});
  });
  it("places appended body prose outside the original plain-language preformatted note before freezing",()=>{
    const source=original.replace('<pre>  exact code</pre>','<pre class="code-block"><code>下一步建议：准备需求模板与验收清单。</code></pre>');
    const next=source.replace('验收清单。</code>','验收清单。\n\n完成检查：保留结果，记录负责人和下一次重试条件。</code>');
    expect(htmlNativeCodeRetention(source,next).retained).toBe(false);
    expect(compileKnownHtmlDerivedMetadata(source,next).html).toBe(next);
    const compiled=compileKnownHtmlDerivedMetadata(source,next,profiles);
    expect(compiled.html).toContain('<pre class="code-block"><code>下一步建议：准备需求模板与验收清单。</code></pre><p>\n\n完成检查：保留结果，记录负责人和下一次重试条件。</p>');
    expect(htmlNativeCodeRetention(source,compiled.html)).toMatchObject({retained:true,exactCount:2,extendedInstructionCount:0});
    expect(compileKnownHtmlDerivedMetadata(source,compiled.html,profiles).html).toBe(compiled.html);
  });
});
