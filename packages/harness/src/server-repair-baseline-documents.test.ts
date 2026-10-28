import {describe,expect,it} from "vitest";
import {CandidateSchema,SourceArtifactSchema,TestCaseSchema} from "@evolution/contracts";
import {fastHash} from "@evolution/core";
import {acceptedPackageFixture,htmlNativeEvidenceFixture} from "@evolution/testkit";
import {measuredRepairBaselineDocuments} from "./server-repair-baseline-documents";

const now=Date.parse("2026-10-24T12:00:00.000Z");
function fixture(){
 const p=acceptedPackageFixture(false).project,run=htmlNativeEvidenceFixture(),sha=run.artifactHash!,sourceId=run.nativeHtmlProof!.sourceArtifactId;
 const source=SourceArtifactSchema.parse({id:sourceId,name:"source.html",mimeType:"text/html",extension:"html",role:"target",artifactKind:"document",inputMode:"upload",size:100,parseStatus:"ready",textContent:'<script>PRIVATE_PROGRAM</script><style>PRIVATE_STYLE</style>',createdAt:"2026-10-23T12:00:00.000Z"});
 const candidate=CandidateSchema.parse({id:"repair-parent",name:"parent",change:"clarify",artifactSnapshots:[{id:"snapshot",sourceArtifactId:sourceId,name:source.name,mimeType:source.mimeType,content:"Current Candidate text",createdAt:source.createdAt}]});
 const test=TestCaseSchema.parse({id:run.testCaseId,title:"Visible",input:"Check actual wording",expected:["clear"],criterionIds:[]});
 Object.assign(p,{id:"repair-context",sourceArtifacts:[source],candidates:[candidate],evalSuite:[test]});
 const baseline={...p.baselineRun,status:"completed" as const,runs:[run],originalReferences:[{schemaVersion:"original-artifact-reference-v1" as const,missionId:p.id,sourceArtifactId:sourceId,blobId:"source-blob",sha256:sha,sizeBytes:100}]};
 p.baselineRun=baseline;p.experimentRun={...p.experimentRun,status:"completed",comparisonSuite:structuredClone([test]),comparisonBaseline:structuredClone(baseline),candidateResults:[{candidateId:candidate.id,evaluation:p.validationRun.evaluation!,runs:[],artifactSnapshots:candidate.artifactSnapshots,experimentStage:"finalist"}]};
 const hidden=structuredClone(run);hidden.testCaseId="hidden-case";hidden.nativeHtmlProof!.testCaseId=hidden.testCaseId;
 p.hiddenEvalSuite=[TestCaseSchema.parse({...test,id:hidden.testCaseId,input:"PRIVATE_ORDINARY_QUESTION",hidden:true})];
 p.validationRun={...p.validationRun,candidateId:candidate.id,baselineRuns:[hidden],baselineSuiteIds:[hidden.testCaseId]};
 return {p,candidate,run,sourceId};
}
describe("measured repair Baseline body projection",()=>{
 it.each(["visible","hidden"] as const)("projects only the bound %s body and ordinary case IDs",phase=>{
  const x=fixture();Object.defineProperty(x.p,"finalHoldout",{get:()=>{throw Error("Independent final must never be read");}});
  Object.defineProperty(x.p.validationRun,"independentFinal",{get:()=>{throw Error("Independent final must never be read");}});
  const out=measuredRepairBaselineDocuments(x.p,x.candidate,phase,{now});
  expect(out.documents).toHaveLength(1);expect(out.documents[0]).toMatchObject({sourceArtifactId:x.sourceId,artifactSha256:x.run.artifactHash,text:x.run.renderedDocumentEvidence!.text,complete:true});
  expect(out.documents[0]!.testCaseIds).toEqual([phase==="visible"?x.run.testCaseId:"hidden-case"]);
  expect(JSON.stringify(out)).not.toMatch(/PRIVATE_PROGRAM|PRIVATE_STYLE|PRIVATE_ORDINARY_QUESTION|anchorId|paragraphs/);
 });
 it.each(["foreign-mission","wrong-hash","duplicate-reference","wrong-source","changed-text","duplicate-case","changed-suite","wrong-candidate","future"] as const)("omits %s evidence",kind=>{
  const x=fixture(),baseline=x.p.experimentRun.comparisonBaseline!,run=baseline.runs[0]!;
  if(kind==="foreign-mission")baseline.originalReferences![0]!.missionId="another-mission";
  if(kind==="wrong-hash")baseline.originalReferences![0]!.sha256="f".repeat(64);
  if(kind==="duplicate-reference")baseline.originalReferences!.push(structuredClone(baseline.originalReferences![0]!));
  if(kind==="wrong-source"){run.nativeHtmlProof!.sourceArtifactId="foreign";run.renderedDocumentEvidence!.sourceArtifactId="foreign";}
  if(kind==="changed-text")run.renderedDocumentEvidence!.text+=" forged";
  if(kind==="duplicate-case")baseline.runs.push(structuredClone(run));
  if(kind==="changed-suite")x.p.experimentRun.comparisonSuite![0]!.input="different question";
  if(kind==="wrong-candidate")x.p.experimentRun.candidateResults[0]!.candidateId="another-candidate";
  if(kind==="future")run.nativeHtmlProof!.observation.observedAt="2026-10-25T12:00:00.000Z";
  const out=measuredRepairBaselineDocuments(x.p,x.candidate,"visible",{now});
  expect(out.documents).toEqual([]);expect(out.omittedSourceArtifactIds).toEqual([x.sourceId]);
 });
 it.each(["wrong-case","incomplete-suite","foreign-candidate"] as const)("does not substitute %s ordinary Hidden evidence",kind=>{
  const x=fixture();
  if(kind==="wrong-case")x.p.validationRun.baselineRuns=[x.run];
  if(kind==="incomplete-suite")x.p.validationRun.baselineSuiteIds=[];
  if(kind==="foreign-candidate")x.p.validationRun.candidateId="another";
  expect(measuredRepairBaselineDocuments(x.p,x.candidate,"hidden",{now}).documents).toEqual([]);
 });
 it("groups equal bodies across distinct cases, but refuses conflicting bodies",()=>{
  const x=fixture(),base=x.p.experimentRun.comparisonBaseline!,second=structuredClone(base.runs[0]!);
  second.testCaseId="second";second.nativeHtmlProof!.testCaseId="second";base.runs.push(second);
  const test=TestCaseSchema.parse({...x.p.evalSuite[0]!,id:"second"});x.p.evalSuite.push(test);x.p.experimentRun.comparisonSuite!.push(structuredClone(test));
  expect(measuredRepairBaselineDocuments(x.p,x.candidate,"visible",{now}).documents[0]!.testCaseIds).toEqual([x.run.testCaseId,"second"]);
  second.renderedDocumentEvidence!.text="A different observed body";second.renderedDocumentEvidence!.textFingerprint=fastHash(second.renderedDocumentEvidence!.text);
  second.nativeHtmlProof!.observation.subject.bodyTextFingerprint=second.renderedDocumentEvidence!.textFingerprint;
  expect(measuredRepairBaselineDocuments(x.p,x.candidate,"visible",{now}).documents).toEqual([]);
 });
 it("labels a complete body omitted instead of truncating it to fit",()=>{
  const x=fixture(),out=measuredRepairBaselineDocuments(x.p,x.candidate,"visible",{now,budget:1});
  expect(out.documents).toEqual([]);expect(out.omittedSourceArtifactIds).toEqual([x.sourceId]);
 });
});
