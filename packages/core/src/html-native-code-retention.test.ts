import {describe,expect,it} from "vitest";
import {assertHtmlOriginalCodeRetention,HtmlOriginalCodeRetentionError,htmlNativeCodeRetention} from "./html-native-code-retention";
const instructions="9. 保存检查结果。\n10. 记录失败原因。";
const html=(value:string,language="",anchor="slide-1")=>`<article id="${anchor}"><pre class="code-block"><code${language?` class="language-${language}"`:""}>${value}</code></pre></article>`;
describe("native preformatted original text retention",()=>{
  it("locates unmatched Original blocks without disclosing code or changing the native evidence shape",()=>{
    const original=html("first command","","slide-1")+html("npm install\nnpm run build","","slide-102");
    const subject=html("first command","","slide-1")+html("replacement command","","slide-102");
    try{assertHtmlOriginalCodeRetention(original,subject);throw Error("Expected rejection");}
    catch(error){
      expect(error).toBeInstanceOf(HtmlOriginalCodeRetentionError);
      expect(error).toMatchObject({missingBlocks:[{originalBlockIndex:3,tag:"pre",section:"slide-102"},{originalBlockIndex:4,tag:"code",section:"slide-102"}]});
      expect((error as HtmlOriginalCodeRetentionError).retention).toEqual(htmlNativeCodeRetention(original,subject));
      expect(Object.keys((error as HtmlOriginalCodeRetentionError).retention).sort()).toEqual(["exactCount","extendedInstructionCount","originalCount","policy","retained","retainedCount"].sort());
      expect(JSON.stringify(error)).not.toMatch(/npm install|replacement command|first command/);
    }
  });
  it("reports Original order for unmatched duplicates and preserves entity-equivalent text",()=>{
    const original='<pre id="original-a">same</pre><pre id="original-b">same</pre>';
    try{assertHtmlOriginalCodeRetention(original,'<pre id="subject-only">same</pre>');throw Error("Expected rejection");}
    catch(error){expect(error).toMatchObject({missingBlocks:[{originalBlockIndex:2,tag:"pre",section:"original-b"}]});}
    expect(assertHtmlOriginalCodeRetention('<pre>A &amp; B</pre>','<pre>A &#38; B</pre>')).toMatchObject({retained:true,exactCount:1});
    expect(new HtmlOriginalCodeRetentionError(htmlNativeCodeRetention(original,"" )).missingBlocks).toEqual([]);
  });
  it("uses the identical policy for construction assertions, retaining numbered prose compatibility",()=>{
    const original=html(instructions),subject=html(instructions+"\n补充说明：失败时保留现场。");
    expect(assertHtmlOriginalCodeRetention(original,subject)).toEqual(htmlNativeCodeRetention(original,subject));
    const command=html("npm install\nnpm run build"),extended=html("npm install\nnpm run build\n补充说明。");
    try{assertHtmlOriginalCodeRetention(command,extended);throw Error("Expected a retention rejection");}
    catch(error){
      expect(error).toBeInstanceOf(HtmlOriginalCodeRetentionError);
      expect(error).toMatchObject({code:"HTML_ORIGINAL_CODE_RETENTION_FAILED",retention:{originalCount:2,retainedCount:0,retained:false}});
      expect(JSON.stringify(error)).not.toContain("npm install");
    }
  });
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
