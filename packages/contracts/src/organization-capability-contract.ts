import {z} from "zod";
import {LessonSchema} from "./evolve-schemas";
import {EvolutionRoleSchema} from "./security-contract";

export const CapabilityReplicationEvidenceSchema=z.object({
  missionId:z.string().min(1),
  lessonId:z.string().min(1),
  candidateId:z.string().optional(),
  deploymentId:z.string().optional(),
  validationRunId:z.string().optional(),
  governanceStatus:z.enum(["pending","active","degraded","revoked","superseded"]).optional(),
  outcomeTrend:z.enum(["stable-healthy","healthy-insufficient","degrading","flapping","stale","unknown"]).optional(),
  observedAt:z.string(),
  validatedOn:z.array(z.string()).default([]),
});
export type CapabilityReplicationEvidence=z.infer<typeof CapabilityReplicationEvidenceSchema>;

export const CapabilityCounterExampleSchema=z.object({
  missionId:z.string().min(1),
  lessonId:z.string().min(1),
  reason:z.string().min(1),
  observedAt:z.string(),
  evidenceRefs:z.array(z.string()).default([]),
});
export type CapabilityCounterExample=z.infer<typeof CapabilityCounterExampleSchema>;

export const OrganizationCapabilityVisibilitySchema=z.enum(["workspace","private","restricted"]);
export type OrganizationCapabilityVisibility=z.infer<typeof OrganizationCapabilityVisibilitySchema>;

export const OrganizationCapabilityRecordSchema=z.object({
  id:z.string().min(1),
  workspaceId:z.string().min(1),
  capabilityKey:z.string().min(1),
  sourceMissionId:z.string().min(1),
  lessonId:z.string().min(1),
  lesson:LessonSchema,
  visibility:OrganizationCapabilityVisibilitySchema.default("workspace"),
  ownerActorId:z.string().min(1).optional(),
  allowedRoles:z.array(EvolutionRoleSchema).default([]),
  replicationEvidence:z.array(CapabilityReplicationEvidenceSchema).default([]),
  counterExamples:z.array(CapabilityCounterExampleSchema).default([]),
  archived:z.boolean().default(false),
  createdAt:z.string(),
  updatedAt:z.string(),
});
export type OrganizationCapabilityRecord=z.infer<typeof OrganizationCapabilityRecordSchema>;

export const OrganizationCapabilityHealthSchema=z.object({
  codeReady:z.literal(true),
  configured:z.boolean(),
  databaseReady:z.boolean(),
  sharingRbacReady:z.boolean().default(false),
  workspaceId:z.string().optional(),
  matchingMode:z.enum(["lexical-fuzzy","hybrid-vector"]),
  vectorSearch:z.boolean(),
  vectorSearchReason:z.string(),
  checkedAt:z.string(),
  message:z.string(),
});
export type OrganizationCapabilityHealth=z.infer<typeof OrganizationCapabilityHealthSchema>;

export const OrganizationCapabilitySyncRequestSchema=z.object({
  missionId:z.string().min(1),
});
export type OrganizationCapabilitySyncRequest=z.infer<typeof OrganizationCapabilitySyncRequestSchema>;

export const OrganizationCapabilitySyncResponseSchema=z.object({
  configured:z.boolean(),
  workspaceId:z.string().optional(),
  missionId:z.string().min(1),
  synced:z.number().int().nonnegative(),
  archived:z.number().int().nonnegative().default(0),
  message:z.string(),
});
export type OrganizationCapabilitySyncResponse=z.infer<typeof OrganizationCapabilitySyncResponseSchema>;

export const OrganizationCapabilityAccessUpdateRequestSchema=z.object({
  id:z.string().min(1),
  visibility:OrganizationCapabilityVisibilitySchema,
  allowedRoles:z.array(EvolutionRoleSchema).max(5).default([]),
});
export type OrganizationCapabilityAccessUpdateRequest=z.infer<typeof OrganizationCapabilityAccessUpdateRequestSchema>;

export const OrganizationCapabilityAccessUpdateResponseSchema=z.object({
  configured:z.boolean(),
  workspaceId:z.string().optional(),
  record:OrganizationCapabilityRecordSchema.optional(),
  message:z.string(),
});
export type OrganizationCapabilityAccessUpdateResponse=z.infer<typeof OrganizationCapabilityAccessUpdateResponseSchema>;

export const OrganizationCapabilitySearchRequestSchema=z.object({
  q:z.string().max(500).default(""),
  limit:z.coerce.number().int().min(1).max(100).default(20),
  reusableOnly:z.preprocess(
    (value)=>typeof value==="string"?/^(1|true|yes|on)$/i.test(value):value,
    z.boolean(),
  ).default(false),
  statuses:z.array(z.enum(["lesson","verified-skill","anti-pattern"])).optional(),
});
export type OrganizationCapabilitySearchRequest=z.infer<typeof OrganizationCapabilitySearchRequestSchema>;

export const OrganizationCapabilitySearchHitSchema=z.object({
  capabilityKey:z.string(),
  score:z.number().nonnegative(),
  lexicalScore:z.number().nonnegative().default(0),
  semanticScore:z.number().min(-1).max(1).optional(),
  representative:OrganizationCapabilityRecordSchema,
  replicationEvidence:z.array(CapabilityReplicationEvidenceSchema),
  counterExamples:z.array(CapabilityCounterExampleSchema),
  matchedTerms:z.array(z.string()),
});
export type OrganizationCapabilitySearchHit=z.infer<typeof OrganizationCapabilitySearchHitSchema>;

export const OrganizationCapabilitySearchResponseSchema=z.object({
  configured:z.boolean(),
  workspaceId:z.string().optional(),
  matchingMode:z.enum(["lexical-fuzzy","hybrid-vector"]),
  vectorSearch:z.boolean(),
  hits:z.array(OrganizationCapabilitySearchHitSchema),
  totalRows:z.number().int().nonnegative(),
  message:z.string(),
});
export type OrganizationCapabilitySearchResponse=z.infer<typeof OrganizationCapabilitySearchResponseSchema>;
