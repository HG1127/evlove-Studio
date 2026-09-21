import {z} from "zod";

export const EvidenceLedgerEntrySchema=z.object({
  id:z.string().min(1),
  workspaceId:z.string().min(1),
  missionId:z.string().min(1),
  sequence:z.number().int().positive(),
  kind:z.string().min(1).max(80),
  source:z.string().min(1).max(120),
  actor:z.string().min(1).max(120),
  eventId:z.string().optional(),
  jobId:z.string().optional(),
  checkpointId:z.string().optional(),
  modelRef:z.string().optional(),
  promptVersion:z.string().optional(),
  testVersion:z.string().optional(),
  decision:z.string().optional(),
  payload:z.record(z.string(),z.unknown()).default({}),
  artifactRefs:z.array(z.string()).default([]),
  contentHash:z.string().regex(/^[a-f0-9]{64}$/),
  signature:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  signatureKeyId:z.string().optional(),
  previousHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  chainHash:z.string().regex(/^[a-f0-9]{64}$/),
  createdAt:z.string(),
});
export type EvidenceLedgerEntry=z.infer<typeof EvidenceLedgerEntrySchema>;

export const EvidenceLedgerAppendRequestSchema=z.object({
  id:z.string().min(1).optional(),
  missionId:z.string().min(1),
  kind:z.string().min(1).max(80),
  source:z.string().min(1).max(120),
  actor:z.string().min(1).max(120).default("system"),
  eventId:z.string().optional(),
  jobId:z.string().optional(),
  checkpointId:z.string().optional(),
  modelRef:z.string().optional(),
  promptVersion:z.string().optional(),
  testVersion:z.string().optional(),
  decision:z.string().optional(),
  payload:z.record(z.string(),z.unknown()).default({}),
  artifactRefs:z.array(z.string()).default([]),
});
export type EvidenceLedgerAppendRequest=z.infer<typeof EvidenceLedgerAppendRequestSchema>;

export const EvidenceLedgerHealthSchema=z.object({
  codeReady:z.literal(true),
  configured:z.boolean(),
  databaseReady:z.boolean(),
  signingConfigured:z.boolean(),
  appendFunctionReady:z.boolean(),
  immutableTriggerReady:z.boolean(),
  hashChain:z.literal(true),
  workspaceId:z.string().optional(),
  signingKeyId:z.string().optional(),
  signingProvider:z.enum(["env","vault"]).optional(),
  verificationKeyCount:z.number().int().nonnegative().default(0),
  rotationReady:z.boolean().default(false),
  exportReady:z.boolean().default(false),
  retentionMode:z.literal("immutable-artifact-archive").default("immutable-artifact-archive"),
  checkedAt:z.string(),
  message:z.string(),
});
export type EvidenceLedgerHealth=z.infer<typeof EvidenceLedgerHealthSchema>;

export const EvidenceLedgerVerifyResponseSchema=z.object({
  missionId:z.string(),
  valid:z.boolean(),
  entries:z.number().int().nonnegative(),
  contentHashesValid:z.boolean(),
  signaturesValid:z.boolean(),
  chainValid:z.boolean(),
  firstBrokenEntryId:z.string().optional(),
  checkedAt:z.string(),
  message:z.string(),
});
export type EvidenceLedgerVerifyResponse=z.infer<typeof EvidenceLedgerVerifyResponseSchema>;

export const EvidenceLedgerExportRetentionSchema=z.object({
  mode:z.literal("immutable-artifact-archive"),
  sourceLedgerAppendOnly:z.literal(true),
  sourceDeletionAllowed:z.literal(false),
});
export type EvidenceLedgerExportRetention=z.infer<typeof EvidenceLedgerExportRetentionSchema>;

export const EvidenceLedgerExportBundleSchema=z.object({
  formatVersion:z.literal("evolution-evidence-export-v1"),
  workspaceId:z.string().min(1),
  missionId:z.string().min(1),
  exportedAt:z.string(),
  entryCount:z.number().int().nonnegative(),
  headChainHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  entries:z.array(EvidenceLedgerEntrySchema),
  verification:EvidenceLedgerVerifyResponseSchema,
  retention:EvidenceLedgerExportRetentionSchema,
  bundleHash:z.string().regex(/^[a-f0-9]{64}$/),
  signature:z.string().regex(/^[a-f0-9]{64}$/),
  signatureKeyId:z.string().min(1),
  signingProvider:z.enum(["env","vault"]),
});
export type EvidenceLedgerExportBundle=z.infer<typeof EvidenceLedgerExportBundleSchema>;

export const EvidenceLedgerExportVerifyResponseSchema=z.object({
  valid:z.boolean(),
  missionId:z.string(),
  entries:z.number().int().nonnegative(),
  manifestValid:z.boolean(),
  bundleHashValid:z.boolean(),
  bundleSignatureValid:z.boolean(),
  ledgerValid:z.boolean(),
  checkedAt:z.string(),
  message:z.string(),
});
export type EvidenceLedgerExportVerifyResponse=z.infer<typeof EvidenceLedgerExportVerifyResponseSchema>;

export const EvidenceLedgerArchiveRequestSchema=z.object({
  missionId:z.string().min(1),
});
export type EvidenceLedgerArchiveRequest=z.infer<typeof EvidenceLedgerArchiveRequestSchema>;

export const EvidenceLedgerArchiveResponseSchema=z.object({
  missionId:z.string(),
  artifactId:z.string(),
  exportedAt:z.string(),
  entryCount:z.number().int().nonnegative(),
  headChainHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  bundleHash:z.string().regex(/^[a-f0-9]{64}$/),
  signatureKeyId:z.string(),
  signingProvider:z.enum(["env","vault"]),
  retentionMode:z.literal("immutable-artifact-archive"),
  message:z.string(),
});
export type EvidenceLedgerArchiveResponse=z.infer<typeof EvidenceLedgerArchiveResponseSchema>;
