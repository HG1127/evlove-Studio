import {z} from "zod";
import {PAIRED_SOURCE_FRAGMENT_POLICY,PairedQuotationObservationSchema,PairedSourceFragmentModelInputSchema,PairedSelectionEvaluationAiResultSchema,PairedEvaluationAiResultSchema,type PairedSourceFragmentPolicy,type PairedQuotationDocument,type PairedEvaluationAiResult} from "@evolution/contracts";
import {buildPairedSourceFragments,resolvePairedSourceSelections,type SourceSelectionIssue} from "@evolution/core";
const packet=z.object({documents:z.json(),runs:z.array(z.json()),files:z.array(z.json()).optional()}).strict();
const originalInput=z.object({schemaVersion:z.literal("paired-judge-input-v1"),requestFingerprint:z.string(),goal:z.string(),metrics:z.array(z.json()),acceptanceRubric:z.array(z.json()),testCases:z.array(z.json()),issuedCriterionCaseBindings:z.array(z.object({criterionId:z.string(),testCaseIds:z.array(z.string())}).strict()),versions:z.array(z.object({slot:z.enum(["A","B","C"]),observations:packet}).strict()).length(3),evaluatorInstruction:z.string()}).strict();
function orderedJson(value:unknown):unknown{
 if(Array.isArray(value))return value.map(orderedJson);
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,orderedJson(v)]));
 return value;
}
const canonical=(value:unknown)=>JSON.stringify(orderedJson(value));

/** A lossless, explicit model-wire projection. Native observations themselves are never rewritten. */
export function pairedSourceFragmentModelInput(raw:unknown,documents:readonly PairedQuotationDocument[],sha256:(text:string)=>string,policy:PairedSourceFragmentPolicy=PAIRED_SOURCE_FRAGMENT_POLICY){
 const input=originalInput.parse(raw),built=buildPairedSourceFragments(documents,sha256,policy),referenced=new Set<string>();
 const versions=input.versions.map(version=>{
  const original=z.object({observations:z.array(z.json())}).passthrough().parse(version.observations.documents),{observations,...context}=original;
  const bodyObservationViews=[],nonBodyObservations=[];
  for(const [observationIndex,row] of observations.entries()){
   if(!row||typeof row!=="object"||Array.isArray(row)||!("quotationSource" in row)){nonBodyObservations.push({observationIndex,observation:row});continue;}
   const parsed=PairedQuotationObservationSchema.parse(row),s=parsed.quotationSource;
   const doc=built.manifest.documents.find(d=>d.sourceArtifactId===s.sourceArtifactId&&d.sha256===s.sha256);if(!doc)throw Error("Body projection source is not issued");
   referenced.add(JSON.stringify([doc.sourceArtifactId,doc.sha256]));
   const text=parsed.output.slice(s.start,s.start+s.length);if(doc.fragments.map(f=>f.text).join("")!==text)throw Error("Body projection differs from complete measured source");
   const {output,quotationSource:_,...attributes}=parsed;void _;
   bodyObservationViews.push({observationIndex,attributes,bodyReference:{sourceArtifactId:doc.sourceArtifactId,sha256:doc.sha256,bodyTextSha256:doc.bodyTextSha256},prefix:output.slice(0,s.start),suffix:output.slice(s.start+s.length)});
  }
  return {...version,originalObservationPacketSha256:sha256(canonical(version.observations)),observations:{...version.observations,documents:{originalObservationCount:observations.length,context,bodyObservationViews,nonBodyObservations}}};
 });
 if(built.manifest.documents.some(d=>!referenced.has(JSON.stringify([d.sourceArtifactId,d.sha256]))))throw Error("Unissued source document in fragment dictionary");
 const projected=PairedSourceFragmentModelInputSchema.parse({...input,schemaVersion:"paired-judge-input-v2-source-fragments",sourceFragments:built.manifest,sourceFragmentManifestSha256:built.sha256,versions});
 if(canonical(restorePairedSourceFragmentModelInput(projected,sha256))!==canonical(input))throw Error("Source fragment projection is not lossless");
 return projected;
}

/** Used for mechanical coverage audits: restore the exact issued observation values, not a new measurement. */
export function restorePairedSourceFragmentModelInput(raw:unknown,sha256:(text:string)=>string){
 const input=PairedSourceFragmentModelInputSchema.parse(raw),referenced=new Set<string>();if(sha256(JSON.stringify(input.sourceFragments))!==input.sourceFragmentManifestSha256)throw Error("Source fragment manifest digest differs");
 const rebuilt=buildPairedSourceFragments(input.sourceFragments.documents.map(doc=>({sourceArtifactId:doc.sourceArtifactId,sha256:doc.sha256,text:doc.fragments.map(f=>f.text).join(""),complete:true})),sha256,input.sourceFragments.policy);
 if(JSON.stringify(input.sourceFragments)!==JSON.stringify(rebuilt.manifest))throw Error("Source fragment range or identity differs");
 const versions=input.versions.map(v=>{
  const d=v.observations.documents,rows=new Map<number,unknown>();
  for(const row of d.nonBodyObservations){if(rows.has(row.observationIndex))throw Error("Duplicate observation position");rows.set(row.observationIndex,row.observation);}
  for(const view of d.bodyObservationViews){
   if(rows.has(view.observationIndex))throw Error("Duplicate observation position");
   const source=input.sourceFragments.documents.find(doc=>doc.sourceArtifactId===view.bodyReference.sourceArtifactId&&doc.sha256===view.bodyReference.sha256&&doc.bodyTextSha256===view.bodyReference.bodyTextSha256);if(!source)throw Error("Source body reference differs");
   referenced.add(JSON.stringify([source.sourceArtifactId,source.sha256]));
   const text=source.fragments.map(f=>f.text).join("");
   rows.set(view.observationIndex,{...view.attributes,output:view.prefix+text+view.suffix,quotationSource:{sourceArtifactId:source.sourceArtifactId,sha256:source.sha256,start:view.prefix.length,length:text.length,complete:true}});
  }
  const ordered=[...rows.entries()].sort(([a],[b])=>a-b);if(ordered.length!==d.originalObservationCount||ordered.some(([index],position)=>index!==position))throw Error("Observation coverage has gaps or omissions");
  const observations={...v.observations,documents:{...d.context,observations:ordered.map(([,row])=>row)}};
  if(sha256(canonical(observations))!==v.originalObservationPacketSha256)throw Error("Original observation packet digest differs");
  return {slot:v.slot,observations};
 });
 if(input.sourceFragments.documents.some(d=>!referenced.has(JSON.stringify([d.sourceArtifactId,d.sha256]))))throw Error("Unissued source document in fragment dictionary");
 const {sourceFragments:_,sourceFragmentManifestSha256:__,...rest}=input;void _;void __;
 return originalInput.parse({...rest,schemaVersion:"paired-judge-input-v1",versions});
}

/** Call only after saving the new raw-selection DTO. No scores, notes or verdicts are changed. */
export function resolvePairedSelectionEvaluation(raw:unknown,original:readonly PairedQuotationDocument[],candidate:readonly PairedQuotationDocument[],order:0|1,sha256:(text:string)=>string,policy:PairedSourceFragmentPolicy=PAIRED_SOURCE_FRAGMENT_POLICY):{issues:Array<SourceSelectionIssue&{slot:string}>;value?:PairedEvaluationAiResult;manifestSha256:string}{
 const response=PairedSelectionEvaluationAiResultSchema.parse(raw),manifest=buildPairedSourceFragments([...original,...candidate],sha256,policy),issues:Array<SourceSelectionIssue&{slot:string}>=[];
 const versions=response.versions.map(v=>{
  const own=v.slot==="C"||(order===0?v.slot==="A":v.slot==="B"),resolved=resolvePairedSourceSelections({selections:v.result.sourceSelections,subjectDocuments:own?original:candidate,comparisonDocuments:own?candidate:original},sha256,policy);
  if(resolved.manifestSha256!==manifest.sha256)throw Error("Selection manifest identity differs");issues.push(...resolved.issues.map(issue=>({...issue,slot:v.slot})));
  const {sourceSelections:_,...result}=v.result;void _;return {slot:v.slot,result:{...result,sourceQuotations:resolved.quotations}};
 });
 return issues.length?{issues,manifestSha256:manifest.sha256}:{issues:[],value:PairedEvaluationAiResultSchema.parse({schemaVersion:"paired-evaluation-v1",requestFingerprint:response.requestFingerprint,versions}),manifestSha256:manifest.sha256};
}
