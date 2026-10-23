import {describe,expect,it} from "vitest";
import {validateStructuredTextFormat} from "./structured-text-validation";

describe("independent structured text syntax",()=>{
  it.each([
    ["json",'{"ok":true}'],["jsonl",'{"id":1}\n{"id":2}\n'],
    ["yaml","version: 1\nitems:\n  - name: example\n"],["yml","default: &x {value: 1}\ncopy: *x\n"],
    ["xml",'<root xmlns="urn:example"><item value="1">&amp;</item></root>'],
    ["svg",'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'],
  ])("parses actual %s content",(extension,content)=>{
    expect(validateStructuredTextFormat({extension,content})).toContain("解析通过");
  });
  it.each([
    ["json",'{"ok":}'],["jsonl",'{"ok":true}\ninvalid'],
    ["yaml","items: [unterminated"],["yaml","same: 1\nsame: 2"],
    ["yaml","copy: *missing"],["xml","<root><item></root>"],
    ["xml","<x:root/>"],["xml",'<!DOCTYPE root SYSTEM "https://example.invalid/external"><root/>'],
    ["svg","<root/>"],
  ])("rejects malformed or unresolved %s",(extension,content)=>{
    expect(()=>validateStructuredTextFormat({extension,content})).toThrow();
  });
  it("does not execute or infer behavior from plain text",()=>{
    expect(validateStructuredTextFormat({extension:"py",content:"print('test')"})).toBeUndefined();
  });
});
