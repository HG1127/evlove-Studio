import {z} from "zod";
import {BusinessBenefitAssessmentSchema} from "./business-benefit-contract";

export const OutcomeMetricKindSchema=z.enum(["business","latency","cost","safety"]);
export type OutcomeMetricKind=z.infer<typeof OutcomeMetricKindSchema>;
export const OutcomeMetricDirectionSchema=z.enum(["higher","lower"]);
export type OutcomeMetricDirection=z.infer<typeof OutcomeMetricDirectionSchema>;
export const OutcomeArmSchema=z.enum(["stable","candidate"]);
export type OutcomeArm=z.infer<typeof OutcomeArmSchema>;

export const OUTCOME_OBSERVATION_METADATA_KEY="__evolutionOutcomeObservation";
export const OUTCOME_MEASUREMENT_POLICY="independent-task-observations-v1";
export const OutcomeObservationIdentitySchema=z.discriminatedUnion("kind",[
  z.object({schemaVersion:z.literal("outcome-observation-v1"),kind:z.literal("independent-task"),taskId:z.string().trim().min(1).max(200)}).strict(),
  z.object({schemaVersion:z.literal("outcome-observation-v1"),kind:z.literal("aggregate-snapshot")}).strict(),
]);
export type OutcomeObservationIdentity=z.infer<typeof OutcomeObservationIdentitySchema>;

export const OutcomeMetricSampleSchema=z.object({
  id:z.string().min(1),
  workspaceId:z.string().min(1),
  missionId:z.string().min(1),
  candidateId:z.string().optional(),
  deploymentId:z.string().optional(),
  arm:OutcomeArmSchema,
  metricKey:z.string().min(1).max(120),
  metricKind:OutcomeMetricKindSchema,
  direction:OutcomeMetricDirectionSchema,
  value:z.number().finite(),
  unit:z.string().max(40).optional(),
  segment:z.string().min(1).max(120).default("all"),
  source:z.string().min(1).max(120),
  observedAt:z.string(),
  observation:OutcomeObservationIdentitySchema.optional(),
  metadata:z.record(z.string(),z.unknown()).default({}),
});
export type OutcomeMetricSample=z.infer<typeof OutcomeMetricSampleSchema>;

export const OutcomeMetricSampleInputSchema=OutcomeMetricSampleSchema.omit({
  id:true,workspaceId:true,missionId:true,
}).extend({id:z.string().min(1).optional()});
export type OutcomeMetricSampleInput=z.infer<typeof OutcomeMetricSampleInputSchema>;

export const OutcomeMetricBatchRequestSchema=z.object({
  missionId:z.string().min(1),
  candidateId:z.string().optional(),
  samples:z.array(OutcomeMetricSampleInputSchema).min(1).max(1000),
});
export type OutcomeMetricBatchRequest=z.infer<typeof OutcomeMetricBatchRequestSchema>;

export const OutcomeMetricBatchResponseSchema=z.object({
  missionId:z.string(),
  inserted:z.number().int().nonnegative(),
  message:z.string(),
});
export type OutcomeMetricBatchResponse=z.infer<typeof OutcomeMetricBatchResponseSchema>;

export const OutcomeSummarySchema=z.object({
  count:z.number().int().nonnegative(),
  mean:z.number().optional(),
  stddev:z.number().nonnegative().optional(),
  min:z.number().optional(),
  max:z.number().optional(),
});
export type OutcomeSummary=z.infer<typeof OutcomeSummarySchema>;

export const OutcomeMetricAnalysisSchema=z.object({
  metricKey:z.string(),
  metricKind:OutcomeMetricKindSchema,
  direction:OutcomeMetricDirectionSchema,
  unit:z.string().optional(),
  segment:z.string(),
  stable:OutcomeSummarySchema,
  candidate:OutcomeSummarySchema,
  delta:z.number().optional(),
  relativeDelta:z.number().optional(),
  standardError:z.number().nonnegative().optional(),
  zScore:z.number().optional(),
  pValueApprox:z.number().min(0).max(1).optional(),
  evidenceStatus:z.enum(["insufficient","estimated"]),
  significance:z.enum(["insufficient","not-significant","significant-improvement","significant-regression"]),
  favorable:z.boolean().optional(),
});
export type OutcomeMetricAnalysis=z.infer<typeof OutcomeMetricAnalysisSchema>;

export const OutcomeDriftAnalysisSchema=z.object({
  metricKey:z.string(),
  segment:z.string(),
  older:OutcomeSummarySchema,
  recent:OutcomeSummarySchema,
  standardizedShift:z.number().optional(),
  status:z.enum(["insufficient","stable","drifting"]),
});
export type OutcomeDriftAnalysis=z.infer<typeof OutcomeDriftAnalysisSchema>;

export const OutcomeAnalyticsResponseSchema=z.object({
  missionId:z.string(),
  candidateId:z.string().optional(),
  checkedAt:z.string(),
  sampleCount:z.number().int().nonnegative(),
  measurementPolicy:z.literal(OUTCOME_MEASUREMENT_POLICY).optional(),
  independentSampleCount:z.number().int().nonnegative().optional(),
  excludedSampleCount:z.number().int().nonnegative().optional(),
  droppedSampleCount:z.number().int().nonnegative().optional(),
  observationConflictCount:z.number().int().nonnegative().optional(),
  minimumSamplesPerArm:z.number().int().positive(),
  metrics:z.array(OutcomeMetricAnalysisSchema),
  businessBenefit:BusinessBenefitAssessmentSchema.optional(),
  drift:z.array(OutcomeDriftAnalysisSchema),
  regressions:z.array(z.object({
    metricKey:z.string(),
    segment:z.string(),
    kind:OutcomeMetricKindSchema,
    reason:z.string(),
  })),
  verdict:z.enum(["insufficient","healthy","watch","regression"]),
  message:z.string(),
});
export type OutcomeAnalyticsResponse=z.infer<typeof OutcomeAnalyticsResponseSchema>;

export const OutcomeAnalyticsHealthSchema=z.object({
  codeReady:z.literal(true),
  configured:z.boolean(),
  databaseReady:z.boolean(),
  secureDataPlane:z.boolean(),
  ingestionReady:z.boolean(),
  analysisReady:z.boolean(),
  telemetryConfigured:z.boolean().default(false),
  telemetryReady:z.boolean().default(true),
  telemetrySourceCount:z.number().int().nonnegative().default(0),
  telemetryMetricCount:z.number().int().nonnegative().default(0),
  minimumSamplesPerArm:z.number().int().positive(),
  checkedAt:z.string(),
  message:z.string(),
});
export type OutcomeAnalyticsHealth=z.infer<typeof OutcomeAnalyticsHealthSchema>;
