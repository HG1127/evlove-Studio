import {HtmlCardParagraphEvidenceSchema,MeasuredCardParagraphChangesSchema,type TargetRunResult} from "@evolution/contracts";
import {inspectMeasuredNativeRun} from "./server-measured-native-review";

type Binding={sourceArtifactId:string;originalSha256:string;candidateSha256:string};
const normalize=(text:string)=>text.replace(/\s+/gu," ").trim();
/** Pure projection. Full raw-source paragraphs never bypass measured-body scope or the output budget. */
export function measuredCardParagraphChanges(candidateRuns:TargetRunResult[],originalRuns:TargetRunResult[],bindings:readonly Binding[],budget=16_000){
 if(!Number.isInteger(budget)||budget<0||budget>16_000)throw Error("Paragraph comparison budget must be an integer between zero and 16000 characters");
 const observations=[],omittedSourceArtifactIds=new Set<string>();let remaining=budget;
 const duplicateRuns=[candidateRuns,originalRuns].some(arm=>new Set(arm.map(r=>r.testCaseId)).size!==arm.length);
 for(const binding of bindings){
  if(duplicateRuns||bindings.filter(b=>b.sourceArtifactId===binding.sourceArtifactId).length!==1){omittedSourceArtifactIds.add(binding.sourceArtifactId);continue;}
  const original=originalRuns.filter(r=>!r.error&&r.verificationStatus==="verified").map(r=>inspectMeasuredNativeRun(r,[{
   sourceArtifactId:binding.sourceArtifactId,subjectSha256:binding.originalSha256,originalSha256:binding.originalSha256,
  }])).filter(r=>r?.complete);
  const candidates=candidateRuns.filter(r=>!r.error&&r.verificationStatus==="verified"&&r.artifactHash===binding.candidateSha256).flatMap(run=>{
   const parsed=HtmlCardParagraphEvidenceSchema.safeParse(run.htmlCardParagraphEvidence);
   const native=inspectMeasuredNativeRun(run,[{sourceArtifactId:binding.sourceArtifactId,subjectSha256:binding.candidateSha256,originalSha256:binding.originalSha256}]);
   if(!parsed.success||parsed.data.status!=="observed"||!native?.complete)return [];
   const e=parsed.data;
   if(e.sourceArtifactId!==binding.sourceArtifactId||e.original.sha256!==binding.originalSha256||e.candidate.sha256!==binding.candidateSha256
    ||e.originalCardCount!==native.proof.observation.original.inventory.cards||e.candidateCardCount!==native.proof.observation.subject.inventory.cards)return [];
   return [{e,native}];
  });
  // Multiple case wrappers may carry identical facts; conflicting facts are never favorably selected.
  if(!original.length||!candidates.length||new Set(original.map(r=>r!.document.textFingerprint)).size!==1
   ||new Set(candidates.map(r=>JSON.stringify(r.e))).size!==1||new Set(candidates.map(r=>r.native.document.textFingerprint)).size!==1){
   omittedSourceArtifactIds.add(binding.sourceArtifactId);continue;
  }
  const {e,native}=candidates[0]!,before=normalize(original[0]!.document.text),after=normalize(native.document.text);
  const value={sourceArtifactId:e.sourceArtifactId,original:e.original,candidate:e.candidate,scope:e.scope,
   originalCardCount:e.originalCardCount,candidateCardCount:e.candidateCardCount,
   changes:e.changes.map(row=>{
    const removed=row.removed.filter(text=>before.includes(normalize(text))),added=row.added.filter(text=>after.includes(normalize(text)));
    return {...row,removed,added,omittedRemovedCount:row.removed.length-removed.length,omittedAddedCount:row.added.length-added.length};
   })};
  const size=JSON.stringify(value).length;
  if(size>remaining){omittedSourceArtifactIds.add(binding.sourceArtifactId);continue;}
  remaining-=size;observations.push(value);
 }
 return MeasuredCardParagraphChangesSchema.parse({schemaVersion:"measured-card-paragraph-changes-v1",observations,omittedSourceArtifactIds:[...omittedSourceArtifactIds],
  limitations:["Static paragraph changes are bound to the verified physical Original/Candidate and complete measured bodies; scripts, styles and raw markup are excluded.",
   "A quoted paragraph's text occurs in the corresponding measured body; its individual rendered visibility or layout is not independently established.",
   "Removed/added paragraphs may represent an authorized rewrite or move, not automatic semantic loss, protected-scope failure or improvement. Apply the unchanged rubric and scope independently.",
   "Unmatched paragraph quotes are withheld with counts; missing, conflicting or over-budget source observations remain omitted, never an empty preservation PASS.",
   "This optional comparison applies only to HTML slide-card paragraphs; absence for other formats is not a product failure or missing required semantic evidence."]});
}
