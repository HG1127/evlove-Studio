import {describe,expect,it} from "vitest";
import {CandidatePatchSchema,CandidateSchema} from "@evolution/contracts";
import {applyHtmlCandidatePatch,htmlElementRange,incompleteHtmlCandidatePatches} from "./html-candidate-patch";
const patch=(target:string,content:string,operation:"add"|"update"="update")=>CandidatePatchSchema.parse({id:"P",component:"prompt",target,content,operation,rationale:"More detailed steps"});
describe("exact HTML Candidate plan application",()=>{
  const source='<html><head><script>const fake="<article id=slide-1>";</script></head><body><section id="chapter"><article id="slide-1"><div>old<div>nested</div></div></article></section><footer>untouched</footer></body></html>';
  it("applies a full same-ID replacement while keeping all outside bytes",()=>{
    const replacement='<!-- edit --><article id="slide-1"><div>clear steps</div></article>';
    const result=applyHtmlCandidatePatch(source,patch("#slide-1",replacement));
    expect(result).toBe(source.replace('<article id="slide-1"><div>old<div>nested</div></div></article>',replacement));
  });
  it("adds a planned card inside the named chapter instead of after the page",()=>{
    const added='<article id="new-card">Terminology</article>';
    expect(applyHtmlCandidatePatch(source,patch("#chapter section",added,"add")))
      .toBe(source.replace('<section id="chapter">','<section id="chapter">\n'+added+'\n'));
  });
  it.each(["#missing","#chapter article","#slide-1 .unknown"])("rejects ambiguous or missing selector %s",target=>{
    expect(applyHtmlCandidatePatch(source,patch(target,'<article id="slide-1">change</article>'))).toBeUndefined();
  });
  it.each(['<article id="different">change</article>','<article id="slide-1">change</article><p>unscoped</p>','<article id="slide-1">unclosed'])("requires one complete replacement retaining the target ID",content=>expect(applyHtmlCandidatePatch(source,patch("#slide-1",content))).toBeUndefined());
  it("refuses duplicate source IDs and target wrappers used as an addition",()=>{
    expect(htmlElementRange(source.replace('</section>','<article id="slide-1">duplicate</article></section>'),"slide-1")).toBeUndefined();
    expect(applyHtmlCandidatePatch(source,patch("#chapter",'<section id="chapter">duplicate</section>',"add"))).toBeUndefined();
  });
  it("handles quoted greater-than signs and comments without changing range identity",()=>{
    const html='<!-- <div id="x">fake</div> --><div id="x" data-note="a>b"><div>nested</div></div>';
    const range=htmlElementRange(html,"x")!;
    expect(html.slice(range.start,range.end)).toBe('<div id="x" data-note="a>b"><div>nested</div></div>');
  });
  it("identifies an incomplete planner omission without rejecting a complete explanatory example",()=>{
    const partial=CandidateSchema.parse({id:"C",name:"Incomplete",change:"Clarify",patches:[patch("#slide-1",'<article id="slide-1">New explanation...（保持原有其余内容不变）...')]});
    const targets=[{id:"A",extension:"html",textContent:source}] as import("@evolution/contracts").SourceArtifact[];
    expect(incompleteHtmlCandidatePatches(partial,targets)).toEqual(["#slide-1"]);
    const complete={...partial,patches:[patch("#slide-1",'<article id="slide-1">教程：保持原有内容不变</article>')]};
    expect(incompleteHtmlCandidatePatches(complete,targets)).toEqual([]);
  });

});
