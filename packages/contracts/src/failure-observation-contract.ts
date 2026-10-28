import {z} from "zod";

export const FAILURE_OBSERVATION_CONTEXT_VERSION="visible-failure-observations-v1";
export const FAILURE_OBSERVATION_MAX_CHARS=160_000;
export const FailureObservationSourceSchema=z.object({
  schemaVersion:z.literal("visible-failure-source-v1"),missionId:z.string().min(1),missionSha256:z.string().regex(/^[a-f0-9]{64}$/),
  experimentRunId:z.string().min(1),candidateId:z.string().min(1),round:z.number().int().positive(),
  executionDeploymentSha:z.string().min(1).optional(),
}).strict();
export const FailureObservationSourcesSchema=z.array(FailureObservationSourceSchema).max(2).superRefine((refs,ctx)=>{
  const seen=new Set<string>();for(const ref of refs){const key=JSON.stringify([ref.missionId,ref.candidateId]);if(seen.has(key))ctx.addIssue({code:"custom",message:"Failure sources must have unique Mission/Candidate identities"});seen.add(key);}
});
export type FailureObservationSource=z.infer<typeof FailureObservationSourceSchema>;
export const FailureComparisonSchema=z.object({
  criterionId:z.string(),title:z.string(),minScore:z.number(),weight:z.number(),caseIds:z.array(z.string()).min(1),
  baselineScore:z.number(),candidateScore:z.number(),delta:z.number(),baselineMinimumPassed:z.boolean(),candidateMinimumPassed:z.boolean(),
}).strict();
export const FailureTextProjectionSchema=z.object({
  sourceArtifactId:z.string(),snapshotId:z.string().optional(),name:z.string(),mimeType:z.string(),
  physicalSha256:z.string().regex(/^[a-f0-9]{64}$/),representation:z.enum(["html-body-text","snapshot-text","parsed-source-text","unavailable"]),
  binding:z.enum(["verified-snapshot-text","verified-original-text","parsed-index","unavailable"]),
  content:z.string(),availableChars:z.number().int().nonnegative(),complete:z.boolean(),
}).strict();
export const VisibleFailureObservationsSchema=z.object({
  schemaVersion:z.literal(FAILURE_OBSERVATION_CONTEXT_VERSION),missionId:z.string().min(1),
  observations:z.array(z.object({source:FailureObservationSourceSchema,grade:z.literal("measured-visible-failure"),
    sourceGoal:z.string().max(10000),sourceCommand:z.string().max(10000),observedAt:z.number().positive(),
    executionEvidenceFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
    artifacts:z.array(z.object({sourceArtifactId:z.string(),snapshotId:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),originalSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1),
    comparisons:z.array(FailureComparisonSchema).min(1),failureCriterionIds:z.array(z.string()),unpairedCriterionIds:z.array(z.string()),completeUserGoalDelta:z.number().optional(),
    originalText:z.array(FailureTextProjectionSchema),candidateText:z.array(FailureTextProjectionSchema),
  }).strict()).min(1).max(2),limitations:z.array(z.string()),
}).strict().refine(value=>JSON.stringify(value).length<=FAILURE_OBSERVATION_MAX_CHARS,"Failure observation context exceeds capacity; no provider call is permitted");
export type VisibleFailureObservations=z.infer<typeof VisibleFailureObservationsSchema>;
export const FailureObservationUseSchema=z.object({schemaVersion:z.literal("failure-observation-use-v1"),grade:z.literal("provided-to-plan"),missionId:z.string(),round:z.number().int().positive(),at:z.string(),
  sources:FailureObservationSourcesSchema,contextFingerprint:z.string().min(1)}).strict();
export type FailureObservationUse=z.infer<typeof FailureObservationUseSchema>;
