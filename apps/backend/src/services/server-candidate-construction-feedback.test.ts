// @vitest-environment node
import {describe,expect,it} from "vitest";
import {ExactEditAnchorError,HtmlSemanticLayoutError} from "@evolution/core";
import {serverCandidateConstructionCorrection} from "./server-candidate-construction-feedback";
describe("bounded pre-freeze construction feedback",()=>{
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
