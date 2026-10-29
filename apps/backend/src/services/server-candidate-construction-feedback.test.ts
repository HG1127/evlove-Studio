// @vitest-environment node
import {describe,expect,it} from "vitest";
import {ExactEditAnchorError,HtmlOriginalCodeRetentionError,HtmlSemanticLayoutError,HtmlParagraphConstructionError,HtmlNumberedListConstructionError,HtmlRendererStepNumberError,assertHtmlNumberedListConstruction,htmlNativeCodeRetention,assertHtmlOriginalCodeRetention} from "@evolution/core";
import {serverCandidateConstructionCorrection} from "./server-candidate-construction-feedback";
import {ServerHtmlConstructionPreflightError} from "./server-html-construction-preflight";
describe("bounded pre-freeze construction feedback",()=>{
  it("bounds renderer-number feedback without source prose or granting an extra correction",()=>{
    const error=new HtmlRendererStepNumberError(Array.from({length:23},(_,i)=>({section:"slide-64",gridIndex:1,cardIndex:i+1,label:"01",detailPrefix:"01"})));
    const correction=serverCandidateConstructionCorrection(error,[]);
    expect(correction).toMatchObject({code:error.code,issues:error.issues.slice(0,20),omittedIssueCount:3,invalidProposal:[]});
    expect(correction?.instruction).toContain("existing single pre-write");expect(correction?.instruction).toContain("Preserve the Original label");expect(correction?.instruction).toContain("not classified as new defects");
    expect(serverCandidateConstructionCorrection({...error},[])).toBeUndefined();
  });
  it("aggregates all five distinct static checks in the same existing correction",()=>{
    const errors=[new HtmlSemanticLayoutError([{section:"slide-11",label:"label",expectedParagraphs:2,code:"missing-or-ambiguous-component"}]),new HtmlOriginalCodeRetentionError(htmlNativeCodeRetention('<pre>original</pre>','<pre>changed</pre>')),new HtmlParagraphConstructionError([{section:"slide-64",role:"introductory",chars:300,maxChars:240}]),new HtmlNumberedListConstructionError([{section:"slide-64",listIndex:1,itemIndex:2,expectedNumber:2,observedNumber:3}]),new HtmlRendererStepNumberError([{section:"slide-64",gridIndex:1,cardIndex:1,label:"01",detailPrefix:"01"}])];
    const aggregate=new ServerHtmlConstructionPreflightError(errors.map(error=>({stage:"after-layout",error})));
    const result=serverCandidateConstructionCorrection(aggregate,[]);
    expect(result&&"violations" in result?result.violations:undefined).toHaveLength(5);
  });
  it("explains a nested list-item text replacement using numeric shapes without copying source bodies",()=>{
    const original='<article id="slide-84"><ul><li>1. PRIVATE_REQUIREMENT</li><li>2. PRIVATE_CHECK</li></ul></article>';
    let error:unknown;try{assertHtmlNumberedListConstruction(original,original.replace('1. PRIVATE_REQUIREMENT','<li>5. PRIVATE_RECOVERY</li>'));}catch(e){error=e;}
    const correction=serverCandidateConstructionCorrection(error,[]);
    expect(correction).toMatchObject({listContext:{numberHintsAreNotRenumberingTargets:true,groups:[{prefixNumbers:[null,5,2],originalSourceLists:[{prefixNumbers:[1,2]}]}]}});
    expect(JSON.stringify(correction)).not.toContain('PRIVATE_');
    expect(correction?.instruction).toContain('NOT a required new starting number');
    expect(correction?.instruction).toContain('existing enclosing tags remain');
  });
  it("sends both measured failures in one bounded correction and includes the invalid proposal only once",()=>{
    const layout=new HtmlSemanticLayoutError([{section:"slide-11",label:"非常适合",expectedParagraphs:2,code:"missing-or-ambiguous-component"}]);
    const retention=new HtmlOriginalCodeRetentionError(htmlNativeCodeRetention('<pre>private-command</pre>','<pre>changed</pre>'),[{originalBlockIndex:1,tag:"pre",section:"slide-64"}]);
    const error=new ServerHtmlConstructionPreflightError([{stage:"before-layout",error:layout},{stage:"before-layout",error:retention}]);
    const proposal=[{sourceArtifactId:"source",name:"guide.html",mimeType:"text/html",content:"ONLY-ONE-PROPOSAL",notes:[]}];
    const result=serverCandidateConstructionCorrection(error,proposal),wire=JSON.stringify(result);
    expect(result).toMatchObject({code:"HTML_CONSTRUCTION_PREFLIGHT_FAILED",invalidProposal:proposal,violations:[{stage:"before-layout",code:layout.code},{stage:"before-layout",code:retention.code,missingBlocks:retention.missingBlocks}]});
    expect(wire.split('ONLY-ONE-PROPOSAL')).toHaveLength(2);expect(wire).not.toContain('private-command');
    expect(result?.instruction).toContain('SAME single shared');expect(serverCandidateConstructionCorrection({...error},proposal)).toBeUndefined();
    expect(()=>new ServerHtmlConstructionPreflightError([{stage:"after-layout",error:layout}])).toThrow();
  });
  it("reports only bounded numbering locations, retaining the same single correction",()=>{
    const error=new HtmlNumberedListConstructionError(Array.from({length:23},(_,i)=>({section:"slide-87",listIndex:1,itemIndex:i+1,expectedNumber:i+1,observedNumber:8})));
    const result=serverCandidateConstructionCorrection(error,[]);expect(result).toMatchObject({code:error.code,omittedIssueCount:3,policy:error.policy});
    expect(result).toHaveProperty('issues',error.issues.slice(0,20));expect(result?.instruction).toContain('Do not delete checks');
    expect(serverCandidateConstructionCorrection({...error},[])).toBeUndefined();
  });
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
