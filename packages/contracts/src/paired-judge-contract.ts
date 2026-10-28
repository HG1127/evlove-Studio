import {z} from "zod";

export const PAIRED_JUDGE_POLICY="paired-two-order-v1" as const;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const score=z.number().int().min(0).max(100);
const ids=z.array(z.string().min(1)).min(1).max(100).refine(items=>new Set(items).size===items.length,"Duplicate identity");
const summary=z.object({
  accuracy:score,evidence:score,riskCoverage:score,completeness:score,safety:z.enum(["PASS","REVIEW","FAIL"]),
  criteria:z.array(z.object({criterionId:z.string().min(1),score,pass:z.boolean(),testCaseIds:z.array(z.string().min(1)).max(100)}).strict()).min(1).max(32),
}).strict().refine(value=>new Set(value.criteria.map(c=>c.criterionId)).size===value.criteria.length,"Duplicate criterion");

/** Runtime-owned record of both observations; never accept this object from the model. */
export const PairedJudgeContextSchema=z.object({
  protocol:z.literal(PAIRED_JUDGE_POLICY),missionId:z.string().min(1),candidateId:z.string().min(1),
  phase:z.enum(["visible","holdout"]),inputFingerprint:z.string().min(1).max(200),
  rubricFingerprint:z.string().min(1).max(200),suiteFingerprint:z.string().min(1).max(200),
  testCaseIds:ids,criterionIds:ids,
  bindings:z.array(z.object({sourceArtifactId:z.string().min(1),originalSha256:hash,candidateSha256:hash}).strict()).min(1).max(32)
    .refine(items=>new Set(items.map(item=>item.sourceArtifactId)).size===items.length,"Duplicate source binding"),
}).strict();
export const PairedJudgeReceiptSchema=PairedJudgeContextSchema.extend({
  scoringRouteFingerprint:z.string().min(1).max(200),
  samples:z.tuple([
    z.object({order:z.literal("original-first"),resultSha256:hash,original:summary,candidate:summary,controlOriginal:summary}).strict(),
    z.object({order:z.literal("candidate-first"),resultSha256:hash,original:summary,candidate:summary,controlOriginal:summary}).strict(),
  ]),
  limitations:z.array(z.string().min(1)).min(1).max(12),
}).strict().superRefine((value,ctx)=>{
  if(new Set(value.bindings.map(b=>b.sourceArtifactId)).size!==value.bindings.length)ctx.addIssue({code:"custom",path:["bindings"],message:"Duplicate source binding"});
  const expected=new Set(value.criterionIds),cases=new Set(value.testCaseIds);
  for(const [i,sample] of value.samples.entries())for(const arm of ["original","candidate","controlOriginal"] as const){
    const rows=sample[arm].criteria;
    if(rows.length!==expected.size||rows.some(row=>!expected.has(row.criterionId)||new Set(row.testCaseIds).size!==row.testCaseIds.length||row.testCaseIds.some(id=>!cases.has(id))))
      ctx.addIssue({code:"custom",path:["samples",i,arm],message:"Paired result identities differ from the issued scope"});
  }
});
export type PairedJudgeReceipt=z.infer<typeof PairedJudgeReceiptSchema>;
