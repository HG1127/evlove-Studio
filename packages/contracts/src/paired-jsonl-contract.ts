import {z} from "zod";
import {PairedRelativeEvidenceStatusSchema} from "./paired-judge-contract";

export const PAIRED_JSONL_PROTOCOL="paired-evaluation-jsonl-v1" as const;
const id=z.string().min(1).max(240),slot=z.enum(["A","B","C"]);
const score=z.number().int().min(0).max(100),strings=z.array(z.string());
const ids=z.array(id).min(1).max(100).refine(v=>new Set(v).size===v.length);
export const PairedJsonlScopeSchema=z.object({requestFingerprint:id,
 bindings:z.array(z.object({criterionId:id,testCaseIds:ids}).strict()).min(1).max(32),
 relativeCriterionIds:z.array(id).min(1).max(32).refine(v=>new Set(v).size===v.length).optional(),
}).strict().refine(v=>new Set(v.bindings.map(b=>b.criterionId)).size===v.bindings.length)
 .refine(v=>v.relativeCriterionIds?.every(id=>v.bindings.some(b=>b.criterionId===id))??true);
const summary=z.object({accuracy:score,evidence:score,riskCoverage:score,completeness:score,
 safety:z.enum(["PASS","REVIEW","FAIL"]),notes:strings,failures:strings,
 cases:z.array(z.object({testCaseId:id,accuracy:score,evidence:score,completeness:score,reason:z.string()}).strict()).max(100),
}).strict();
const criterion=z.object({criterionId:id,score,pass:z.boolean(),evidence:strings,gaps:strings,testCaseIds:ids}).strict();
/** Explicit transport only. This is never a fallback for invalid JSON-object responses. */
export const PairedJsonlRecordSchema=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("header"),protocol:z.literal(PAIRED_JSONL_PROTOCOL),requestFingerprint:id}).strict(),
 z.object({kind:z.literal("summary"),slot,value:summary}).strict(),
 z.object({kind:z.literal("criterion"),slot,value:criterion}).strict(),
 z.object({kind:z.literal("end"),requestFingerprint:id,criterionRecords:z.number().int().min(3).max(96)}).strict(),
]);
/** Only an explicitly selected relative policy exposes the additive per-criterion evidence field. */
export const PairedJsonlReferenceRecordSchema=z.discriminatedUnion("kind",[
 PairedJsonlRecordSchema.options[0],PairedJsonlRecordSchema.options[1],
 z.object({kind:z.literal("criterion"),slot,value:criterion.extend({relativeEvidenceStatus:PairedRelativeEvidenceStatusSchema.optional()})}).strict(),
 PairedJsonlRecordSchema.options[3],
]);
export type PairedJsonlScope=z.infer<typeof PairedJsonlScopeSchema>;
