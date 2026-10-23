import {describe,expect,it} from "vitest";
import {applyExactEdits} from "./exact-edits";
import {htmlRepairTextNodeContext,resolveHtmlTextNodeEdits} from "./html-text-node-edits";

const sha="a".repeat(64);
const html='<html><head><script>HEAD_PRIVATE</script></head><body><article id="c01" style="STYLE_PRIVATE" onclick="EVENT_PRIVATE">'
  +'<p>1. 写清楚用户、场景、目标。</p><p>2. 列出必须功能、暂不做功能、禁止事项。</p><p>相同说明</p><p>相同说明</p>'
  +'<p>值为 A &amp; B。</p></article><script>BODY_PRIVATE</script><style>CSS_PRIVATE</style><template>INERT_PRIVATE</template>'
  +'<article id="c11"><h2>最后一章</h2><p>完整配置收尾</p></article></body></html>';
const payload=(edits:Array<{anchorId:string;text:string}>,parentSha256=sha)=>JSON.stringify({kind:"html-text-node-edits",parentSha256,edits});

describe("frozen HTML body text edit anchors",()=>{
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
