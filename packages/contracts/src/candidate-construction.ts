import {z} from "zod";

/** Only generated content faults before freezing qualify for targeted construction repair. */
export const CandidateConstructionFailureSchema=z.object({
 version:z.literal("candidate-construction-failure-v1"),
 code:z.enum(["text-edits","text-format","html-protection","output-mode","missing-target","unchanged"]),
 message:z.string().min(1).max(4000),
});
export type CandidateConstructionFailure=z.infer<typeof CandidateConstructionFailureSchema>;
export const CandidateConstructionBoundarySchema=z.object({
 version:z.literal("candidate-construction-v1"),missionId:z.string().min(1),candidateId:z.string().min(1),
 parentFingerprint:z.string().regex(/^[a-f0-9]{64}$/),generation:z.string().regex(/^[a-f0-9]{64}$/),
 sourceArtifactIds:z.array(z.string().min(1)).min(1).refine(ids=>new Set(ids).size===ids.length),
});
export type CandidateConstructionBoundary=z.infer<typeof CandidateConstructionBoundarySchema>;
