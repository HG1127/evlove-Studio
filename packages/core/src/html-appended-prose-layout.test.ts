import {parse,type DefaultTreeAdapterTypes} from "parse5";
import {describe,expect,it} from "vitest";
import {htmlNativeCodeRetention} from "./html-native-code-retention";
import {separateHtmlAppendedProse} from "./html-appended-prose-layout";

const note="下一步建议：准备需求模板与验收清单。",suffix="\n\n完成检查：保存结果，记录负责人和下次重试条件。";
const pre=(value:string,attrs="")=>'<pre class="code-block"><code'+attrs+'>'+value+'</code></pre>';
const card=(content:string,id="slide-1")=>'<article class="slide-card" id="'+id+'"><div class="slide-body">'+content+'</div></article>';
const html=(content:string)=>'<html lang="zh-CN"><head><style>p{color:red}</style><script>const protectedCode=true;</script></head><body>'+content+'</body></html>';
const visibleText=(value:string)=>{
  const text=(node:DefaultTreeAdapterTypes.Node):string=>node.nodeName==="#text"&&"value" in node?node.value:"childNodes" in node?node.childNodes.map(text).join(""):"";
  let body="";const visit=(node:DefaultTreeAdapterTypes.Node)=>{if("tagName" in node&&node.tagName==="body"){body=text(node);return;}if("childNodes" in node)node.childNodes.forEach(visit);};
  visit(parse(value));return body;
};

describe("lossless appended prose layout before freezing",()=>{
  it("preserves the exact original note bytes, all model words and document order",()=>{
    const original=html(card(pre(note))),subject=html(card(pre(note+suffix)));
    expect(htmlNativeCodeRetention(original,subject).retained).toBe(false);
    const compiled=separateHtmlAppendedProse(original,subject);
    expect(compiled).toEqual({html:html(card(pre(note)+"<p>"+suffix+"</p>")),reflowedIds:["slide-1"]});
    expect(visibleText(compiled.html)).toBe(visibleText(subject));
    expect(htmlNativeCodeRetention(original,compiled.html)).toMatchObject({retained:true,exactCount:2,extendedInstructionCount:0});
    expect(separateHtmlAppendedProse(original,compiled.html)).toEqual({html:compiled.html,reflowedIds:[]});
  });
  it("preserves entity text and applies multiple physical edits without shifting locations",()=>{
    const first=note.replace("模板","模板 &amp; 参数"),second="补充建议：保留可追溯的验证记录。";
    const original=html(card(pre(first))+card(pre(second),"slide-2"));
    const subject=html(card(pre(first+suffix))+card(pre(second+suffix),"slide-2"));
    const compiled=separateHtmlAppendedProse(original,subject);
    expect(compiled.reflowedIds).toHaveLength(2);expect(visibleText(compiled.html)).toBe(visibleText(subject));
    expect(compiled.html).toContain(pre(first));expect(compiled.html).toContain(pre(second));
    expect(htmlNativeCodeRetention(original,compiled.html)).toMatchObject({retained:true,exactCount:4});
  });
  it.each(["declared-language","declared-type","command","program-suffix","markup-suffix","rewritten-prefix","whitespace-prefix","numbered-list","english-suffix","nested-markup","changed-attributes"])("does not reinterpret %s as appended ordinary prose",kind=>{
    let before=pre(note),after=pre(note+suffix);
    if(kind==="declared-language"){before=pre(note,' class="language-js"');after=pre(note+suffix,' class="language-js"');}
    if(kind==="declared-type"){before=pre(note,' type="application/sql"');after=pre(note+suffix,' type="application/sql"');}
    if(kind==="command"){before=pre("npm install");after=pre("npm install"+suffix);}
    if(kind==="program-suffix")after=pre(note+"\n完成检查：const x=1;");
    if(kind==="markup-suffix")after=pre(note+"\n新增说明：&lt;script&gt;执行&lt;/script&gt;");
    if(kind==="rewritten-prefix")after=pre(note.replace("准备","删除")+suffix);
    if(kind==="whitespace-prefix")after=pre(" "+note+suffix);
    if(kind==="numbered-list"){before=pre("1. 保存结果。\n2. 核对内容。");after=pre("1. 保存结果。\n2. 核对内容。"+suffix);}
    if(kind==="english-suffix")after=pre(note+"\nRun the command again.");
    if(kind==="nested-markup")after=pre(note+"<span>"+suffix+"</span>");
    if(kind==="changed-attributes")after=pre(note+suffix,' id="new-control"');
    const original=html(card(before)),subject=html(card(after));
    expect(separateHtmlAppendedProse(original,subject)).toEqual({html:subject,reflowedIds:[]});
  });
  it.each(["missing-card","changed-count","duplicate-card","fragment","missing-body-end","outside-slide-body"])("leaves %s unavailable structure untouched",kind=>{
    let original=html(card(pre(note))),subject=html(card(pre(note+suffix)));
    if(kind==="missing-card")subject=subject.replace('id="slide-1"','id="slide-2"');
    if(kind==="changed-count")subject=html(card(pre("另一个说明。")+pre(note+suffix)));
    if(kind==="duplicate-card")subject=html(card(pre(note+suffix))+card(pre(note+suffix)));
    if(kind==="fragment"){original=pre(note);subject=pre(note+suffix);}
    if(kind==="missing-body-end")subject=subject.replace('</body>','');
    if(kind==="outside-slide-body"){original=html(pre(note));subject=html(pre(note+suffix));}
    expect(separateHtmlAppendedProse(original,subject)).toEqual({html:subject,reflowedIds:[]});
  });
  it.each(["pre-id","code-id","pre-event","editable","prompt-container"])("does not change %s copy/editor semantics",kind=>{
    let before=pre(note),after=pre(note+suffix);
    if(kind==="pre-id"){before=before.replace('<pre ','<pre id="copy-target" ');after=after.replace('<pre ','<pre id="copy-target" ');}
    if(kind==="code-id"){before=pre(note,' id="copy-target"');after=pre(note+suffix,' id="copy-target"');}
    if(kind==="pre-event"){before=before.replace('<pre ','<pre onclick="copyNote()" ');after=after.replace('<pre ','<pre onclick="copyNote()" ');}
    if(kind==="editable"){before='<div contenteditable="true">'+before+'</div>';after='<div contenteditable="true">'+after+'</div>';}
    if(kind==="prompt-container"){before='<div class="prompt-card">'+before+'</div>';after='<div class="prompt-card">'+after+'</div>';}
    const original=html(card(before)),subject=html(card(after));
    expect(separateHtmlAppendedProse(original,subject)).toEqual({html:subject,reflowedIds:[]});
  });
});
