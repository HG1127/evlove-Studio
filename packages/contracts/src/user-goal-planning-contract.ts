import {z} from "zod";

const id=z.string().min(1).max(200);
const criterion=z.object({criterionId:id,title:z.string(),requirement:z.string(),minScore:z.number().min(0).max(100),weight:z.number().min(0)}).strict();
/** Generation scope only. This record does not attest to Candidate coverage or acceptance. */
export const UserGoalPlanningScopeSchema=z.object({
  schemaVersion:z.literal("user-goal-planning-scope-v1"),
  requiredCriteria:z.array(criterion).min(1).max(32).refine(rows=>new Set(rows.map(c=>c.criterionId)).size===rows.length,"Duplicate user goal"),
  targetArtifactIds:z.array(id).min(1).max(32).refine(ids=>new Set(ids).size===ids.length,"Duplicate Target"),
}).strict();
export type UserGoalPlanningScope=z.infer<typeof UserGoalPlanningScopeSchema>;
