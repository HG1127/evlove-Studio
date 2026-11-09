import {describe,it,expect} from "vitest";
import {pairedSourceQuotationIssues} from "./paired-source-quotations";
import {renderPairedSourceQuotationTemplate} from "./paired-source-quotation-template";
const own={sourceArtifactId:"s",sha256:"a".repeat(64),text:"Review is required. Approval is required.",complete:true as const};
const other={...own,sha256:"b".repeat(64),text:"Review is required. Approval is required. Removed statement."};
const claim={sourceArtifactId:own.sourceArtifactId,sha256:own.sha256,noteIndex:0,relation:"present" as const,quote:"Approval is required."};
const input=()=>({notes:["The mandatory control is [[q:0]]."],quotations:[{...claim}],subjectDocuments:[own],comparisonDocuments:[other]});
describe("explicit source citation templates",()=>{
 it("renders only an explicitly cited verified source without changing the raw template",()=>{
  const x=input(),before=structuredClone(x),r=renderPairedSourceQuotationTemplate(x);
  expect(r.issues).toEqual([]);expect(r.notes![0]).toContain(claim.quote);expect(x).toEqual(before);
  expect(pairedSourceQuotationIssues({...x,notes:r.notes!})).toEqual([]);
  expect(pairedSourceQuotationIssues(x)).toContainEqual({code:"quote-not-in-note",noteIndex:0});
 });
 it.each([
  ["No citation","missing-marker"],["[[q:0]] [[q:0]]","duplicate-marker"],
  ["[[q:1]]","invalid-marker"],["[[q:00]]","invalid-marker"],["[[q:-1]]","invalid-marker"],
  ["[[q:0x]]","invalid-marker"],["[[q:0]","invalid-marker"],
 ])("rejects %s without manufacturing a rendered note",(note,code)=>{
  const r=renderPairedSourceQuotationTemplate({...input(),notes:[note]});
  expect(r.issues).toContainEqual({code,noteIndex:0});expect(r.notes).toBeUndefined();
 });
 it("rejects a marker in a different note even if the actual quote also appears there",()=>{
  const x=input();x.notes=[claim.quote+" [[q:0]]","Uncited inference"];x.quotations[0]!.noteIndex=1;
  expect(renderPairedSourceQuotationTemplate(x).issues).toContainEqual({code:"cross-note-marker",noteIndex:0});
 });
 it.each(["foreign-source","unsupported-present","uncovered-note"])("retains v1 %s protection",code=>{
  const x=input();if(code==="foreign-source")x.quotations[0]!.sha256="c".repeat(64);
  if(code==="unsupported-present")x.quotations[0]!.quote="Unobserved permission";
  if(code==="uncovered-note")x.notes.push("Uncited assertion");
  expect(renderPairedSourceQuotationTemplate(x).issues).toContainEqual({code,noteIndex:code==="uncovered-note"?1:0});
 });
 it("renders a real literal absence with both identities and an explicit absence label",()=>{
  const x={...input(),quotations:[{...claim,relation:"absent" as const,quote:"Removed statement.",comparison:{sourceArtifactId:other.sourceArtifactId,sha256:other.sha256}}]};
  const r=renderPairedSourceQuotationTemplate(x);expect(r.issues).toEqual([]);
  expect(r.notes![0]).toContain("缺失；比较来源");expect(r.notes![0]).toContain(other.sha256);
  x.quotations[0]!.comparison.sha256="c".repeat(64);
  expect(renderPairedSourceQuotationTemplate(x).issues).toContainEqual({code:"unsupported-absence",noteIndex:0});
 });
 it("does not recursively interpret marker-looking text copied from the source",()=>{
  const x=input();x.quotations[0]!.quote="[[q:8]]";x.subjectDocuments=[{...own,text:"A literal [[q:8]] in source"}];
  const r=renderPairedSourceQuotationTemplate(x);expect(r.issues).toEqual([]);expect(r.notes![0]).toContain("「[[q:8]]」");
 });
});
