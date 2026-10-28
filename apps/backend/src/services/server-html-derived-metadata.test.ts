// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {compileServerHtmlDerivedMetadata} from "./server-html-derived-metadata";
import {assertHtmlKnownSemanticLayout} from "@evolution/core";
import {ServerHtmlConstructionPreflightError} from "./server-html-construction-preflight";
const {known,compile}=vi.hoisted(()=>({known:vi.fn(),compile:vi.fn()}));
vi.mock("@evolution/adapters/html-native-profile",()=>({isKnownHtmlNativeSubject:known,compileKnownHtmlDerivedMetadata:compile}));
beforeEach(()=>{known.mockReset();compile.mockReset();});
describe("pre-freeze derived HTML compilation",()=>{
  it("reports all currently observable static failures when layout compilation cannot complete",async()=>{
    const original='<html><body><article class="slide-card" id="slide-11"><div class="slide-body"><div class="content-block"><div class="text-lines"><p>非常适合</p><p>说明</p></div></div><pre><code>npm run build</code></pre><p>介绍</p><ul><li>1. Open</li><li>2. Phone</li><li>3. Console</li></ul></div></article></body></html>';
    const bad=original.replace('非常适合','changed label').replace('npm run build','npm run unsafe').replace('介绍','字'.repeat(300)).replace('2. Phone','3. Phone');
    known.mockReturnValue(true);compile.mockImplementation((source,subject)=>{assertHtmlKnownSemanticLayout(source,subject);throw Error('Unreachable');});
    try{await compileServerHtmlDerivedMetadata({extension:"html",content:bad,parentText:original,readOriginal:async()=>original});throw Error('Expected failure');}
    catch(error){expect(error).toBeInstanceOf(ServerHtmlConstructionPreflightError);expect((error as ServerHtmlConstructionPreflightError).failures.map(f=>[f.stage,f.error.code])).toEqual([
      ["before-layout","HTML_SEMANTIC_LAYOUT_INVALID"],["before-layout","HTML_ORIGINAL_CODE_RETENTION_FAILED"],
      ["before-layout","HTML_PARAGRAPH_CONSTRUCTION_BUDGET_EXCEEDED"],["before-layout","HTML_NUMBERED_LIST_INCOHERENT"],
    ]);}
  });
  it("aggregates final static checks after layout and propagates unexpected compiler failures unchanged",async()=>{
    const original='<html><body><article class="slide-card" id="slide-64"><div class="slide-body"><pre>npm run build</pre><p>介绍</p></div></article></body></html>',bad=original.replace('npm run build','unsafe').replace('介绍','字'.repeat(300));
    known.mockReturnValue(true);compile.mockReturnValue({html:bad,updatedIds:[]});
    await expect(compileServerHtmlDerivedMetadata({extension:"html",content:bad,parentText:original,readOriginal:async()=>original})).rejects.toMatchObject({code:"HTML_CONSTRUCTION_PREFLIGHT_FAILED",failures:[{stage:"after-layout",error:{code:"HTML_ORIGINAL_CODE_RETENTION_FAILED"}},{stage:"after-layout",error:{code:"HTML_PARAGRAPH_CONSTRUCTION_BUDGET_EXCEEDED"}}]});
    const unexpected=Error('compiler unavailable');compile.mockImplementation(()=>{throw unexpected;});
    await expect(compileServerHtmlDerivedMetadata({extension:"html",content:bad,parentText:original,readOriginal:async()=>original})).rejects.toBe(unexpected);
  });
  it("blocks changed instruction numbering at the common build/repair compiler without renumbering it",async()=>{
    const original='<html><body><article id="slide-87"><ul><li>1. Open</li><li>2. Phone</li><li>3. Console</li></ul></article></body></html>';
    const bad=original.replace('2. Phone','3. Console with recovery');known.mockReturnValue(true);compile.mockReturnValue({html:bad,updatedIds:[]});
    await expect(compileServerHtmlDerivedMetadata({extension:"html",content:bad,parentText:original,readOriginal:async()=>original})).rejects.toMatchObject({code:"HTML_NUMBERED_LIST_INCOHERENT"});
    const fixed=original.replace('2. Phone','2. Phone with recovery');compile.mockReturnValue({html:fixed,updatedIds:[]});
    const result=await compileServerHtmlDerivedMetadata({extension:"html",content:fixed,parentText:original,readOriginal:async()=>original});
    expect(result.content).toBe(fixed);expect(result.checks).toContainEqual(expect.stringContaining('不证明操作含义保留'));
  });
  it("rejects an oversized paragraph after compilation, while accepting redistributed short detail",async()=>{
    const original='<html><body><article class="slide-card" id="slide-64"><div class="slide-body"><p>介绍</p></div></article></body></html>';
    const proposed=original.replace('介绍','字'.repeat(1112));
    known.mockReturnValue(true);compile.mockReturnValue({html:proposed,updatedIds:[]});
    await expect(compileServerHtmlDerivedMetadata({extension:"html",content:proposed,parentText:original,readOriginal:async()=>original}))
      .rejects.toMatchObject({code:"HTML_PARAGRAPH_CONSTRUCTION_BUDGET_EXCEEDED",issues:[{section:"slide-64",chars:1112}]});
    compile.mockReturnValue({html:original.replace('介绍','简短介绍'),updatedIds:[]});
    expect((await compileServerHtmlDerivedMetadata({extension:"html",content:proposed,parentText:original,readOriginal:async()=>original})).checks)
      .toContainEqual(expect.stringContaining('静态长度检查'));
  });
  it("checks code retention after lossless layout compilation so supported prose separation still works",async()=>{
    const original='<html><body><pre>npm install</pre></body></html>';
    const proposed=original.replace('npm install','npm install\n完成检查。');
    const corrected=original.replace('</pre>','</pre><p>完成检查。</p>');
    known.mockReturnValue(true);compile.mockReturnValue({html:corrected,updatedIds:[],reflowedIds:["slide-1"]});
    const result=await compileServerHtmlDerivedMetadata({extension:"html",content:proposed,parentText:original,readOriginal:async()=>original});
    expect(result.content).toBe(corrected);expect(result.checks).toContainEqual(expect.stringContaining('1/1'));
    compile.mockReturnValue({html:proposed,updatedIds:[],reflowedIds:[]});
    await expect(compileServerHtmlDerivedMetadata({extension:"html",content:proposed,parentText:original,readOriginal:async()=>original})).rejects.toMatchObject({code:"HTML_ORIGINAL_CODE_RETENTION_FAILED"});
  });
  it("compiles an actual proposed change from the physical Original before its hash is frozen",async()=>{
    known.mockReturnValue(true);compile.mockReturnValue({html:"compiled-new-content",updatedIds:["slide-64"]});
    const readOriginal=vi.fn(async()=>"physical-original");
    const result=await compileServerHtmlDerivedMetadata({extension:"html",content:"model-changed-content",parentText:"parent",readOriginal});
    expect(compile).toHaveBeenCalledWith("physical-original","model-changed-content");
    expect(result.content).toBe("compiled-new-content");expect(result.checks[0]).toContain("1 个正文搜索索引");
  });
  it.each(["unchanged","unknown","other-format"])("does not turn %s inputs into a hidden mutation",async kind=>{
    known.mockReturnValue(kind!=="unknown");const readOriginal=vi.fn(async()=>"source");
    const result=await compileServerHtmlDerivedMetadata({extension:kind==="other-format"?"md":"html",content:kind==="unchanged"?"parent":"changed",parentText:"parent",readOriginal});
    expect(result.content).toBe(kind==="unchanged"?"parent":"changed");expect(readOriginal).not.toHaveBeenCalled();expect(compile).not.toHaveBeenCalled();
  });
  it("records a text-preserving layout change even when the existing search index is already current",async()=>{
    known.mockReturnValue(true);compile.mockReturnValue({html:"lossless-layout",updatedIds:[],reflowedIds:["slide-112"]});
    const result=await compileServerHtmlDerivedMetadata({extension:"html",content:"model-proposal",parentText:"parent",readOriginal:async()=>"original"});
    expect(result.content).toBe("lossless-layout");expect(result.checks).toEqual([expect.stringContaining("保持原块字节")]);
  });
});
