import {describe,expect,it} from "vitest";
import {pairedSourceQuotationIssues} from "./paired-source-quotations";
const original={sourceArtifactId:"procedure",sha256:"a".repeat(64),text:"Review is required before launch. Completion is recorded after launch.",complete:true as const};
const changed={...original,sha256:"b".repeat(64),text:"Completion is required before launch. Do not bypass the required record."};
const present={sourceArtifactId:changed.sourceArtifactId,sha256:changed.sha256,relation:"present",noteIndex:0,quote:"Completion is required before launch."};
const check=(quotations:unknown,subjectDocuments=[changed],comparisonDocuments=[original],notes=["Completion is required before launch. Review is required before launch. Do not bypass the required record."])=>pairedSourceQuotationIssues({notes,quotations,subjectDocuments,comparisonDocuments});
describe("source-bound literal quotations",()=>{
 it("accepts same-source support without assigning or altering any Safety verdict",()=>expect(check([present])).toEqual([]));
 it("rejects a quote copied from the other slot even when the source ID matches",()=>expect(check([{...present,quote:"Review is required before launch."}])).toContainEqual({code:"unsupported-present",noteIndex:0}));
 it.each(["sha256","sourceArtifactId"])("rejects a foreign %s instead of accepting a nearby document",field=>expect(check([{...present,[field]:field==="sha256"?original.sha256:"other"}])).toContainEqual({code:"foreign-source",noteIndex:0}));
 it("accepts an explicitly absent span only with its complete bound comparison",()=>expect(check([{...present,relation:"absent",quote:"Review is required before launch.",comparison:{sourceArtifactId:original.sourceArtifactId,sha256:original.sha256}}])).toEqual([]));
 it.each(["still-present","missing-comparison","invented-quote","wrong-comparison-hash"])("rejects invalid absence: %s",kind=>{
  const claim={...present,relation:"absent",quote:kind==="still-present"?present.quote:kind==="invented-quote"?"Never observed anywhere":"Review is required before launch.",comparison:{sourceArtifactId:original.sourceArtifactId,sha256:kind==="wrong-comparison-hash"?"c".repeat(64):original.sha256}};
  expect(check([claim],undefined,kind==="missing-comparison"?[]:undefined)).toContainEqual({code:"unsupported-absence",noteIndex:0});
 });
 it("does not fuzzy-match away negation, punctuation, or letter case",()=>{
  for(const quote of ["bypass the required record!","do not bypass the required record.","Completion is not required before launch."])expect(check([{...present,quote}])).not.toEqual([]);
 });
 it("normalizes observed whitespace without inferring omitted words",()=>expect(check([{...present,quote:"Completion is\n required before launch."}])).toEqual([]));
 it("rejects a decorative valid-source quote unrelated to the referenced note",()=>expect(check([present],undefined,undefined,["Another source says review is optional."])).toContainEqual({code:"quote-not-in-note",noteIndex:0}));
 it("treats identical A/C source identity as equivalent support, without another vote",()=>expect(check([{...present,sha256:original.sha256,quote:"Review is required before launch."}],[original],[structuredClone(original)])).toEqual([]));
 it("rejects conflicting text for the same physical identity",()=>expect(check([present],[changed],[{...changed,text:"a different observation"}])).toContainEqual({code:"conflicting-document"}));
 it("requires explicit evidence coverage for every Safety note, without supplying fallback claims",()=>{
  expect(check(undefined)).toEqual([{code:"missing-claims"}]);
  expect(check([])).toContainEqual({code:"uncovered-note",noteIndex:0});
  expect(check([present],undefined,undefined,["first","second"])).toContainEqual({code:"uncovered-note",noteIndex:1});
  expect(check([{...present,noteIndex:5}])).toContainEqual({code:"invalid-note",noteIndex:5});
  expect(check([],undefined,undefined,[])).toContainEqual({code:"uncovered-note"});
 });
 it("requires complete observations and rejects extra model claim properties",()=>{
  expect(()=>check([present],[{...changed,complete:false} as never])).toThrow();
  expect(check([{...present,expectedSafety:"PASS"}])).toEqual([{code:"missing-claims"}]);
 });
});
