import { z } from "zod";
import { ArtifactAcceptanceSchema, CandidateSchema, FrozenArtifactSchema, ValidationRunSchema } from "./evolve-schemas";

/** Validate the existing package formats without rewriting stored metadata. */
export const PackageValidationEvidenceSchema = ValidationRunSchema.pick({
  id: true, status: true, validationMode: true, candidateId: true, evaluation: true,
  recommendation: true, evidenceFingerprint: true, plannedCases: true, executedCases: true,
  runs: true, baselineRuns: true, baselineEvaluation: true, baselineSuiteIds: true,
  baselineContextFingerprint: true, baselineObservedAt: true,
  executionArtifactFingerprint: true, executionEvidenceFingerprint: true,
});
export const AcceptedCandidatePackageManifestSchema = z.object({
  packageKind: z.literal("accepted-candidate"),
  projectId: z.string().min(1), candidateId: z.string().min(1),
  validationId: z.string().min(1), acceptanceId: z.string().min(1), evidenceFingerprint: z.string().min(1),
  frozenArtifacts: z.array(FrozenArtifactSchema).min(1),
});
export const AcceptedChampionPackageManifestSchema = z.object({
  projectId: z.string().min(1),
  searchChampion: z.object({
    id: z.string().min(1),
    candidate: CandidateSchema.pick({ id: true, artifactSnapshots: true }),
    validation: PackageValidationEvidenceSchema,
    artifactAcceptance: ArtifactAcceptanceSchema,
  }),
});
