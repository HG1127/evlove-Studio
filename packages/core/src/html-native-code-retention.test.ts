import {describe,expect,it} from "vitest";
import {htmlNativeCodeRetention} from "./html-native-code-retention";
const instructions="9. 保存检查结果。\n10. 记录失败原因。";
const html=(value:string,language="",anchor="slide-1")=>`<article id="${anchor}"><pre class="code-block"><code${language?` class="language-${language}"`:""}>${value}</code></pre></article>`;
describe("native preformatted original text retention",()=>{
  it("distinguishes an unchanged original from an appended instruction explanation",()=>{
    expect(htmlNativeCodeRetention(html(instructions),html(instructions))).toMatchObject({retained:true,originalCount:2,exactCount:2,extendedInstructionCount:0});
    expect(htmlNativeCodeRetention(html(instructions),html(instructions+"\n补充说明：失败时保留现场。"))).toMatchObject({retained:true,exactCount:0,extendedInstructionCount:2});
  });
  it.each([
    instructions.replace("保存","替换")+"\n补充说明。",instructions.replace("10. ","10.  ")+"\n补充说明。",
    "10. 记录失败原因。\n补充说明。",instructions+"\nconst x = 1;",instructions+"\n<script>run()</script>",
  ])("rejects a rewrite, whitespace loss, removed step or executable extension",value=>{
    expect(htmlNativeCodeRetention(html(instructions),html(value)).retained).toBe(false);
  });
  it("does not extend declared code or ordinary command examples",()=>{
    expect(htmlNativeCodeRetention(html(instructions,"js"),html(instructions+"\n补充说明。","js")).retained).toBe(false);
    expect(htmlNativeCodeRetention(html("npm install\nnpm run dev"),html("npm install\nnpm run dev\n补充说明。")).retained).toBe(false);
    expect(htmlNativeCodeRetention(html("1. Set x=1\n2. Run x();"),html("1. Set x=1\n2. Run x();\n补充说明。")).retained).toBe(false);
  });
  it("keeps document language separate from a programming language declaration",()=>{
    expect(htmlNativeCodeRetention('<html lang="zh-CN">'+html(instructions)+'</html>',
      '<html lang="zh-CN">'+html(instructions+"\n补充说明。")+'</html>')).toMatchObject({retained:true,extendedInstructionCount:2});
  });
  it("rejects moved extensions and reversed code block order",()=>{
    expect(htmlNativeCodeRetention(html(instructions),html(instructions+"\n补充说明。","","slide-2")).retained).toBe(false);
    expect(htmlNativeCodeRetention(html("first")+html("second"),html("second")+html("first")).retained).toBe(false);
  });
});
