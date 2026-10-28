import {z} from "zod";
import {AcceptanceCriterionSchema,CandidateSchema,EvaluationResultSchema,MetricSchema} from "./evolve-schemas";

export const LEARNING_CONTEXT_VERSION="lesson-distillation-context-v1";
export const LEARNING_CONTEXT_MAX_CHARS=256_000;
export const LearningArtifactContextSchema=z.object({
  sourceArtifactId:z.string().min(1),snapshotId:z.string().optional(),name:z.string(),mimeType:z.string(),
  representation:z.enum(["html-body-text","snapshot-text","parsed-source-text"]),
  binding:z.enum(["frozen-snapshot","snapshot-record","baseline-original-text","parsed-source"]),
  sha256:z.string().regex(/^[0-9a-f]{64}$/).optional(),contentHash:z.string().optional(),snapshotTextSha256:z.string().regex(/^[0-9a-f]{64}$/).optional(),
  content:z.string(),availableChars:z.number().int().nonnegative(),complete:z.boolean(),
}).strict();
export type LearningArtifactContext=z.infer<typeof LearningArtifactContextSchema>;
const nativeSummary=z.object({
  testCaseIds:z.array(z.string()),sourceArtifactId:z.string(),originalSha256:z.string(),subjectSha256:z.string(),kernelSha256:z.string(),
  programSignature:z.string(),styleSignature:z.string(),profilePass:z.boolean(),originalHealthy:z.boolean(),
  failedCheckCount:z.number().int().nonnegative(),
  styleComparison:z.array(z.object({width:z.number(),pass:z.boolean(),missingGroupCount:z.number(),changedNamedCount:z.number()}).strict()),
}).strict();
/** A dedicated egress DTO: no raw snapshots, patches, run objects or blind paper. */
export const LessonDistillationContextSchema=z.object({
  schemaVersion:z.literal(LEARNING_CONTEXT_VERSION),missionId:z.string().min(1),
  project:z.object({goal:z.string(),command:z.string(),protectedItems:z.array(z.string()),editableItems:z.array(z.string()),
    acceptanceRubric:z.array(AcceptanceCriterionSchema),metrics:z.array(MetricSchema)}).strict(),
  winner:CandidateSchema.pick({id:true,name:true,title:true,change:true,hypothesis:true,designRationale:true}).strict(),
  sourceArtifacts:z.array(LearningArtifactContextSchema),candidateArtifacts:z.array(LearningArtifactContextSchema),
  baseline:EvaluationResultSchema.optional(),
  validation:z.object({id:z.string(),candidateId:z.string(),status:z.string(),evidenceFingerprint:z.string().optional(),
    recommendation:z.string().optional(),evaluation:EvaluationResultSchema.optional(),baselineEvaluation:EvaluationResultSchema.optional()}).strict(),
  measuredDocuments:z.object({observations:z.array(z.object({testCaseId:z.string(),artifactHash:z.string().optional(),output:z.string()}).strict()),
    omittedTestCaseIds:z.array(z.string()),nativeSummaries:z.array(nativeSummary),omittedNativeTestCaseIds:z.array(z.string())}).strict(),
  release:z.object({status:z.string(),candidateId:z.string().optional(),deploymentId:z.string().optional(),healthy:z.boolean().optional(),
    evidenceMode:z.string().optional(),environment:z.string().optional(),observedAt:z.string().optional(),kpis:z.array(MetricSchema)}).strict(),
  releaseFreshness:z.object({status:z.enum(["fresh","stale","unknown"]),reason:z.string(),observedAt:z.string().optional(),ageMs:z.number().optional(),maxAgeMs:z.number()}).strict(),
  releaseTrend:z.object({status:z.enum(["stable-healthy","healthy-insufficient","degrading","flapping","stale","unknown"]),reason:z.string(),healthyStreak:z.number(),unhealthyStreak:z.number(),transitions:z.number(),observations:z.number()}).strict(),
  limitations:z.array(z.string()),
}).strict().refine(value=>JSON.stringify(value).length<=LEARNING_CONTEXT_MAX_CHARS,"Learning evidence exceeds the bounded context capacity; no model call is permitted");
export type LessonDistillationContext=z.infer<typeof LessonDistillationContextSchema>;
