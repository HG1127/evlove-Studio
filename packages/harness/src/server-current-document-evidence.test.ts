import {describe,expect,it} from "vitest";
import type {EvolveProject,TestCase} from "@evolution/contracts";
import {currentHtmlDocumentTextObservation} from "./server-current-document-evidence";
const project={sourceArtifacts:[{id:"source",role:"target",extension:"html",artifactKind:"document",textContent:"original"}],
 acceptanceRubric:[{id:"CONTENT",artifactIds:["source"],validationMethod:"semantic-judge"}]} as unknown as EvolveProject;
const test={id:"T1",executionMode:"artifact-runtime",criterionIds:["CONTENT"]} as TestCase;
const context={id:"source",artifactSha256:"a".repeat(64),content:"完整原文：缺少重试说明。",originalChars:1000,projectionChars:12,truncated:false,
 contextRepresentation:"complete-html-static-text-projection",excludes:["scripts","styles","visual-fidelity","runtime-behavior"]};
describe("complete current HTML document observation",()=>{
 it("retains complete expanded bodies and refuses text beyond the bounded complete-review capacity",()=>{
  const content="配置说明".repeat(11000)+"TAIL_CONFIG";
  const row={...context,content,originalChars:200000,projectionChars:content.length};
  expect(currentHtmlDocumentTextObservation(project,test,[row])?.output).toContain("TAIL_CONFIG");
  expect(currentHtmlDocumentTextObservation(project,test,[{...row,content:"x".repeat(64001),projectionChars:64001}])).toBeUndefined();
 });
 it("proves only that complete document content was read, without making a passing judgement",()=>{
  const run=currentHtmlDocumentTextObservation(project,test,[context]);
  expect(run).toMatchObject({verificationStatus:"verified",artifactHash:context.artifactSha256});
  expect(run!.output).toContain("缺少重试说明");expect(run!.output).toContain("not a passing verdict");
 });
 it.each([{truncated:true},{artifactSha256:"invalid"},{contextRepresentation:"excerpt"},{excludes:[]},{projectionChars:1001}])("does not replace an incomplete or out-of-scope execution %j",change=>{
  expect(currentHtmlDocumentTextObservation(project,test,[{...context,...change}])).toBeUndefined();
 });
 it("refuses missing/duplicate sources and real browser or visual execution",()=>{
  expect(currentHtmlDocumentTextObservation(project,test,[])).toBeUndefined();
  expect(currentHtmlDocumentTextObservation(project,test,[context,context])).toBeUndefined();
  expect(currentHtmlDocumentTextObservation(project,{...test,executionMode:"external-runner"},[context])).toBeUndefined();
  expect(currentHtmlDocumentTextObservation(project,{...test,executionMode:"visual-review"},[context])).toBeUndefined();
 });
});
