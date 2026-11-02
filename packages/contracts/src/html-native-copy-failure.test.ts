import {describe,expect,it} from "vitest";
import {HtmlNativeCheckSchema,HtmlNativeCopyFailureSchema} from "./html-native-observation-contract";

describe("native copy failure evidence",()=>{
  const detail={selector:".copy-slide[data-slide]",index:43,cardId:"slide-45",expectedSha256:"a".repeat(64),actualSha256:"b".repeat(64),
    expectedChars:10,actualChars:18,reason:"clipboard-not-written"};
  it("preserves legacy aggregate-only observations and retains new optional failure identities",()=>{
    const old={id:"all-copy-controls-write-real-clipboard",pass:false,tested:112,failed:1};
    expect(HtmlNativeCheckSchema.parse(old)).toEqual(old);
    expect(HtmlNativeCheckSchema.parse({...old,copyFailures:[detail]})).toEqual({...old,copyFailures:[detail]});
  });
  it.each(["plaintext","bad-hash","bad-index","bad-reason"])("rejects %s diagnostic boundaries",mode=>{
    const input={...detail,...(mode==="plaintext"?{actualText:"private clipboard"}:mode==="bad-hash"?{actualSha256:"bad"}:mode==="bad-index"?{index:-1}:{reason:"retry-until-pass"})};
    expect(HtmlNativeCopyFailureSchema.safeParse(input).success).toBe(false);
  });
});
