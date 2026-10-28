import {describe,expect,it} from "vitest";
import {HTML_BUILD_ANCHOR_SEMANTICS,HtmlBuildBodyContextSchema} from "./text-edit-contract";
const sha="a".repeat(64),context=()=>({schemaVersion:"html-build-body-context-v1",parentSha256:sha,
  anchors:[{anchorId:"ta_c-"+sha.slice(0,16),element:"p",section:"slide-1",before:"正文",start:10,end:12}],components:[]});
describe("complete body build context boundary",()=>{
  it("declares text-span semantics without adding defaults to a legacy context",()=>{
    expect(HtmlBuildBodyContextSchema.parse(context())).toEqual(context());
    const current={...context(),anchorSemantics:HTML_BUILD_ANCHOR_SEMANTICS};
    expect(HtmlBuildBodyContextSchema.parse(current)).toEqual(current);
    expect(HtmlBuildBodyContextSchema.safeParse({...current,anchorSemantics:"whole-element"}).success).toBe(false);
  });
  it("validates physical parent identity and exact source-text offset lengths",()=>{
    expect(HtmlBuildBodyContextSchema.parse(context())).toEqual(context());
    for(const mutate of [
      (x:ReturnType<typeof context>)=>{x.parentSha256="b".repeat(64);},
      (x:ReturnType<typeof context>)=>{x.anchors[0]!.end++;},
      (x:ReturnType<typeof context>)=>{x.anchors[0]!.anchorId="invented";},
      (x:ReturnType<typeof context>)=>{x.anchors[0]!.before="shorter than source span";},
      (x:ReturnType<typeof context>)=>{x.anchors=[];},
    ]){const x=context();mutate(x);expect(HtmlBuildBodyContextSchema.safeParse(x).success).toBe(false);}
    expect(HtmlBuildBodyContextSchema.safeParse({...context(),rawScripts:"not permitted"}).success).toBe(false);
  });
});
