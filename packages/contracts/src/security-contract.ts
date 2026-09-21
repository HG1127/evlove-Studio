import {z} from "zod";

export const EvolutionRoleSchema=z.enum(["viewer","operator","approver","admin","service"]);
export type EvolutionRole=z.infer<typeof EvolutionRoleSchema>;

export const EvolutionPermissionSchema=z.enum([
  "data.read",
  "mission.write",
  "mission.execute",
  "ai.execute",
  "target.execute",
  "target.write",
  "release.observe",
  "release.execute",
  "release.approve",
  "capability.write",
  "evidence.write",
  "outcome.write",
  "security.admin",
]);
export type EvolutionPermission=z.infer<typeof EvolutionPermissionSchema>;

export const EvolutionActorSchema=z.object({
  id:z.string().min(1),
  role:EvolutionRoleSchema,
  workspaceId:z.string().optional(),
  issuedAt:z.number().int().optional(),
  expiresAt:z.number().int().optional(),
  source:z.enum(["trusted-header","internal-dev","service"]).default("trusted-header"),
});
export type EvolutionActor=z.infer<typeof EvolutionActorSchema>;

export const CredentialReferenceSchema=z.object({
  id:z.string(),
  provider:z.enum(["env","external-vault"]),
  envVars:z.array(z.string()).default([]),
  purpose:z.string(),
  configured:z.boolean(),
  scopes:z.array(z.string()).default([]),
});
export type CredentialReference=z.infer<typeof CredentialReferenceSchema>;

export const VaultSecretMetadataSchema=z.object({
  id:z.string().min(1),
  workspaceId:z.string().min(1),
  name:z.string().min(1).max(120),
  purpose:z.string().min(1).max(300),
  scopes:z.array(z.string()).default([]),
  version:z.number().int().positive(),
  keyId:z.string().min(1).max(120),
  algorithm:z.literal("aes-256-gcm").default("aes-256-gcm"),
  createdBy:z.string().min(1),
  createdAt:z.string(),
  updatedAt:z.string(),
});
export type VaultSecretMetadata=z.infer<typeof VaultSecretMetadataSchema>;

export const VaultSecretPutRequestSchema=z.object({
  id:z.string().min(1).max(120),
  name:z.string().min(1).max(120),
  purpose:z.string().min(1).max(300),
  scopes:z.array(z.string()).max(30).default([]),
  value:z.string().min(1).max(100_000),
});
export type VaultSecretPutRequest=z.infer<typeof VaultSecretPutRequestSchema>;

export const VaultSecretPutResponseSchema=z.object({
  metadata:VaultSecretMetadataSchema,
  message:z.string(),
});
export type VaultSecretPutResponse=z.infer<typeof VaultSecretPutResponseSchema>;

export const VaultSecretListResponseSchema=z.object({
  configured:z.boolean(),
  workspaceId:z.string().optional(),
  secrets:z.array(VaultSecretMetadataSchema),
  message:z.string(),
});
export type VaultSecretListResponse=z.infer<typeof VaultSecretListResponseSchema>;

export const VaultSecretDeleteResponseSchema=z.object({
  id:z.string(),
  deleted:z.boolean(),
  message:z.string(),
});
export type VaultSecretDeleteResponse=z.infer<typeof VaultSecretDeleteResponseSchema>;

export const SecurityGovernanceHealthSchema=z.object({
  codeReady:z.literal(true),
  identityConfigured:z.boolean(),
  identityEnforced:z.boolean(),
  secureDataPlane:z.boolean(),
  vaultConfigured:z.boolean(),
  vaultDatabaseReady:z.boolean(),
  approvalStoreReady:z.boolean(),
  productionSafe:z.boolean(),
  workspaceId:z.string().optional(),
  checkedAt:z.string(),
  message:z.string(),
});
export type SecurityGovernanceHealth=z.infer<typeof SecurityGovernanceHealthSchema>;

export const ReleaseApprovalGrantSchema=z.object({
  id:z.string().min(1),
  workspaceId:z.string().min(1),
  missionId:z.string().min(1),
  candidateId:z.string().min(1),
  scope:z.literal("release"),
  approvedBy:z.string().min(1),
  approvedRole:EvolutionRoleSchema,
  approvedAt:z.string(),
  expiresAt:z.string(),
  note:z.string().optional(),
  revokedAt:z.string().optional(),
});
export type ReleaseApprovalGrant=z.infer<typeof ReleaseApprovalGrantSchema>;

export const SecurityCapabilitiesSchema=z.object({
  codeReady:z.literal(true),
  mode:z.enum(["trusted-header","internal-dev","blocked"]),
  configured:z.boolean(),
  enforced:z.boolean(),
  productionSafe:z.boolean(),
  workspaceId:z.string().optional(),
  roles:z.array(EvolutionRoleSchema),
  credentials:z.array(CredentialReferenceSchema),
  checkedAt:z.string(),
  message:z.string(),
});
export type SecurityCapabilities=z.infer<typeof SecurityCapabilitiesSchema>;
