import {z} from "zod";
export const HTML_CARD_PARAGRAPH_EVIDENCE_VERSION="html-card-paragraph-evidence-v1" as const;
const id=z.string().min(1).max(240),hash=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative();
const bytes=z.instanceof(Uint8Array).refine(b=>b.byteLength>0&&b.byteLength<=12_000_000);
export const HtmlCardParagraphComparisonRequestSchema=z.object({sourceArtifactId:id,
 original:z.object({sha256:hash,bytes}).strict(),candidate:z.object({sha256:hash,bytes}).strict(),
}).strict();
const reference=z.object({sha256:hash,sizeBytes:count.positive().max(12_000_000)}).strict();
const changes=z.array(z.object({cardId:id,originalCardPresent:z.boolean(),candidateCardPresent:z.boolean(),
 originalParagraphCount:count,candidateParagraphCount:count,
 removed:z.array(z.string().min(1).max(64_000)).max(4096),added:z.array(z.string().min(1).max(64_000)).max(4096),
 paragraphSequenceChanged:z.boolean(),
}).strict().refine(row=>row.removed.length<=row.originalParagraphCount&&row.added.length<=row.candidateParagraphCount
 &&(row.originalCardPresent||row.originalParagraphCount===0)&&(row.candidateCardPresent||row.candidateParagraphCount===0)
 &&(row.originalCardPresent||row.candidateCardPresent)
 &&(row.paragraphSequenceChanged||row.removed.length+row.added.length===0),"Inconsistent paragraph/card counts")).max(2048).refine(rows=>new Set(rows.map(r=>r.cardId)).size===rows.length);
export const HtmlCardParagraphEvidenceSchema=z.discriminatedUnion("status",[
 z.object({schemaVersion:z.literal(HTML_CARD_PARAGRAPH_EVIDENCE_VERSION),status:z.literal("observed"),sourceArtifactId:id,
  original:reference,candidate:reference,scope:z.literal("static-slide-paragraph-text-v1"),
  originalCardCount:count.positive(),candidateCardCount:count.positive(),changes,
  limitations:z.array(z.string().min(1)).min(1).max(12),
  semanticAcceptanceEstablished:z.literal(false),visibilityEstablished:z.literal(false),authorizationEstablished:z.literal(false),
 }).strict(),
 z.object({schemaVersion:z.literal(HTML_CARD_PARAGRAPH_EVIDENCE_VERSION),status:z.literal("unavailable"),sourceArtifactId:id,reason:z.string().min(1)}).strict(),
]);
export type HtmlCardParagraphEvidence=z.infer<typeof HtmlCardParagraphEvidenceSchema>;

/** Model-facing subset: quotes must already occur in their corresponding complete measured body. */
export const MeasuredCardParagraphChangesSchema=z.object({schemaVersion:z.literal("measured-card-paragraph-changes-v1"),
 observations:z.array(z.object({sourceArtifactId:id,original:reference,candidate:reference,scope:z.literal("static-slide-paragraph-text-v1"),
  originalCardCount:count.positive(),candidateCardCount:count.positive(),
  changes:z.array(z.object({cardId:id,originalCardPresent:z.boolean(),candidateCardPresent:z.boolean(),originalParagraphCount:count,candidateParagraphCount:count,
   removed:z.array(z.string().min(1).max(64_000)),added:z.array(z.string().min(1).max(64_000)),omittedRemovedCount:count,omittedAddedCount:count,paragraphSequenceChanged:z.boolean(),
  }).strict().refine(row=>row.removed.length+row.omittedRemovedCount<=row.originalParagraphCount
   &&row.added.length+row.omittedAddedCount<=row.candidateParagraphCount,"Inconsistent projected paragraph counts")).max(2048),
 }).strict()).max(32),omittedSourceArtifactIds:z.array(id).max(100),limitations:z.array(z.string().min(1)).min(1).max(12),
}).strict();
