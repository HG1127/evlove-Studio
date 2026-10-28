import {createHash} from "node:crypto";
import {IndependentFinalEvidenceSchema,TestCaseSchema} from "@evolution/contracts";
import {evidenceFingerprint,finalHoldoutPaperHash} from "@evolution/core";
import {acceptedPackageFixture} from "./accepted-package-fixture";
export const learningContextHash=(value:string)=>createHash("sha256").update(value).digest("hex");

/** Synthetic accepted bytes with forbidden-field sentinels; no actual SOP or final question. */
export function learningContextFixture(){
  const x=acceptedPackageFixture(false),p=x.project,c=x.current,source=p.sourceArtifacts[0]!,snap=c.artifactSnapshots[0]!;
  const html=(text:string)=>`<html><head><style>PRIVATE_STYLE_SENTINEL</style></head><body><article id="s1"><p>${text}</p><pre>const displayed = 1;</pre></article><script>PRIVATE_PROGRAM_SENTINEL</script></body></html>`;
  source.textContent=html("Original complete body");source.size=Buffer.byteLength(source.textContent);
  snap.content=html("Current complete body");snap.contentHash=learningContextHash(snap.content);
  snap.frozenArtifact={...snap.frozenArtifact!,sha256:snap.contentHash,snapshotHash:snap.contentHash,blobId:"server-candidate:"+snap.contentHash,size:Buffer.byteLength(snap.content)};
  x.blobs.set(snap.frozenArtifact.blobId,new Blob([snap.content],{type:"text/html"}));
  p.baselineRun.originalReferences=[{schemaVersion:"original-artifact-reference-v1",missionId:p.id,sourceArtifactId:source.id,blobId:source.id,sha256:learningContextHash(source.textContent),sizeBytes:source.size}];
  p.artifactAcceptance.frozenArtifacts=[snap.frozenArtifact];
  const suite=[TestCaseSchema.parse({id:"F1",title:"final",input:"FINAL_PRIVATE_QUESTION_SENTINEL",expected:["FINAL_PRIVATE_EXPECTED_SENTINEL"],hidden:true})];
  c.finalHoldoutPaperHash=finalHoldoutPaperHash(suite);const fp=evidenceFingerprint(p,c);
  p.validationRun.evidenceFingerprint=fp;p.artifactAcceptance.evidenceFingerprint=fp;
  p.validationRun.independentFinal=IndependentFinalEvidenceSchema.parse({...p.validationRun,inputFingerprint:fp,paperHash:c.finalHoldoutPaperHash,suite,
    runs:p.validationRun.runs.map(r=>({...r,testCaseId:"F1",output:"FINAL_PRIVATE_OUTPUT_SENTINEL"})),baselineRuns:p.validationRun.baselineRuns.map(r=>({...r,testCaseId:"F1"}))});
  p.validationRun.runs[0]!.trace=[{id:"raw",stage:"raw",summary:"raw synthetic trace",status:"pass",detail:"PRIVATE_TRACE_SENTINEL"}];
  return {...x,p};
}
