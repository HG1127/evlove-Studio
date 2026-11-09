import {z} from "zod";
export const PAIRED_SOURCE_FRAGMENT_POLICY="bound-rendered-source-fragments-v1" as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const SourceQuotationSelectionSchema=z.object({noteIndex:z.number().int().min(0).max(999),relation:z.enum(["present","absent"]),spanId:z.string().regex(/^q[a-f0-9]{24}$/)}).strict();
export const SourceQuotationSelectionsSchema=z.array(SourceQuotationSelectionSchema).max(96);
export const PairedSourceFragmentManifestSchema=z.object({
 policy:z.literal(PAIRED_SOURCE_FRAGMENT_POLICY),
 documents:z.array(z.object({sourceArtifactId:z.string().min(1).max(240),sha256:hash,bodyTextSha256:hash,bodyUtf16Length:z.number().int().positive(),
  fragments:z.array(z.object({id:z.string().regex(/^q[a-f0-9]{24}$/),start:z.number().int().nonnegative(),length:z.number().int().positive().max(4000),text:z.string().min(1).max(4000)}).strict()).min(1).max(20000),
 }).strict()).min(1).max(64),
}).strict().superRefine((manifest,ctx)=>{
 const documents=new Set<string>(),ids=new Set<string>();
 for(const [i,doc] of manifest.documents.entries()){
  const key=JSON.stringify([doc.sourceArtifactId,doc.sha256]);if(documents.has(key))ctx.addIssue({code:"custom",path:["documents",i],message:"Duplicate source identity"});documents.add(key);
  let offset=0;for(const [j,fragment] of doc.fragments.entries()){
   if(ids.has(fragment.id)||fragment.start!==offset||fragment.length!==fragment.text.length)ctx.addIssue({code:"custom",path:["documents",i,"fragments",j],message:"Duplicate fragment or incomplete ordered coverage"});ids.add(fragment.id);offset+=fragment.length;
  }
  if(offset!==doc.bodyUtf16Length)ctx.addIssue({code:"custom",path:["documents",i],message:"Body coverage length differs"});
 }
});
export type SourceQuotationSelection=z.infer<typeof SourceQuotationSelectionSchema>;
export type PairedSourceFragmentManifest=z.infer<typeof PairedSourceFragmentManifestSchema>;
const identity=z.object({sourceArtifactId:z.string().min(1),sha256:hash,bodyTextSha256:hash}).strict();
export const PairedSourceFragmentModelInputSchema=z.object({
 schemaVersion:z.literal("paired-judge-input-v2-source-fragments"),requestFingerprint:z.string().min(1).max(240),
 goal:z.string(),metrics:z.array(z.json()).max(100),acceptanceRubric:z.array(z.json()).min(1).max(32),testCases:z.array(z.json()).min(1).max(100),
 issuedCriterionCaseBindings:z.array(z.object({criterionId:z.string().min(1),testCaseIds:z.array(z.string().min(1)).min(1).max(100)}).strict()).min(1).max(32),
 sourceFragments:PairedSourceFragmentManifestSchema,sourceFragmentManifestSha256:hash,
 versions:z.array(z.object({slot:z.enum(["A","B","C"]),originalObservationPacketSha256:hash,observations:z.object({
  documents:z.object({originalObservationCount:z.number().int().nonnegative(),context:z.record(z.string(),z.json()).refine(v=>!("observations" in v)),
   bodyObservationViews:z.array(z.object({observationIndex:z.number().int().nonnegative(),attributes:z.record(z.string(),z.json()).refine(v=>!("output" in v)&&!("quotationSource" in v)),bodyReference:identity,prefix:z.string(),suffix:z.string()}).strict()),
   nonBodyObservations:z.array(z.object({observationIndex:z.number().int().nonnegative(),observation:z.json()}).strict()),
  }).strict(),runs:z.array(z.json()),files:z.array(z.json()).optional(),
 }).strict()}).strict()).length(3).refine(v=>new Set(v.map(s=>s.slot)).size===3),evaluatorInstruction:z.string(),
}).strict();
