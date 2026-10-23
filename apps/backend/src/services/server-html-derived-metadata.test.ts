// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {compileServerHtmlDerivedMetadata} from "./server-html-derived-metadata";
const {known,compile}=vi.hoisted(()=>({known:vi.fn(),compile:vi.fn()}));
vi.mock("@evolution/adapters/html-native-profile",()=>({isKnownHtmlNativeSubject:known,compileKnownHtmlDerivedMetadata:compile}));
beforeEach(()=>{known.mockReset();compile.mockReset();});
describe("pre-freeze derived HTML compilation",()=>{
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
});
