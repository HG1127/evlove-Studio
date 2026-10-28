import {z} from "zod";
import {HtmlRenderedDocumentEvidenceSchema} from "./html-native-observation-contract";

const id=z.string().min(1).max(200);
/** Read-only measured comparison text, never a mutation coordinate or a verdict. */
export const RepairBaselineDocumentSchema=HtmlRenderedDocumentEvidenceSchema.pick({
  sourceArtifactId:true,artifactSha256:true,textFingerprint:true,text:true,complete:true,excludes:true,
}).extend({testCaseIds:z.array(id).min(1).max(100),observedAt:z.iso.datetime()}).strict();

export const RepairBaselineDocumentsSchema=z.object({
  schemaVersion:z.literal("repair-baseline-documents-v1"),
  feedbackPhase:z.enum(["visible","ordinary-hidden"]),
  documents:z.array(RepairBaselineDocumentSchema).max(12),
  omittedSourceArtifactIds:z.array(id).max(100),
  limitations:z.array(z.string().min(1).max(1000)).min(1).max(8),
}).strict();
export type RepairBaselineDocuments=z.infer<typeof RepairBaselineDocumentsSchema>;
