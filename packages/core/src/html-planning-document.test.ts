import {describe,expect,it} from "vitest";
import {htmlPlanningDocument,htmlPlanningDocumentWithLocators} from "./html-planning-document";

describe("static HTML planning document",()=>{
  it("supplies actual body tags, IDs and per-tag classes without programs or arbitrary attribute values",()=>{
    const html='<html><head><style class="PRIVATE_STYLE">private</style></head><body><section id="chapter"><article id="slide-1" class="slide-card slide-card"><h3>Guide</h3><button class="copy-page" onclick="PRIVATE_HANDLER" data-key="PRIVATE_ATTRIBUTE">Copy</button></article>'
      +'<article id="slide-2" class="slide-card"><h3>Next</h3><p id="duplicate">one</p><p id="duplicate">two</p></article></section><script id="PRIVATE_SCRIPT">private</script><svg id="PRIVATE_SVG"></svg><template class="PRIVATE_TEMPLATE"><p>private</p></template></body></html>';
    const doc=htmlPlanningDocumentWithLocators(html)!;
    expect(doc.outline.map(r=>({id:r.id,element:r.element}))).toEqual([{id:"slide-1",element:"article"},{id:"slide-2",element:"article"}]);
    expect(doc.locatorFacts.tagCounts).toContainEqual({element:"article",count:2});expect(doc.locatorFacts.tagCounts).toContainEqual({element:"section",count:1});
    expect(doc.locatorFacts.classCounts).toContainEqual({element:"article",className:"slide-card",count:2});
    expect(doc.locatorFacts.classCounts).toContainEqual({element:"button",className:"copy-page",count:1});
    expect(doc.locatorFacts.idElements.filter(n=>n.id==="duplicate")).toHaveLength(2);
    expect(JSON.stringify(doc)).not.toMatch(/PRIVATE_|onclick|data-key|runtimeVerified/);
    const legacy=htmlPlanningDocument(html)!;expect(legacy.text).toBe(doc.text);expect(legacy.outline[0]).not.toHaveProperty("element");expect(legacy).not.toHaveProperty("locatorFacts");
  });
  it("keeps heading fallback tags truthful and rejects oversized observations instead of silently dropping IDs",()=>{
    expect(htmlPlanningDocumentWithLocators('<html><body><h2 id="guide">Guide</h2></body></html>')?.outline).toEqual([{index:0,id:"guide",title:"Guide",element:"h2"}]);
    expect(()=>htmlPlanningDocumentWithLocators('<html><body>'+Array.from({length:16385},(_,i)=>`<p id="id-${i}">x</p>`).join("")+'</body></html>')).toThrow();
  });
  it("retains late chapters and original code examples, excluding actual programs/styles/attributes",()=>{
    const html='<html><head><style>PRIVATE_STYLE</style></head><body><article id="slide-1"><h3>环境准备</h3><p onclick="PRIVATE_HANDLER">普通说明</p></article>'
      +'<article id="slide-111"><h3>后续配置</h3><p>默认值、依赖和验证</p><pre>const example = 1;\nkeep spacing</pre></article><script>PRIVATE_SCRIPT</script><template>PRIVATE_TEMPLATE</template></body></html>';
    const result=htmlPlanningDocument(html)!;
    expect(result.outline).toEqual([{index:0,id:"slide-1",title:"环境准备"},{index:1,id:"slide-111",title:"后续配置"}]);
    expect(result.text).toContain("默认值、依赖和验证");expect(result.text).toContain("const example = 1;\nkeep spacing");
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SCRIPT|PRIVATE_STYLE|PRIVATE_HANDLER|PRIVATE_TEMPLATE/);
  });
  it("does not invent a heading for an article that contains only long prose",()=>{
    const result=htmlPlanningDocument('<html><body><article id="plain"><p>'+"text ".repeat(300)+'</p></article></body></html>')!;
    expect(result.outline).toEqual([{index:0,id:"plain",title:""}]);expect(result.text).toContain("text ".repeat(20));
    expect(htmlPlanningDocument('<html><p>missing physical body boundaries</p></html>')).toBeUndefined();
  });
});
