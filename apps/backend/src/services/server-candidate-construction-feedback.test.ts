// @vitest-environment node
import {describe,expect,it} from "vitest";
import {ExactEditAnchorError,HtmlOriginalCodeRetentionError,HtmlSemanticLayoutError,HtmlParagraphConstructionError,htmlNativeCodeRetention,assertHtmlOriginalCodeRetention} from "@evolution/core";
import {serverCandidateConstructionCorrection} from "./server-candidate-construction-feedback";
describe("bounded pre-freeze construction feedback",()=>{
  it("exposes a declared static paragraph budget without accepting forged errors or granting an evaluation repair",()=>{
    const error=new HtmlParagraphConstructionError([{section:"slide-64",role:"introductory",chars:1112,maxChars:240}]);
    expect(serverCandidateConstructionCorrection(error,[])).toMatchObject({code:error.code,issues:error.issues,policy:error.policy,invalidProposal:[]});
    expect(serverCandidateConstructionCorrection({...error},[])).toBeUndefined();
  });
  it("uses measured retention counts without marking actual validation failures as construction errors",()=>{
    const report=htmlNativeCodeRetention('<pre>npm install</pre>','<pre>npm install\n完成检查。</pre>');
    expect(serverCandidateConstructionCorrection(new HtmlOriginalCodeRetentionError(report),[])).toMatchObject({code:"HTML_ORIGINAL_CODE_RETENTION_FAILED",retention:report,invalidProposal:[]});
    expect(serverCandidateConstructionCorrection({code:"HTML_ORIGINAL_CODE_RETENTION_FAILED",retention:report},[])).toBeUndefined();
  });
  it("bounds measured Original location hints without sending code or pretending they are current-parent anchors",()=>{
    const original=Array.from({length:23},(_,i)=>`<pre id="slide-${i+1}">private-command-${i}</pre>`).join("");
    let error:unknown;try{assertHtmlOriginalCodeRetention(original,"");}catch(measured){error=measured;}
    const correction=serverCandidateConstructionCorrection(error,[]);
    expect(correction).toMatchObject({code:"HTML_ORIGINAL_CODE_RETENTION_FAILED",omittedMissingBlockCount:3,
      missingBlocks:Array.from({length:20},(_,i)=>({originalBlockIndex:i+1,tag:"pre",section:`slide-${i+1}`}))});
    expect(correction?.instruction).toContain("NOT current-parent byte offsets or issued anchor IDs");
    expect(JSON.stringify(correction)).not.toContain("private-command");
    expect(serverCandidateConstructionCorrection({...error as object},[])).toBeUndefined();
  });
  it("returns only bound structural facts for a same-proposal correction",()=>{
    const error=new HtmlSemanticLayoutError([{section:"slide-11",label:"非常适合",expectedParagraphs:2,actualParagraphs:3,code:"paragraph-count-changed"}]);
    const correction=serverCandidateConstructionCorrection(error,[]);
    expect(correction).toMatchObject({code:"HTML_SEMANTIC_LAYOUT_INVALID",omittedIssueCount:0,issues:error.issues,invalidProposal:[]});
    expect(correction?.instruction).toContain("No file was written");
    expect(serverCandidateConstructionCorrection(new ExactEditAnchorError(2,"bad anchor"),[])).toMatchObject({code:"TEXT_EDIT_ANCHOR_INVALID",editIndex:2});
  });
  it("never treats actual evaluation, provider or arbitrary errors as a free construction retry",()=>{
    for(const error of [Error("Visible protection failed"),{code:"PROVIDER_TIMEOUT"},{code:"HTML_SEMANTIC_LAYOUT_INVALID",issues:[]}])
      expect(serverCandidateConstructionCorrection(error,[])).toBeUndefined();
  });
});
