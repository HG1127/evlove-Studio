import {describe,expect,it} from "vitest";
import {htmlPlanningDocument} from "./html-planning-document";

describe("static HTML planning document",()=>{
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
