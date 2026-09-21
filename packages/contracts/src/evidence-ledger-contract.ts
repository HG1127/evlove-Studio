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
