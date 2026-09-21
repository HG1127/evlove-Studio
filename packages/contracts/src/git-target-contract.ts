import { z } from "zod";
import { TargetLifecycleCapabilitiesSchema } from "./target-contract";

export const GitRepositoryBindingSchema=z.object({
  provider:z.literal("github").default("github"),
  owner:z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  repo:z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
  baseBranch:z.string().min(1).max(200).default("main"),
  pathPrefix:z.string().max(400).optional(),
});
export type GitRepositoryBinding=z.infer<typeof GitRepositoryBindingSchema>;

export const GitTargetCapabilitiesSchema=z.object({
  provider:z.literal("github"),
  codeReady:z.boolean(),
  configured:z.boolean(),
  webhookConfigured:z.boolean(),
  allowlistConfigured:z.boolean(),
  lifecycle:TargetLifecycleCapabilitiesSchema,
});
export type GitTargetCapabilities=z.infer<typeof GitTargetCapabilitiesSchema>;

export const GitFileChangeSchema=z.object({
  path:z.string().min(1).max(1000),
  content:z.string().optional(),
  delete:z.boolean().default(false),
}).superRefine((value,ctx)=>{
  if(!value.delete&&value.content===undefined)ctx.addIssue({code:"custom",message:"Git file change requires content unless delete=true"});
  if(value.delete&&value.content!==undefined)ctx.addIssue({code:"custom",message:"Deleted Git file must not include content"});
});
export type GitFileChange=z.infer<typeof GitFileChangeSchema>;

export const GitCheckSummarySchema=z.object({
  total:z.number().int().min(0),
  completed:z.number().int().min(0),
  successful:z.number().int().min(0),
  failed:z.number().int().min(0),
  pending:z.number().int().min(0),
  status:z.enum(["success","failure","pending","none"]),
  names:z.array(z.string()).default([]),
});
export type GitCheckSummary=z.infer<typeof GitCheckSummarySchema>;

const base=z.object({repository:GitRepositoryBindingSchema,missionId:z.string().min(1).optional()});
export const GitTargetActionRequestSchema=z.discriminatedUnion("action",[
  base.extend({action:z.literal("snapshot")}),
  base.extend({
    action:z.literal("mutate"),
    missionId:z.string().min(1),
    candidateId:z.string().min(1),
    expectedBaseSha:z.string().min(7),
    branch:z.string().min(1).max(240).optional(),
    commitMessage:z.string().min(1).max(500),
    changes:z.array(GitFileChangeSchema).min(1).max(500),
  }),
  base.extend({action:z.literal("validate"),commitSha:z.string().min(7)}),
  base.extend({
    action:z.literal("open-pr"),
    missionId:z.string().min(1),
    candidateId:z.string().min(1),
    branch:z.string().min(1),
    title:z.string().min(1).max(300),
    body:z.string().max(20_000).optional(),
  }),
  base.extend({
    action:z.literal("observe"),
    missionId:z.string().min(1).optional(),
    commitSha:z.string().min(7),
    pullNumber:z.number().int().positive().optional(),
  }),
  base.extend({
    action:z.literal("merge"),
    missionId:z.string().min(1),
    candidateId:z.string().min(1),
    pullNumber:z.number().int().positive(),
    expectedHeadSha:z.string().min(7),
    mergeMethod:z.enum(["merge","squash","rebase"]).default("squash"),
  }),
  base.extend({
    action:z.literal("rollback"),
    missionId:z.string().min(1),
    candidateId:z.string().min(1),
    expectedHeadSha:z.string().min(7),
    stableCommitSha:z.string().min(7),
    message:z.string().min(1).max(500).default("Evolution OS rollback to stable commit"),
  }),
]);
export type GitTargetActionRequest=z.infer<typeof GitTargetActionRequestSchema>;

export const GitTargetActionResponseSchema=z.object({
  provider:z.literal("github"),
  action:z.enum(["snapshot","mutate","validate","open-pr","observe","merge","rollback"]),
  ok:z.boolean(),
  repository:z.string(),
  branch:z.string().optional(),
  baseCommitSha:z.string().optional(),
  commitSha:z.string().optional(),
  treeSha:z.string().optional(),
  pullNumber:z.number().int().positive().optional(),
  pullUrl:z.string().url().optional(),
  mergeCommitSha:z.string().optional(),
  checks:GitCheckSummarySchema.optional(),
  changedPaths:z.array(z.string()).default([]),
  observedAt:z.string(),
  note:z.string(),
});
export type GitTargetActionResponse=z.infer<typeof GitTargetActionResponseSchema>;

export const GitAcceptedPublishRequestSchema=z.object({
  repository:GitRepositoryBindingSchema,
  missionId:z.string().min(1),
  expectedBaseSha:z.string().min(7),
  branch:z.string().min(1).max(240).optional(),
  commitMessage:z.string().min(1).max(500).optional(),
  openPullRequest:z.boolean().default(true),
  pullTitle:z.string().min(1).max(300).optional(),
  pullBody:z.string().max(20_000).optional(),
  includeMetadata:z.boolean().default(true),
});
export type GitAcceptedPublishRequest=z.infer<typeof GitAcceptedPublishRequestSchema>;

export const GitAcceptedPublishResponseSchema=z.object({
  provider:z.literal("github"),
  missionId:z.string(),
  candidateId:z.string(),
  artifactCount:z.number().int().positive(),
  metadataCount:z.number().int().nonnegative(),
  mutation:GitTargetActionResponseSchema,
  pullRequest:GitTargetActionResponseSchema.optional(),
  observedAt:z.string(),
  note:z.string(),
});
export type GitAcceptedPublishResponse=z.infer<typeof GitAcceptedPublishResponseSchema>;

export const GitWebhookReceiptSchema=z.object({
  accepted:z.boolean(),
  event:z.string(),
  missionId:z.string().optional(),
  branch:z.string().optional(),
  repository:z.string().optional(),
  observedAt:z.string(),
});
export type GitWebhookReceipt=z.infer<typeof GitWebhookReceiptSchema>;
