// @vitest-environment node
import {it,expect} from "vitest";import {createHash} from "node:crypto";
import {pairedSourceFragmentModelInput,restorePairedSourceFragmentModelInput} from "./paired-source-fragment-input";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const original={sourceArtifactId:"s",sha256:"a".repeat(64),text:"First line.\n\nSecond line.\r\n",complete:true as const},candidate={...original,sha256:"b".repeat(64),text:original.text+"New line."};
function input(){const packet=(doc:typeof original)=>({documents:{observations:[{output:"Small trace",testCaseId:"T0"},{output:"prefix\n"+doc.text+"\nFACTS",quotationSource:{sourceArtifactId:doc.sourceArtifactId,sha256:doc.sha256,start:7,length:doc.text.length,complete:true},testCaseId:"T1"}],nativeObservations:[{nativeFact:"unchanged"}],paragraphChanges:[{observedFact:"unchanged"}],limitations:["No automatic verdict"]},runs:[{testCaseId:"T1",trace:["unchanged"]}],files:[{sourceArtifactId:doc.sourceArtifactId,sha256:doc.sha256}]});return {schemaVersion:"paired-judge-input-v1",requestFingerprint:"f:0",goal:"Do the task",metrics:[],acceptanceRubric:[{id:"C1",minScore:85}],testCases:[{id:"T1",criterionIds:["C1"]}],issuedCriterionCaseBindings:[{criterionId:"C1",testCaseIds:["T1"]}],versions:[{slot:"A",observations:packet(original)},{slot:"B",observations:packet(candidate)},{slot:"C",observations:packet(original)}],evaluatorInstruction:"Unchanged"};}
it("losslessly restores all bodies, metadata, facts, cases and slot mappings while sharing identical Original/C text",()=>{
 const before=input(),projected=pairedSourceFragmentModelInput(before,[original,candidate],sha);
 expect(projected.sourceFragments.documents).toHaveLength(2);expect(projected.schemaVersion).toBe("paired-judge-input-v2-source-fragments");
 expect(restorePairedSourceFragmentModelInput(projected,sha)).toEqual(before);
 expect(before.versions[0]!.observations.documents.observations[1]!.output).toContain(original.text);
});
it("rejects an unreferenced document rather than adding it to the external model context",()=>{expect(()=>pairedSourceFragmentModelInput(input(),[original,candidate,{...original,sourceArtifactId:"private-other-source"}],sha)).toThrow("Unissued");});
it("rejects an attested range which differs from its complete source body",()=>{expect(()=>pairedSourceFragmentModelInput(input(),[{...original,text:"Another body"},candidate],sha)).toThrow("differs");});
it("rejects a changed dictionary, body reference, omitted observation or duplicate slot",()=>{
 const p=pairedSourceFragmentModelInput(input(),[original,candidate],sha),changed=structuredClone(p);changed.sourceFragments.documents[0]!.fragments[0]!.text="Tampered";
 expect(()=>restorePairedSourceFragmentModelInput(changed,sha)).toThrow();
 const wrong=structuredClone(p);wrong.versions[0]!.observations.documents.bodyObservationViews[0]!.bodyReference.bodyTextSha256="c".repeat(64);expect(()=>restorePairedSourceFragmentModelInput(wrong,sha)).toThrow();
 const missing=structuredClone(p);missing.versions[0]!.observations.documents.nonBodyObservations=[];expect(()=>restorePairedSourceFragmentModelInput(missing,sha)).toThrow("gaps");
 const duplicate=structuredClone(p);duplicate.versions[1]!.slot="A";expect(()=>restorePairedSourceFragmentModelInput(duplicate,sha)).toThrow();
});
it("rejects omission of a trailing body even when Original/C still share its dictionary source",()=>{
 const p=pairedSourceFragmentModelInput(input(),[original,candidate],sha);
 p.versions[0]!.observations.documents.bodyObservationViews=[];
 expect(()=>restorePairedSourceFragmentModelInput(p,sha)).toThrow("coverage");
});
it("rejects omission of a trailing non-body observation",()=>{
 const before=input();before.versions[0]!.observations.documents.observations.push({output:"Trailing trace",testCaseId:"T2"});
 const p=pairedSourceFragmentModelInput(before,[original,candidate],sha);
 p.versions[0]!.observations.documents.nonBodyObservations.pop();
 expect(()=>restorePairedSourceFragmentModelInput(p,sha)).toThrow("coverage");
});
it("rejects lost native facts even when all observation positions remain",()=>{
 const p=pairedSourceFragmentModelInput(input(),[original,candidate],sha);
 p.versions[0]!.observations.documents.context.nativeObservations=[];
 expect(()=>restorePairedSourceFragmentModelInput(p,sha)).toThrow("digest");
});
it("restores compact selectors against the complete ordered manifest including later source documents",()=>{
 const before=input(),projected=pairedSourceFragmentModelInput(before,[original,candidate],sha,"manifest-local-source-fragments-v2");
 expect(projected.sourceFragments.policy).toBe("manifest-local-source-fragments-v2");
 expect(projected.sourceFragments.documents[1]!.fragments[0]!.id).toBe("d1s0");
 expect(restorePairedSourceFragmentModelInput(projected,sha)).toEqual(before);
});
