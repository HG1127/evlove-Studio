import {z} from "zod";
import {OutcomeAnalyticsResponseSchema} from "./outcome-analytics-contract";

/** Read-only warehouse evidence, distinct from a successful deployment health probe. */
export const ProductionGoalEvidenceSchema=z.object({
  schemaVersion:z.literal("production-goal-v1"),
  missionId:z.string().min(1),candidateId:z.string().min(1),
  deploymentId:z.string().min(1),stableDeploymentId:z.string().min(1),
  goalFingerprint:z.string().min(1),checkedAt:z.string(),
  analysis:OutcomeAnalyticsResponseSchema.optional(),
  error:z.string().optional(),
});
export type ProductionGoalEvidence=z.infer<typeof ProductionGoalEvidenceSchema>;
