import {describe,expect,it} from "vitest";
import {htmlRepairBodyContext} from "./html-repair-context";

describe("HTML repair body mutation context",()=>{
  it("retains exact safe body anchors while excluding head, executable blocks and style/event attributes",()=>{
    const anchor='<p id="details">原有配置说明。</p>';
    const html='<html><head><style>HEAD_STYLE_SECRET</style><script>HEAD_SCRIPT_SECRET</script></head><body>'
      +anchor+'<section style="INLINE_STYLE_SECRET" onclick="INLINE_SCRIPT_SECRET">保留正文</section>'
      +'<script>BODY_SCRIPT_SECRET</script><style>BODY_STYLE_SECRET</style><template><script>TEMPLATE_SCRIPT_SECRET</script><b>模板说明</b></template>'
      +'<a href="javascript:LINK_SCRIPT_SECRET">链接说明</a></body></html>';
    const context=htmlRepairBodyContext(html)!;
    expect(context).toContain(anchor);expect(context).toContain('保留正文');expect(context).toContain('模板说明');expect(context).toContain('链接说明');
    expect(context).not.toMatch(/HEAD_|BODY_SCRIPT|BODY_STYLE|INLINE_|TEMPLATE_SCRIPT|LINK_SCRIPT/);
  });
  it("keeps text/code examples that are escaped document content",()=>{
    const body='<pre>&lt;script&gt;documented example&lt;/script&gt;</pre>';
    expect(htmlRepairBodyContext('<html><body>'+body+'</body></html>')).toBe(body);
  });
  it.each(['<p>fragment only</p>','<body>unclosed','<html><head></head></html>'])("fails closed on missing physical body boundaries: %s",html=>{
    expect(htmlRepairBodyContext(html)).toBeUndefined();
  });
});
