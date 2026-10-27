import {describe,expect,it} from "vitest";
import {applyExactEdits} from "./exact-edits";
import {bindHtmlBuildBodyNodeEdits,bindHtmlBuildTextEditAnchors,htmlBuildBodyEditAnchors,htmlRepairTextNodeContext,resolveBoundHtmlBodyNodeEdits,resolveHtmlTextNodeEdits} from "./html-text-node-edits";

const sha="a".repeat(64);
const html='<html><head><script>HEAD_PRIVATE</script></head><body><article id="c01" style="STYLE_PRIVATE" onclick="EVENT_PRIVATE">'
  +'<p>1. 写清楚用户、场景、目标。</p><p>2. 列出必须功能、暂不做功能、禁止事项。</p><p>相同说明</p><p>相同说明</p>'
  +'<p>值为 A &amp; B。</p></article><script>BODY_PRIVATE</script><style>CSS_PRIVATE</style><template>INERT_PRIVATE</template>'
  +'<article id="c11"><h2>最后一章</h2><p>完整配置收尾</p></article></body></html>';
const payload=(edits:Array<{anchorId:string;text:string}>,parentSha256=sha)=>JSON.stringify({kind:"html-text-node-edits",parentSha256,edits});

describe("frozen HTML body text edit anchors",()=>{
  it("supplies complete exact builder anchors across duplicate text, entities and physical source offsets",()=>{
    const nodes=htmlBuildBodyEditAnchors(html,sha);
    expect(nodes).toHaveLength(htmlRepairTextNodeContext(html).length);
    expect(nodes.at(-1)?.before).toBe("完整配置收尾");expect(JSON.stringify(nodes)).not.toMatch(/PRIVATE|onclick|<script/);
    const entity=nodes.find(node=>node.before.includes("&amp;"))!;
    expect(html.slice(entity.start,entity.end)).toBe(entity.before);
    const duplicate=nodes.filter(node=>node.before==="相同说明")[1]!;
    const result=applyExactEdits(html,JSON.stringify({kind:"text-edits",edits:[{before:duplicate.before,start:duplicate.start,end:duplicate.end,after:"准确修改第二个位置"}]}),{strict:true});
    expect(result).toContain('<p>相同说明</p><p>准确修改第二个位置</p>');
    expect(()=>htmlBuildBodyEditAnchors("<p>fragment</p>",sha)).toThrow();
    expect(()=>htmlBuildBodyEditAnchors('<html><body>'+"<p>正文</p>".repeat(4097)+"</body></html>",sha)).toThrow();
  });
  it("binds parent selection on the server and refuses stale IDs or model-supplied parent fields",()=>{
    const node=htmlRepairTextNodeContext(html,sha)[0]!;
    const edits=[{anchorId:node.anchorId,text:"先填写配置项，再保存并检查。"}];
    const bound=JSON.stringify({kind:"html-body-node-edits-v1",edits});
    expect(applyExactEdits(html,resolveBoundHtmlBodyNodeEdits(html,bound,sha),{strict:true})).toContain("先填写配置项，再保存并检查。");
    expect(()=>resolveBoundHtmlBodyNodeEdits(html,bound,"b".repeat(64))).toThrow(/unknown/);
    expect(()=>resolveBoundHtmlBodyNodeEdits(html,JSON.stringify({kind:"html-body-node-edits-v1",parentSha256:sha,edits}),sha)).toThrow();
    const legacyNode=htmlRepairTextNodeContext(html)[0]!;
    expect(()=>resolveBoundHtmlBodyNodeEdits(html,JSON.stringify({kind:"html-body-node-edits-v1",edits:[{...edits[0]!,anchorId:legacyNode.anchorId}]}),sha)).toThrow(/unknown/);
  });
  it("provides the full body including the final chapter without raw protected bytes",()=>{
    const nodes=htmlRepairTextNodeContext(html);
    expect(nodes.at(-1)).toMatchObject({section:"c11",element:"p",text:"完整配置收尾"});
    expect(JSON.stringify(nodes)).not.toMatch(/PRIVATE|onclick|<script/);
    expect(nodes.find(node=>node.text.includes("A & B"))).toBeDefined();
  });
  it("resolves mixed rendered paragraphs, duplicate text and entity encoding against physical source positions",()=>{
    const nodes=htmlRepairTextNodeContext(html);
    const repeated=nodes.filter(node=>node.text==="相同说明");
    const edits=[nodes[0]!,repeated[1]!,nodes.find(node=>node.text.includes("A & B"))!]
      .map(node=>({anchorId:node.anchorId,text:node.text+" 输入项目名，保存后检查回读值。"}));
    const result=applyExactEdits(html,resolveHtmlTextNodeEdits(html,payload(edits),sha),{strict:true});
    expect(result).toContain('<p>相同说明</p><p>相同说明 输入项目名，保存后检查回读值。</p>');
    expect(result).toContain('值为 A &amp; B。 输入项目名');
    for(const protectedBytes of ['<script>BODY_PRIVATE</script>','<style>CSS_PRIVATE</style>','style="STYLE_PRIVATE" onclick="EVENT_PRIVATE"'])expect(result).toContain(protectedBytes);
  });
  it("escapes supplied markup so a body-text edit cannot inject scripts or attributes",()=>{
    const node=htmlRepairTextNodeContext(html)[0]!;
    const result=applyExactEdits(html,resolveHtmlTextNodeEdits(html,payload([{anchorId:node.anchorId,text:'<img src=x onerror=alert(1)> & value'}]),sha),{strict:true});
    expect(result).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; value');
    expect(result).not.toContain('<img');
  });
  it("rejects a different parent, unknown/duplicate anchors and no-op replacements",()=>{
    const node=htmlRepairTextNodeContext(html)[0]!;
    const edit={anchorId:node.anchorId,text:"具体配置步骤"};
    expect(()=>resolveHtmlTextNodeEdits(html,payload([edit],"b".repeat(64)),sha)).toThrow(/SHA/);
    expect(()=>resolveHtmlTextNodeEdits(html,payload([{...edit,anchorId:"invented"}]),sha)).toThrow(/unknown/);
    expect(()=>resolveHtmlTextNodeEdits(html,payload([edit,edit]),sha)).toThrow(/duplicated/);
    expect(()=>resolveHtmlTextNodeEdits(html,payload([{...edit,text:node.text}]),sha)).toThrow(/no actual/);
  });
  it("fails closed for missing body boundaries and excessive indexes without silently omitting chapters",()=>{
    expect(()=>htmlRepairTextNodeContext('<p>fragment</p>')).toThrow(/boundaries/);
    expect(()=>htmlRepairTextNodeContext('<html><body><p>unclosed')).toThrow(/boundaries/);
    expect(()=>htmlRepairTextNodeContext('<html><body>'+'<p>正文</p>'.repeat(4097)+'</body></html>')).toThrow(/capacity/);
  });
});

describe("issued HTML build text positions",()=>{
  const context=(source=html)=>({schemaVersion:"html-build-body-context-v1",parentSha256:sha,anchors:htmlBuildBodyEditAnchors(source,sha),components:[]});
  const edits=(before:string,after:string,positions={})=>JSON.stringify({kind:"text-edits",edits:[{before,after,...positions}]});
  it("binds only exact complete raw nodes, including entity and Unicode source positions",()=>{
    const source=html.replace('<article id="c01"','<article data-search="值为 A &amp; B。" id="c01"');
    const result=applyExactEdits(source,bindHtmlBuildTextEditAnchors(edits("值为 A &amp; B。","值为 A &amp; B。🚀"),context(source)),{strict:true});
    expect(result).toBe(source.replace('<p>值为 A &amp; B。</p>','<p>值为 A &amp; B。🚀</p>'));
  });
  it("does not guess among repeated real nodes, but preserves an explicit selection",()=>{
    const x=context(),repeated=x.anchors.filter(a=>a.before==="相同说明"),second=repeated[1]!;
    expect(()=>applyExactEdits(html,bindHtmlBuildTextEditAnchors(edits("相同说明","新的说明"),x),{strict:true})).toThrow(/不唯一/);
    const result=applyExactEdits(html,bindHtmlBuildTextEditAnchors(edits("相同说明","新的说明",{start:second.start,end:second.end}),x),{strict:true});
    expect(result).toContain('<p>相同说明</p><p>新的说明</p>');
  });
  it("does not overwrite supplied or partial positions with an inferred location",()=>{
    for(const positions of [{start:0,end:4},{start:0},{end:4}]){
      const wire=edits("相同说明","新的说明",positions);
      expect(JSON.parse(bindHtmlBuildTextEditAnchors(wire,context()))).toEqual(JSON.parse(wire));
      expect(()=>applyExactEdits(html,wire,{strict:true})).toThrow();
    }
  });
  it("leaves markup edits and non-issued text under the existing strict matching rules",()=>{
    for(const before of ['<p>完整配置收尾</p>',"HEAD_PRIVATE","不存在的正文","完整配置"]){
      const wire=edits(before,"更具体的说明");
      expect(JSON.parse(bindHtmlBuildTextEditAnchors(wire,context()))).toEqual(JSON.parse(wire));
    }
    const wire=edits('<p>完整配置收尾</p>','<p>完整配置收尾</p><p>新增说明</p>');
    expect(applyExactEdits(html,bindHtmlBuildTextEditAnchors(wire,context()),{strict:true})).toContain('<p>新增说明</p>');
  });
  it("rejects malformed or cross-parent issued indexes and invalid model edit payloads",()=>{
    const wire=edits("完整配置收尾","具体配置收尾");
    expect(()=>bindHtmlBuildTextEditAnchors(wire,{...context(),parentSha256:"b".repeat(64)})).toThrow();
    expect(()=>bindHtmlBuildTextEditAnchors(wire,{...context(),unissued:true})).toThrow();
    expect(()=>bindHtmlBuildTextEditAnchors('{"kind":"text-edits","edits":[]}',context())).toThrow();
    expect(()=>bindHtmlBuildTextEditAnchors("bad json",context())).toThrow();
  });
});

describe("issued build node IDs with unchanged raw replacement capability",()=>{
  const context={schemaVersion:"html-build-body-context-v1",parentSha256:sha,anchors:htmlBuildBodyEditAnchors(html,sha),components:[]};
  const wire=(edits:unknown[])=>JSON.stringify({kind:"html-build-body-node-edits-v1",edits});
  it("selects one repeated body node and retains all untouched physical bytes",()=>{
    const node=context.anchors.filter(a=>a.before==="相同说明")[1]!,after="相同说明</p><p><strong>新增参数</strong>：A &amp; B 🚀";
    const bound=bindHtmlBuildBodyNodeEdits(wire([{anchorId:node.anchorId,after}]),context);
    expect(JSON.parse(bound)).toEqual({kind:"text-edits",edits:[{before:node.before,after,start:node.start,end:node.end}]});
    expect(applyExactEdits(html,bound,{strict:true})).toBe(html.slice(0,node.start)+after+html.slice(node.end));
    expect(applyExactEdits(html,bound,{strict:true})).toContain('<p>相同说明</p><p>相同说明</p><p><strong>新增参数</strong>');
  });
  it("preserves entity bytes, Unicode and intentional unchanged Target selections",()=>{
    const node=context.anchors.find(a=>a.before.includes("&amp;"))!;
    const after=node.before+" <b>保存后核对 🚀</b>";
    expect(applyExactEdits(html,bindHtmlBuildBodyNodeEdits(wire([{anchorId:node.anchorId,after}]),context),{strict:true})).toContain(after);
    expect(applyExactEdits(html,bindHtmlBuildBodyNodeEdits(wire([{anchorId:node.anchorId,after:node.before}]),context),{strict:true})).toBe(html);
  });
  it("rejects invented, shortened, stale, duplicate and cross-parent node identities",()=>{
    const node=context.anchors[0]!,edit={anchorId:node.anchorId,after:"新的说明"};
    for(const anchorId of ["invented",node.anchorId.split("-")[0]!,node.anchorId.replace(sha.slice(0,16),"b".repeat(16))])expect(()=>bindHtmlBuildBodyNodeEdits(wire([{...edit,anchorId}]),context)).toThrow(/unknown/);
    expect(()=>bindHtmlBuildBodyNodeEdits(wire([edit,edit]),context)).toThrow(/duplicated/);
    expect(()=>bindHtmlBuildBodyNodeEdits(wire([edit]),{...context,parentSha256:"b".repeat(64)})).toThrow();
    expect(()=>bindHtmlBuildBodyNodeEdits(wire([edit]),{...context,anchors:[...context.anchors,context.anchors[0]]})).toThrow(/duplicate/);
  });
  it("refuses model-owned before/position/parent fields and leaves legacy protocols distinct",()=>{
    const edit={anchorId:context.anchors[0]!.anchorId,after:"新的说明"};
    for(const extra of [{before:"覆盖"},{start:0},{end:1},{parentSha256:sha}])expect(()=>bindHtmlBuildBodyNodeEdits(wire([{...edit,...extra}]),context)).toThrow();
    expect(()=>bindHtmlBuildBodyNodeEdits(JSON.stringify({kind:"html-build-body-node-edits-v1",parentSha256:sha,edits:[edit]}),context)).toThrow();
    expect(()=>bindHtmlBuildBodyNodeEdits(JSON.stringify({kind:"text-edits",edits:[{before:"相同说明",after:"新的说明"}]}),context)).toThrow();
  });
});
