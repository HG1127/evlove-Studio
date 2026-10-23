import {describe,expect,it} from "vitest";
import {canonicalHtmlSearchIndexChanges,novelHtmlSearchQueries,synchronizeHtmlCardSearchIndex} from "./html-derived-search-index";
const original='<html><body><article class="slide-card" id="slide-64" data-search="original keywords"><div class="slide-body"><p>旧配置</p></div></article><script>KEEP_SCRIPT</script><style>KEEP_STYLE</style></body></html>';
describe("derived HTML search metadata",()=>{
  it("reserves new-content queries without consulting an independent paper or existing Judge scores",()=>{
    const subject=original.replace('旧配置','配置 NEXT_PUBLIC_SUPABASE_URL');
    expect(novelHtmlSearchQueries(original,subject)).toEqual([{cardId:"slide-64",query:"next_public_supabase_url"}]);
    expect(novelHtmlSearchQueries(original,original)).toEqual([]);
    const indexed=original.replace('original keywords','original keywords next_public_supabase_url');
    expect(novelHtmlSearchQueries(indexed,indexed.replace('旧配置','配置 NEXT_PUBLIC_SUPABASE_URL'))[0]?.query).not.toBe("next_public_supabase_url");
  });
  it("keeps prior keywords and indexes actual new body content without changing visible content or executable/style bytes",()=>{
    const subject=original.replace('旧配置','新增 NEXT_PUBLIC_SUPABASE_URL 与 service_role &amp; "value"');
    const result=synchronizeHtmlCardSearchIndex(original,subject);
    expect(result.updatedIds).toEqual(["slide-64"]);
    expect(result.html).toContain('data-search="original keywords 新增 next_public_supabase_url 与 service_role &amp; &quot;value&quot;"');
    expect(result.html).toContain('<p>新增 NEXT_PUBLIC_SUPABASE_URL 与 service_role &amp; "value"</p>');
    expect(result.html).toContain('<script>KEEP_SCRIPT</script><style>KEEP_STYLE</style>');
    expect(canonicalHtmlSearchIndexChanges(original,result.html)).toEqual({changedIds:["slide-64"],invalidIds:[]});
    expect(synchronizeHtmlCardSearchIndex(original,result.html).html).toBe(result.html);
  });
  it("does not accept removed old keywords, invented metadata or missing card identities",()=>{
    expect(canonicalHtmlSearchIndexChanges(original,original.replace('original keywords','invented'))).toEqual({changedIds:["slide-64"],invalidIds:["slide-64"]});
    expect(()=>synchronizeHtmlCardSearchIndex(original,original.replace('id="slide-64"','id="other"'))).toThrow(/missing/);
    expect(()=>synchronizeHtmlCardSearchIndex(original,original.replace(' data-search="original keywords"',''))).toThrow(/physical/);
  });
  it("never indexes executable/style blocks, template content or button labels",()=>{
    const subject=original.replace('旧配置','可读正文<script>SECRET_PROGRAM</script><style>SECRET_STYLE</style><template>INERT_SECRET</template><button>操作标签</button>');
    const {html}=synchronizeHtmlCardSearchIndex(original,subject);
    expect(html).toContain('data-search="original keywords 可读正文"');
  });
});
