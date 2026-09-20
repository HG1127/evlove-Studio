import { z } from "zod";
import { TargetRunResultSchema, TestCaseSchema } from "./evolve-schemas";

export const SandboxFileSchema=z.object({
  path:z.string().min(1).max(300).refine((value)=>{
    const normalized=value.replace(/\\/g,"/");
    return !normalized.startsWith("/")&&!normalized.split("/").some((part)=>part===".."||part==="")&&!normalized.includes("\0");
  },"Sandbox file path 必须是安全的相对路径"),
  content:z.string(),
});
export type SandboxFile=z.infer<typeof SandboxFileSchema>;

export const SandboxCommandPhaseSchema=z.enum(["install","build","test","e2e"]);
export type SandboxCommandPhase=z.infer<typeof SandboxCommandPhaseSchema>;

export const SandboxCommandSchema=z.object({
  id:z.string().min(1),
  phase:SandboxCommandPhaseSchema,
  command:z.string().min(1).max(120),
  args:z.array(z.string().max(2000)).max(64).default([]),
  cwd:z.string().min(1).default("/vercel/sandbox"),
  env:z.record(z.string(),z.string()).default({}),
  timeoutMs:z.number().int().min(1_000).max(15*60_000).default(120_000),
});
export type SandboxCommand=z.infer<typeof SandboxCommandSchema>;

export const SandboxPreviewSchema=z.object({
  command:z.string().min(1).max(120),
  args:z.array(z.string().max(2000)).max(64).default([]),
  cwd:z.string().min(1).default("/vercel/sandbox"),
  env:z.record(z.string(),z.string()).default({}),
  port:z.number().int().min(1024).max(65535).default(4173),
  healthPath:z.string().startsWith("/").max(300).default("/"),
  startupTimeoutMs:z.number().int().min(2_000).max(120_000).default(30_000),
});
export type SandboxPreview=z.infer<typeof SandboxPreviewSchema>;

export const SandboxValidationRequestSchema=z.object({
  id:z.string().min(1).optional(),
  files:z.array(SandboxFileSchema).min(1).max(2500),
  commands:z.array(SandboxCommandSchema).max(16).default([]),
  preview:SandboxPreviewSchema.optional(),
  timeoutMs:z.number().int().min(30_000).max(30*60_000).default(10*60_000),
  vcpus:z.number().int().min(1).max(4).default(2),
  region:z.string().min(2).max(12).optional(),
  installNetworkDomains:z.array(z.string().min(1).max(253)).max(30).default([
    "registry.npmjs.org",
    "*.npmjs.org",
    "registry.yarnpkg.com",
    "github.com",
    "*.githubusercontent.com",
  ]),
  runtimeNetworkDomains:z.array(z.string().min(1).max(253)).max(30).default([]),
});
export type SandboxValidationRequest=z.infer<typeof SandboxValidationRequestSchema>;

export const SandboxStepResultSchema=z.object({
  id:z.string(),
  phase:SandboxCommandPhaseSchema,
  command:z.string(),
  exitCode:z.number().int(),
  durationMs:z.number().nonnegative().optional(),
  stdout:z.string(),
  stderr:z.string(),
});
export type SandboxStepResult=z.infer<typeof SandboxStepResultSchema>;

export const SandboxValidationResultSchema=z.object({
  status:z.enum(["verified","failed","unavailable"]),
  sandboxName:z.string().optional(),
  region:z.string().optional(),
  previewUrlObserved:z.string().url().optional(),
  previewHealthy:z.boolean().optional(),
  steps:z.array(SandboxStepResultSchema),
  startedAt:z.string(),
  finishedAt:z.string(),
  error:z.string().optional(),
});
export type SandboxValidationResult=z.infer<typeof SandboxValidationResultSchema>;

export const SandboxHealthSchema=z.object({
  ready:z.boolean(),
  message:z.string(),
  latencyMs:z.number().nonnegative().optional(),
  nodeVersion:z.string().optional(),
  npmVersion:z.string().optional(),
  region:z.string().optional(),
});
export type SandboxHealth=z.infer<typeof SandboxHealthSchema>;

export const SandboxBrowserHealthSchema=z.object({
  ready:z.boolean(),
  message:z.string(),
  latencyMs:z.number().nonnegative().optional(),
  playwrightVersion:z.string().optional(),
  browser:z.literal("chromium").optional(),
  snapshotCached:z.boolean().default(false),
  previewHealthy:z.boolean().default(false),
  browserStepsVerified:z.boolean().default(false),
  browserStepsExecuted:z.number().int().nonnegative().default(0),
  region:z.string().optional(),
});
export type SandboxBrowserHealth=z.infer<typeof SandboxBrowserHealthSchema>;

export const SandboxTargetBatchRequestSchema=z.object({
  projectId:z.string().min(1),
  sourceArtifactId:z.string().min(1),
  artifactBlobId:z.string().min(1),
  artifactSha256:z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  candidateId:z.string().optional(),
  testCases:z.array(TestCaseSchema).min(1).max(12),
});
export type SandboxTargetBatchRequest=z.infer<typeof SandboxTargetBatchRequestSchema>;

export const SandboxTargetBatchResponseSchema=z.object({
  results:z.array(TargetRunResultSchema),
  packageRoot:z.string().optional(),
  packageManager:z.string().optional(),
  scriptsRun:z.array(z.string()).default([]),
  artifactHash:z.string().optional(),
  previewUrlObserved:z.string().url().optional(),
  previewHealthy:z.boolean().optional(),
  browserStepsExecuted:z.number().int().nonnegative().default(0),
  browserRuntime:z.enum(["not-needed","snapshot","unavailable"]).default("not-needed"),
  sandboxRegion:z.string().optional(),
});
export type SandboxTargetBatchResponse=z.infer<typeof SandboxTargetBatchResponseSchema>;
