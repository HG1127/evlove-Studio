import { describe, expect, it } from "vitest";
import {
  ArtifactEvolutionContractSchema,
  ArtifactFileDescriptorSchema,
  ArtifactMutationPatchSchema,
  ArtifactMutationPolicySchema,
  ArtifactReflectionEvidenceSchema,
} from "@evolution/contracts";
import {
  artifactFileMutationBlocker,
  artifactReflectionEvidenceBlocker,
  validateArtifactMutationPlan,
  type ArtifactParentFile,
} from "./artifact-mutation-governance";

const hash = "a".repeat(64);
const nextHash = "b".repeat(64);
const policy = ArtifactMutationPolicySchema.parse({
  allowedPaths: ["config/routing.json", "new/notes.md"],
  protectedPaths: ["SKILL.md", "tests/acceptance.json"],
  maxChangedFiles: 2,
  maxFileBytes: 1024,
});
const parentFiles: ArtifactParentFile[] = [
  { path: "config/routing.json", sha256: hash, sizeBytes: 20, capabilityIds: ["account-reset", "billing-refund"] },
  { path: "SKILL.md", sha256: nextHash, sizeBytes: 12 },
];

function patch(overrides: Record<string, unknown> = {}) {
  return ArtifactMutationPatchSchema.parse({
    id: "patch-1",
    path: "config/routing.json",
    operation: "update",
    expectedParentSha256: hash,
    content: "{\"rules\":[]}",
    contentSha256: nextHash,
    evidenceCaseIds: ["failure-1"],
    rationale: "Fix observed routing precedence failure.",
    preservedCapabilityIds: ["account-reset", "billing-refund"],
    ...overrides,
  });
}

describe("artifact mutation governance", () => {
  it("accepts an allowlisted update bound to the exact parent and observed failure", () => {
    expect(validateArtifactMutationPlan({
      policy, parentFiles, patches: [patch()], observedFailedCaseIds: ["failure-1"],
    })).toEqual([]);
  });

  it("rejects path traversal and absolute paths", () => {
    const result = validateArtifactMutationPlan({
      policy, parentFiles, patches: [{ ...patch(), path: "../secrets.env" } as never], observedFailedCaseIds: ["failure-1"],
    });
    expect(result.some((issue) => issue.code === "invalid-path")).toBe(true);
    expect(ArtifactMutationPatchSchema.safeParse({
      ...patch(), path: "C:/Windows/secrets.txt",
    }).success).toBe(false);
  });

  it("rejects a protected file even when it is submitted as a patch", () => {
    const unsafePolicy = ArtifactMutationPolicySchema.parse({
      allowedPaths: ["config/routing.json"], protectedPaths: ["SKILL.md"],
    });
    const result = validateArtifactMutationPlan({
      policy: unsafePolicy, parentFiles,
      patches: [patch({ path: "SKILL.md", expectedParentSha256: nextHash })],
      observedFailedCaseIds: ["failure-1"],
    });
    expect(result.some((issue) => issue.code === "protected-path")).toBe(true);
  });

  it("rejects stale parent hashes", () => {
    const result = validateArtifactMutationPlan({
      policy, parentFiles, patches: [patch({ expectedParentSha256: nextHash })],
      observedFailedCaseIds: ["failure-1"],
    });
    expect(result.some((issue) => issue.code === "stale-parent")).toBe(true);
  });

  it("rejects no-op changes by content hash", () => {
    const result = validateArtifactMutationPlan({
      policy, parentFiles, patches: [patch({ contentSha256: hash })],
      observedFailedCaseIds: ["failure-1"],
    });
    expect(result.some((issue) => issue.code === "noop")).toBe(true);
  });

  it("rejects deletion unless explicitly enabled", () => {
    const result = validateArtifactMutationPlan({
      policy, parentFiles,
      patches: [patch({ operation: "remove", content: undefined, contentSha256: undefined })],
      observedFailedCaseIds: ["failure-1"],
    });
    expect(result.some((issue) => issue.code === "delete-forbidden")).toBe(true);
  });

  it("rejects removal of existing capabilities", () => {
    const result = validateArtifactMutationPlan({
      policy, parentFiles,
      patches: [patch({ preservedCapabilityIds: ["account-reset"] })],
      observedFailedCaseIds: ["failure-1"],
    });
    expect(result.some((issue) => issue.code === "capability-regression")).toBe(true);
  });

  it("rejects evidence IDs that were not observed as failures", () => {
    const result = validateArtifactMutationPlan({
      policy, parentFiles, patches: [patch({ evidenceCaseIds: ["invented-case"] })],
      observedFailedCaseIds: ["failure-1"],
    });
    expect(result.some((issue) => issue.code === "ungrounded-evidence")).toBe(true);
  });

  it("rejects duplicate file patches and excessive mutation counts", () => {
    const result = validateArtifactMutationPlan({
      policy, parentFiles, patches: [patch(), patch({ id: "patch-2" })],
      observedFailedCaseIds: ["failure-1"],
    });
    expect(result.some((issue) => issue.code === "duplicate-path")).toBe(true);
  });

  it("does not allow protected or test files to be marked mutable", () => {
    expect(ArtifactFileDescriptorSchema.safeParse({
      path: "SKILL.md", role: "protected", mutable: true, sha256: hash, patchMode: "full",
    }).success).toBe(false);
    expect(ArtifactFileDescriptorSchema.safeParse({
      path: "tests/acceptance.json", role: "test", mutable: true, sha256: hash, patchMode: "full",
    }).success).toBe(false);
  });

  it("requires dependencies to resolve and mutable files to be allowlisted", () => {
    const result = ArtifactEvolutionContractSchema.safeParse({
      version: "artifact-evolution-contract-v1",
      artifactId: "agent-1",
      artifactType: "agent-skill",
      parentCandidateId: "parent-1",
      files: [
        { path: "SKILL.md", role: "protected", mutable: false, sha256: hash, patchMode: "full" },
        { path: "config/routing.json", role: "target", mutable: true, sha256: hash, patchMode: "json-patch", dependsOn: ["missing/file"] },
      ],
      mutationPolicy: policy,
    });
    expect(result.success).toBe(false);
  });

  it("requires reflection to separate fixed cases from remaining failures", () => {
    const result = ArtifactReflectionEvidenceSchema.safeParse({
      parentCandidateId: "parent-1",
      failureCaseIds: ["failure-1"],
      fixedCaseIds: ["failure-1"],
      remainingFailureCaseIds: ["not-observed"],
      diagnosis: "The first mutation did not resolve the root cause.",
      mutationPlan: [],
    });
    expect(result.success).toBe(false);
  });

  it("blocks reflection plans that cite failures outside the observed evidence", () => {
    const reflection = ArtifactReflectionEvidenceSchema.parse({
      parentCandidateId: "parent-1",
      failureCaseIds: ["failure-1"],
      fixedCaseIds: [],
      remainingFailureCaseIds: ["failure-1"],
      antiPatterns: ["Do not reorder all categories."],
      diagnosis: "One observed case remains.",
      mutationPlan: [patch({ evidenceCaseIds: ["failure-1"] })],
    });
    expect(artifactReflectionEvidenceBlocker(reflection, ["failure-1"], "parent-1")).toBeUndefined();
    expect(artifactReflectionEvidenceBlocker(reflection, ["other-failure"], "parent-1")).toContain("unobserved");
  });

  it("rejects overlapping writable and protected path policies", () => {
    expect(ArtifactMutationPolicySchema.safeParse({
      allowedPaths: ["SKILL.md"], protectedPaths: ["SKILL.md"],
    }).success).toBe(false);
  });

  it("requires exact output hashes for add and update mutations", () => {
    expect(ArtifactMutationPatchSchema.safeParse({
      ...patch(), contentSha256: undefined,
    }).success).toBe(false);
    expect(ArtifactMutationPatchSchema.safeParse({
      ...patch(), operation: "add", expectedParentSha256: undefined, contentSha256: undefined,
    }).success).toBe(false);
  });

  it("rejects a new file when the parent already contains that path", () => {
    const result = validateArtifactMutationPlan({
      policy, parentFiles, patches: [patch({
        operation: "add", path: "config/routing.json", expectedParentSha256: undefined,
      })], observedFailedCaseIds: ["failure-1"],
    });
    expect(result.some((issue) => issue.code === "unexpected-parent")).toBe(true);
  });

  it("rejects oversized patch content", () => {
    const result = validateArtifactMutationPlan({
      policy, parentFiles, patches: [patch({ content: "x".repeat(2048) })],
      observedFailedCaseIds: ["failure-1"],
    });
    expect(result.some((issue) => issue.code === "content-too-large")).toBe(true);
  });
  it("rejects reflections bound to a different parent candidate", () => {
    const reflection = ArtifactReflectionEvidenceSchema.parse({
      parentCandidateId: "parent-old",
      failureCaseIds: ["failure-1"],
      fixedCaseIds: [],
      remainingFailureCaseIds: ["failure-1"],
      diagnosis: "The previous candidate still fails.",
      mutationPlan: [],
    });
    expect(artifactReflectionEvidenceBlocker(reflection, ["failure-1"], "parent-current")).toContain("parent candidate");
  });
  it("exposes a simple per-file blocker for protected and non-allowlisted files", () => {
    expect(artifactFileMutationBlocker({
      path: "SKILL.md", role: "protected", mutable: false,
    }, policy)).toContain("immutable");
    expect(artifactFileMutationBlocker({
      path: "config/routing.json", role: "target", mutable: true,
    }, policy)).toBeUndefined();
  });
});