import { z } from "zod";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const ArtifactRelativePathSchema = z.string().min(1).max(1024).refine((value) => {
  if (/[\\:]/.test(value) || value.startsWith("/") || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."
    && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}, "Artifact paths must be unambiguous relative POSIX paths without traversal or platform aliases.");
const relativeArtifactPath = ArtifactRelativePathSchema;

export const ArtifactFileRoleSchema = z.enum(["source", "target", "protected", "test", "metadata"]);
export const ArtifactPatchModeSchema = z.enum([
  "full", "text-edits", "json-patch", "html-node-edits", "code-overlay",
  "native-document-parts", "native-spreadsheet-cells",
]);

export const ArtifactFileDescriptorSchema = z.object({
  path: relativeArtifactPath,
  role: ArtifactFileRoleSchema,
  mutable: z.boolean(),
  sha256,
  mediaType: z.string().min(1).max(200).optional(),
  patchMode: ArtifactPatchModeSchema,
  dependsOn: z.array(relativeArtifactPath).default([]),
  capabilityIds: z.array(z.string().min(1).max(160)).default([]),
  maxBytes: z.number().int().positive().max(20 * 1024 * 1024).default(5 * 1024 * 1024),
}).strict().superRefine((file, ctx) => {
  if (file.role === "protected" && file.mutable) {
    ctx.addIssue({ code: "custom", path: ["mutable"], message: "Protected artifacts must be immutable." });
  }
  if (file.role === "test" && file.mutable) {
    ctx.addIssue({ code: "custom", path: ["mutable"], message: "Evaluation tests cannot be candidate-mutable." });
  }
});
export type ArtifactFileDescriptor = z.infer<typeof ArtifactFileDescriptorSchema>;

export const ArtifactMutationPolicySchema = z.object({
  allowedPaths: z.array(relativeArtifactPath).max(500),
  protectedPaths: z.array(relativeArtifactPath).max(500).default([]),
  allowDelete: z.boolean().default(false),
  preserveExistingCapabilities: z.boolean().default(true),
  rejectNoop: z.boolean().default(true),
  maxChangedFiles: z.number().int().positive().max(100).default(5),
  maxFileBytes: z.number().int().positive().max(20 * 1024 * 1024).default(5 * 1024 * 1024),
}).strict().superRefine((policy, ctx) => {
  const allowed = policy.allowedPaths.map((path) => path.toLowerCase());
  policy.protectedPaths.forEach((path, index) => {
    const protectedPath = path.toLowerCase();
    if (allowed.some((item) => item === protectedPath || item.startsWith(protectedPath + "/"))) {
      ctx.addIssue({ code: "custom", path: ["protectedPaths", index], message: "A protected path or subtree cannot be writable." });
    }
  });
  if (new Set(allowed).size !== allowed.length) {
    ctx.addIssue({ code: "custom", path: ["allowedPaths"], message: "Allowed paths must be unique, including case aliases." });
  }
});
export type ArtifactMutationPolicy = z.infer<typeof ArtifactMutationPolicySchema>;

/** Trusted Mission/source configuration; never take this policy from an AI artifact response. */
export const ArtifactWriteGovernanceSchema = z.object({
  version: z.literal("artifact-write-governance-v1"),
  parentSha256: sha256,
  policy: ArtifactMutationPolicySchema,
}).strict();
export type ArtifactWriteGovernance = z.infer<typeof ArtifactWriteGovernanceSchema>;

/** Server-written provenance, not an AI assertion or a promotion/quality decision. */
export const ArtifactWriteLineageSchema = z.object({
  version: z.literal("artifact-write-lineage-v1"),
  missionId: z.string().min(1).max(200),
  sourceArtifactId: z.string().min(1).max(200),
  name: z.string().min(1).max(512),
  candidateId: z.string().min(1).max(200),
  parentCandidateId: z.string().min(1).max(200).optional(),
  approvalSha256: sha256,
  inputSha256: sha256,
  outputSha256: sha256,
  outputBlobId: z.string().min(1).max(200),
  outputSnapshotHash: sha256,
  outputSize: z.number().int().positive(),
}).strict();
export type ArtifactWriteLineage = z.infer<typeof ArtifactWriteLineageSchema>;


export const ArtifactMutationPatchSchema = z.object({
  id: z.string().min(1).max(160),
  path: relativeArtifactPath,
  operation: z.enum(["add", "update", "remove"]),
  expectedParentSha256: sha256.optional(),
  content: z.string().optional(),
  contentSha256: sha256.optional(),
  evidenceCaseIds: z.array(z.string().min(1).max(160)).min(1),
  rationale: z.string().min(1).max(4000),
  preservedCapabilityIds: z.array(z.string().min(1).max(160)).default([]),
}).strict().superRefine((patch, ctx) => {
  if (patch.operation === "add" && patch.expectedParentSha256) {
    ctx.addIssue({ code: "custom", path: ["expectedParentSha256"], message: "An added file cannot claim a parent hash." });
  }
  if (patch.operation !== "add" && !patch.expectedParentSha256) {
    ctx.addIssue({ code: "custom", path: ["expectedParentSha256"], message: "An update/remove must bind to its parent hash." });
  }
  if (patch.operation !== "remove" && !patch.contentSha256) {
    ctx.addIssue({ code: "custom", path: ["contentSha256"], message: "Add/update patches must bind the exact content SHA-256." });
  }
  if (patch.operation === "remove" && (patch.content !== undefined || patch.contentSha256 !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["content"], message: "A removal cannot carry replacement content." });
  }
  if (patch.operation !== "remove" && patch.content === undefined) {
    ctx.addIssue({ code: "custom", path: ["content"], message: "Add/update patches require content." });
  }
});
export type ArtifactMutationPatch = z.infer<typeof ArtifactMutationPatchSchema>;

export const ArtifactReflectionEvidenceSchema = z.object({
  parentCandidateId: z.string().min(1),
  failureCaseIds: z.array(z.string().min(1)),
  fixedCaseIds: z.array(z.string().min(1)).default([]),
  remainingFailureCaseIds: z.array(z.string().min(1)),
  antiPatterns: z.array(z.string().min(1).max(1000)).default([]),
  diagnosis: z.string().min(1).max(8000),
  mutationPlan: z.array(ArtifactMutationPatchSchema).max(100),
}).strict().superRefine((reflection, ctx) => {
  const failed = new Set(reflection.failureCaseIds);
  for (const [index, id] of reflection.remainingFailureCaseIds.entries()) {
    if (!failed.has(id)) ctx.addIssue({ code: "custom", path: ["remainingFailureCaseIds", index], message: "Remaining failure must reference an observed failed case." });
  }
  for (const [index, id] of reflection.fixedCaseIds.entries()) {
    if (failed.has(id)) ctx.addIssue({ code: "custom", path: ["fixedCaseIds", index], message: "A case cannot be both fixed and currently failing." });
  }
});
export type ArtifactReflectionEvidence = z.infer<typeof ArtifactReflectionEvidenceSchema>;

export const ArtifactEvolutionContractSchema = z.object({
  version: z.literal("artifact-evolution-contract-v1"),
  artifactId: z.string().min(1),
  artifactType: z.enum(["agent-skill", "workflow", "html", "markdown", "code", "document", "presentation", "spreadsheet", "archive"]),
  parentCandidateId: z.string().min(1),
  files: z.array(ArtifactFileDescriptorSchema).min(1).max(500),
  mutationPolicy: ArtifactMutationPolicySchema,
  reflection: ArtifactReflectionEvidenceSchema.optional(),
}).strict().superRefine((contract, ctx) => {
  const paths = contract.files.map((file) => file.path);
  if (new Set(paths).size !== paths.length) {
    ctx.addIssue({ code: "custom", path: ["files"], message: "Artifact file paths must be unique." });
  }
  const fileSet = new Set(paths);
  contract.files.forEach((file, index) => {
    for (const dependency of file.dependsOn) {
      if (!fileSet.has(dependency)) ctx.addIssue({ code: "custom", path: ["files", index, "dependsOn"], message: "Unknown dependency: " + dependency });
    }
    if (file.mutable && !contract.mutationPolicy.allowedPaths.includes(file.path)) {
      ctx.addIssue({ code: "custom", path: ["files", index, "mutable"], message: "Mutable file must be explicitly allowlisted." });
    }
    if (file.mutable && contract.mutationPolicy.protectedPaths.includes(file.path)) {
      ctx.addIssue({ code: "custom", path: ["files", index, "mutable"], message: "Protected path cannot be mutable." });
    }
    if (!file.mutable && contract.mutationPolicy.allowedPaths.includes(file.path)) {
      ctx.addIssue({ code: "custom", path: ["files", index, "path"], message: "Immutable file cannot be allowlisted." });
    }
  });
});
export type ArtifactEvolutionContract = z.infer<typeof ArtifactEvolutionContractSchema>;