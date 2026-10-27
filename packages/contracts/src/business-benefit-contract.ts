import { z } from "zod";

const taskIds = z.array(z.string().trim().min(1).max(200)).min(30).max(1000);
/** Numeric controlled-workload gates. Source authenticity and causal study design need separate evidence. */
export const BusinessBenefitPolicySchema = z.object({
  version: z.literal("controlled-task-benefit-v1"),
  source: z.string().regex(/^outcome-telemetry:[A-Za-z0-9._-]+$/).max(120),
  segment: z.string().min(1).max(120),
  acceptanceMetricKey: z.string().min(1).max(120),
  elapsedMetricKey: z.string().min(1).max(120),
  costMetricKey: z.string().min(1).max(120),
  costUnit: z.string().regex(/^[A-Z]{3}$/),
  stableTaskIds: taskIds,
  candidateTaskIds: taskIds,
}).strict().superRefine((policy, ctx) => {
  const ids = [...policy.stableTaskIds, ...policy.candidateTaskIds];
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Planned task IDs must be unique across both arms" });
  if (new Set([policy.acceptanceMetricKey, policy.elapsedMetricKey, policy.costMetricKey]).size !== 3)
    ctx.addIssue({ code: "custom", message: "Acceptance, elapsed and cost metrics must be distinct" });
});
export type BusinessBenefitPolicy = z.infer<typeof BusinessBenefitPolicySchema>;

const ArmSummarySchema = z.object({
  expectedTasks: z.number().int().nonnegative(),
  completeTasks: z.number().int().nonnegative(),
  acceptedTasks: z.number().int().nonnegative().optional(),
  acceptanceRate: z.number().min(0).max(1).optional(),
  medianElapsedMs: z.number().nonnegative().optional(),
  reportedTotalCost: z.number().nonnegative().optional(),
  reportedCostPerAccepted: z.number().nonnegative().optional(),
});
export const BusinessBenefitAssessmentSchema = z.object({
  version: z.literal("controlled-task-benefit-v1"),
  policyFingerprint: z.string().min(1),
  checkedAt: z.string(),
  status: z.enum(["insufficient", "failed", "thresholds-met"]),
  stable: ArmSummarySchema,
  candidate: ArmSummarySchema,
  checks: z.object({ completeCohorts: z.boolean(), acceptanceAtLeast80Percent: z.boolean(), medianTimeReduced20Percent: z.boolean(), costPerAcceptedNoIncrease: z.boolean() }),
  conflictCount: z.number().int().nonnegative(),
  unexpectedTaskCount: z.number().int().nonnegative(),
  pendingTaskCount: z.number().int().nonnegative(),
  /** These statistics cannot attest real human traffic, provider invoices or randomization. */
  establishesCausalBenefit: z.literal(false),
  reason: z.string(),
});
export type BusinessBenefitAssessment = z.infer<typeof BusinessBenefitAssessmentSchema>;
