import {describe,expect,it} from "vitest";
import {htmlReadableBody} from "./html-readable-body";
describe("logical HTML body evidence",()=>{
  it("preserves heading, paragraph and card boundaries without leaking executable/style context",()=>{
    const html='<html><head><style>PRIVATE_HEAD</style></head><body><article id="slide-64"><h2>配置路径</h2>'
      +'<div class="content-block"><p>先创建项目。<br>再复制连接参数。</p></div>'
      +'<div class="mini-card"><strong>01 注册</strong><div class="text-lines"><p>填写邮箱并登录。</p></div></div>'
      +'<script>PRIVATE_SCRIPT</script><style>PRIVATE_STYLE</style><template>PRIVATE_TEMPLATE</template></article></body></html>';
    const review=htmlReadableBody(html)!;
    expect(review.text).toContain('[H2] 配置路径\n\n');
    expect(review.text).toContain('先创建项目。\n再复制连接参数。');
    expect(review.text).toContain('[CARD] 01 注册');expect(review.text).toContain('\n\n填写邮箱并登录。');
    expect(JSON.stringify(review)).not.toMatch(/PRIVATE_|<script|<style/);
    expect(review.facts.sectionsWithLargestIntroductions).toEqual([{section:"slide-64",introductoryChars:14,longestIntroductoryParagraph:14,cardCount:1,cardDetailChars:8}]);
  });
  it("exposes dense introductions and sparse card details as observations rather than invented failure thresholds",()=>{
    const html='<html><body><article id="s"><div class="content-block"><p>'+'配置说明'.repeat(400)+'</p></div>'
      +'<div class="mini-card"><p>注册登录</p></div><div class="mini-card"><p>复制 URL</p></div></article></body></html>';
    const review=htmlReadableBody(html)!;
    expect(review.facts.sectionsWithLargestIntroductions[0]).toMatchObject({section:"s",longestIntroductoryParagraph:1600,cardCount:2,cardDetailChars:10});
    expect(review.facts).not.toHaveProperty("pass");
  });
  it("keeps escaped tutorial examples as body text and refuses an unbounded fragment",()=>{
    expect(htmlReadableBody('<html><body><pre>&lt;script&gt;example&lt;/script&gt;\n  next line</pre></body></html>')?.text).toContain('<script>example</script>\n  next line');
    expect(htmlReadableBody('<p>fragment</p>')).toBeUndefined();
  });
});
