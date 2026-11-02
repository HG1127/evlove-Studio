import {expect,it} from "vitest";
import {HtmlCardParagraphEvidenceSchema,type TargetRunResult} from "@evolution/contracts";
import {htmlNativeEvidenceFixture,pairedJudgeFixture} from "@evolution/testkit";
import {fastHash} from "@evolution/core";
import {measuredCardParagraphChanges as project} from "./measured-card-paragraph-changes";
import {serverPairedJudgeRequest} from "./server-paired-judge";

function body(run:TargetRunResult,text:string,sha:string){
 run.artifactHash=sha;run.nativeHtmlProof!.subjectSha256=sha;run.nativeHtmlProof!.observation.subject.sha256=sha;
 run.renderedDocumentEvidence!.artifactSha256=sha;run.renderedDocumentEvidence!.text=text;
 run.renderedDocumentEvidence!.textFingerprint=fastHash(text);run.nativeHtmlProof!.observation.subject.bodyTextFingerprint=fastHash(text);
 run.nativeHtmlProof!.observation.contentSearchQueries=[];
}
function fixture(){
 const original=htmlNativeEvidenceFixture(),candidate=htmlNativeEvidenceFixture(),before="Original required paragraph",after="Candidate helpful paragraph";
 const binding={sourceArtifactId:"source-html",originalSha256:"e".repeat(64),candidateSha256:"a".repeat(64)};
 body(original,before,binding.originalSha256);body(candidate,after,binding.candidateSha256);
 candidate.htmlCardParagraphEvidence=HtmlCardParagraphEvidenceSchema.parse({schemaVersion:"html-card-paragraph-evidence-v1",status:"observed",sourceArtifactId:binding.sourceArtifactId,
  original:{sha256:binding.originalSha256,sizeBytes:123},candidate:{sha256:binding.candidateSha256,sizeBytes:120},scope:"static-slide-paragraph-text-v1",originalCardCount:2,candidateCardCount:2,
  changes:[{cardId:"slide-2",originalCardPresent:true,candidateCardPresent:true,originalParagraphCount:2,candidateParagraphCount:2,
   removed:[before,"PRIVATE_HIDDEN_ORIGINAL"],added:[after,"PRIVATE_HIDDEN_CANDIDATE"],paragraphSequenceChanged:true}],
  limitations:["Synthetic static fixture, not actual evidence"],semanticAcceptanceEstablished:false,visibilityEstablished:false,authorizationEstablished:false});
 return {original,candidate,binding};
}
it("includes only text already present in its corresponding complete measured body",()=>{
 const x=fixture(),result=project([x.candidate],[x.original],[x.binding]);
 expect(result.observations).toHaveLength(1);expect(result.observations[0]!.changes[0]).toMatchObject({removed:["Original required paragraph"],added:["Candidate helpful paragraph"],omittedRemovedCount:1,omittedAddedCount:1});
 expect(JSON.stringify(result)).not.toContain("PRIVATE_HIDDEN");expect(result.omittedSourceArtifactIds).toEqual([]);
});
it.each(["source","original-sha","candidate-sha","artifact-sha","count","partial","error","unmeasured-body"])("omits %s rather than reusing foreign or incomplete evidence",kind=>{
 const x=fixture(),e=x.candidate.htmlCardParagraphEvidence!;if(e.status!=="observed")throw Error("fixture");
 if(kind==="source")e.sourceArtifactId="foreign";
 if(kind==="original-sha")e.original.sha256="f".repeat(64);
 if(kind==="candidate-sha")e.candidate.sha256="f".repeat(64);
 if(kind==="artifact-sha")x.candidate.artifactHash="f".repeat(64);
 if(kind==="count")e.candidateCardCount=999;
 if(kind==="partial")x.candidate.verificationStatus="partial";
 if(kind==="error")x.candidate.error="incomplete";
 if(kind==="unmeasured-body")x.candidate.renderedDocumentEvidence!.text+="forged";
 expect(project([x.candidate],[x.original],[x.binding])).toMatchObject({observations:[],omittedSourceArtifactIds:[x.binding.sourceArtifactId]});
});
it("requires complete Original text, never just the Candidate receipt",()=>{
 const x=fixture();expect(project([x.candidate],[],[x.binding]).observations).toEqual([]);
 Object.assign(x.original.renderedDocumentEvidence!,{complete:false});
 expect(project([x.candidate],[x.original],[x.binding]).observations).toEqual([]);
});
it("deduplicates identical case wrappers, but rejects conflicts and duplicate identities",()=>{
 const x=fixture(),second=structuredClone(x.candidate);second.testCaseId="other";second.nativeHtmlProof!.testCaseId="other";
 expect(project([x.candidate,second],[x.original],[x.binding]).observations).toHaveLength(1);
 if(second.htmlCardParagraphEvidence?.status!=="observed")throw Error("fixture");second.htmlCardParagraphEvidence.changes[0]!.added=[];
 expect(project([x.candidate,second],[x.original],[x.binding]).observations).toEqual([]);
 expect(project([x.candidate,x.candidate],[x.original],[x.binding]).observations).toEqual([]);
 expect(project([x.candidate],[x.original],[x.binding,x.binding])).toMatchObject({observations:[],omittedSourceArtifactIds:[x.binding.sourceArtifactId]});
});
it("omits whole over-budget comparisons instead of truncating to favorable changes",()=>{
 const x=fixture();expect(project([x.candidate],[x.original],[x.binding],1)).toMatchObject({observations:[],omittedSourceArtifactIds:[x.binding.sourceArtifactId]});
});
it("does not allow an invalid or expanded caller budget",()=>{
 const x=fixture();for(const budget of [NaN,Infinity,-1,16001])expect(()=>project([x.candidate],[x.original],[x.binding],budget)).toThrow();
});
it("supplies the same bound comparison context to both paired packets without oracle verdicts",()=>{
 const f=fixture(),x=pairedJudgeFixture(),sourceId=x.project.sourceArtifacts[0]!.id;
 for(const run of [f.original,f.candidate]){
  run.testCaseId="V1";run.nativeHtmlProof!.testCaseId="V1";run.nativeHtmlProof!.sourceArtifactId=sourceId;run.renderedDocumentEvidence!.sourceArtifactId=sourceId;
 }
 f.candidate.htmlCardParagraphEvidence!.sourceArtifactId=sourceId;
 x.project.baselineRun.originalReferences![0]!.sha256=f.binding.originalSha256;
 x.candidate.artifactSnapshots[0]!.frozenArtifact!.sha256=f.binding.candidateSha256;
 const request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,[f.candidate],[f.original],"visible");
 const before=request.versions.original.documents as {paragraphChanges:ReturnType<typeof project>};
 const after=request.versions.candidate.documents as {paragraphChanges:ReturnType<typeof project>};
 expect(before.paragraphChanges).toEqual(after.paragraphChanges);expect(after.paragraphChanges.observations).toHaveLength(1);
 expect(JSON.stringify(after.paragraphChanges)).not.toContain("PRIVATE_HIDDEN");expect(after.paragraphChanges).not.toHaveProperty("verdict");
});
