// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {compileServerHtmlDerivedMetadata} from "./server-html-derived-metadata";
const {known,compile}=vi.hoisted(()=>({known:vi.fn(),compile:vi.fn()}));
vi.mock("@evolution/adapters/html-native-profile",()=>({isKnownHtmlNativeSubject:known,compileKnownHtmlDerivedMetadata:compile}));
beforeEach(()=>{known.mockReset();compile.mockReset();});
describe("pre-freeze derived HTML compilation",()=>{
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
