import {z} from "zod";

export const PAIRED_SOURCE_QUOTATION_POLICY="measured-source-quotations-v1" as const;
const identity={sourceArtifactId:z.string().min(1).max(240),sha256:z.string().regex(/^[a-f0-9]{64}$/)};
export const PairedSourceIdentitySchema=z.object(identity).strict();
/** A runtime projection of a complete observed document, never raw HTML or an AI reconstruction. */
export const PairedQuotationDocumentSchema=z.object({...identity,text:z.string().min(1),complete:z.literal(true)}).strict();
const quote={...identity,noteIndex:z.number().int().min(0).max(999),quote:z.string().min(1).max(4000)};
/** Absence is a literal comparison, not proof that every equivalent meaning or safe path is absent. */
export const PairedSourceQuotationSchema=z.discriminatedUnion("relation",[
 z.object({...quote,relation:z.literal("present")}).strict(),
 z.object({...quote,relation:z.literal("absent"),comparison:PairedSourceIdentitySchema}).strict(),
]);
export const PairedSourceQuotationsSchema=z.array(PairedSourceQuotationSchema).max(96);
/** Two complete order observations may be combined without dropping their original claims. */
export const PairedAggregatedSourceQuotationsSchema=z.array(PairedSourceQuotationSchema).max(192);
/** Offset is measured by the runtime before adding paragraph metadata to the observation wrapper. */
export const PairedQuotationObservationSchema=z.object({output:z.string(),quotationSource:z.object({...identity,
 start:z.number().int().nonnegative(),length:z.number().int().positive(),complete:z.literal(true),
}).strict()}).passthrough().refine(value=>value.quotationSource.start+value.quotationSource.length<=value.output.length,"Quotation range exceeds measured text");
export type PairedSourceQuotation=z.infer<typeof PairedSourceQuotationSchema>;
export type PairedQuotationDocument=z.infer<typeof PairedQuotationDocumentSchema>;
