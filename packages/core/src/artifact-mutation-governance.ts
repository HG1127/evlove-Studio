import { ArtifactRelativePathSchema } from "@evolution/contracts";
import type { ArtifactFileDescriptor, ArtifactMutationPatch, ArtifactMutationPolicy, ArtifactReflectionEvidence } from "@evolution/contracts";

import type {Candidate, EvolveProject} from "@evolution/contracts";

/** Stop exact-byte cycles (A → B → A) without inventing another repair counter or accepting a candidate. */
export function repeatedRepairOutputBlocker(project: Pick<EvolveProject,"sourceArtifacts"|"candidates">, next: Candidate): string | undefined {
  const ids=project.sourceArtifacts.filter(source=>source.role==="target").map(source=>source.id).sort();
  if(!ids.length||new Set(ids).size!==ids.length)return undefined;
  const vector=(candidate:Candidate):string|undefined=>{
    if(candidate.artifactSnapshots.length!==ids.length)return undefined;
    const rows=[];
    for(const id of ids){
      const matches=candidate.artifactSnapshots.filter(snapshot=>snapshot.sourceArtifactId===id);
      const frozen=matches.length===1?matches[0].frozenArtifact:undefined;
      if(!frozen||frozen.sourceArtifactId!==id||!/^[a-f0-9]{64}$/.test(frozen.sha256)||frozen.size<=0)return undefined;
      rows.push([id,frozen.sha256,frozen.size]);
    }
    return JSON.stringify(rows);
  };
  const proposed=vector(next);
  if(!proposed)return undefined;
  const prior=project.candidates.find(candidate=>candidate.id!==next.id&&vector(candidate)===proposed);
  return prior?"REPAIR_REPEATED_FROZEN_OUTPUT: identical target bytes already exist in Candidate "+prior.id:undefined;
}

export interface ArtifactParentFile {
  path: string;
  sha256: string;
  sizeBytes: number;
  capabilityIds?: string[];
}

export interface ArtifactMutationIssue {
  code: "invalid-path" | "not-allowlisted" | "protected-path" | "missing-parent" | "unexpected-parent"
    | "stale-parent" | "delete-forbidden" | "content-missing" | "content-too-large" | "noop"
    | "too-many-files" | "capability-regression" | "ungrounded-evidence" | "duplicate-path";
  path?: string;
  message: string;
}

/** Hashes and sizes are measured by the trusted byte adapter, not copied from an AI response. */
export interface ArtifactByteMutation {
  path: string;
  operation: "add" | "update" | "remove";
  parentSha256?: string;
  contentSha256?: string;
  sizeBytes: number;
}

function protectedPath(path: string, policy: ArtifactMutationPolicy): boolean {
  const candidate = path.toLowerCase();
  return policy.protectedPaths.some((item) => candidate === item.toLowerCase() || candidate.startsWith(item.toLowerCase() + "/"));
}

/** Shared deterministic policy for planned patches and actual output bytes. No I/O or promotion authority. */
export function validateArtifactWriteSet(policy: ArtifactMutationPolicy, writes: ArtifactByteMutation[]): ArtifactMutationIssue[] {
  const issues: ArtifactMutationIssue[] = [];
  const seen = new Set<string>();
  if (writes.length > policy.maxChangedFiles) issues.push({ code: "too-many-files", message: "Changed-file count exceeds the approved policy." });
  for (const write of writes) {
    const { path, operation } = write;
    const addIssue = (code: ArtifactMutationIssue["code"], message: string) => issues.push({ code, path, message });
    if (!ArtifactRelativePathSchema.safeParse(path).success) { addIssue("invalid-path", "Unambiguous relative artifact path required."); continue; }
    if (seen.has(path.toLowerCase())) { addIssue("duplicate-path", "Duplicate mutation or case-aliased path."); continue; }
    seen.add(path.toLowerCase());
    if (protectedPath(path, policy)) { addIssue("protected-path", "Protected files and subtrees cannot be mutated."); continue; }
    if (!policy.allowedPaths.includes(path)) { addIssue("not-allowlisted", "Path is outside the explicit writable allowlist."); continue; }
    if (operation === "add" && write.parentSha256) addIssue("unexpected-parent", "Add target already exists in parent bytes.");
    if (operation !== "add" && !write.parentSha256) addIssue("missing-parent", "Update/remove target is absent from parent bytes.");
    if (operation === "remove") {
      if (!policy.allowDelete) addIssue("delete-forbidden", "Deletion is not authorized.");
    } else {
      if (!write.contentSha256) addIssue("content-missing", "Trusted output-byte digest is required.");
      if (!Number.isSafeInteger(write.sizeBytes) || write.sizeBytes < 0 || write.sizeBytes > policy.maxFileBytes) addIssue("content-too-large", "Output size exceeds the approved file limit or is invalid.");
      if (operation === "update" && policy.rejectNoop && write.contentSha256 === write.parentSha256) addIssue("noop", "Output bytes are identical to parent bytes.");
    }
  }
  return issues;
}

export interface ArtifactMutationValidationInput {
  policy: ArtifactMutationPolicy;
  parentFiles: ArtifactParentFile[];
  patches: ArtifactMutationPatch[];
  observedFailedCaseIds: string[];
}

export function validateArtifactMutationPlan(input: ArtifactMutationValidationInput): ArtifactMutationIssue[] {
  const parentByPath = new Map(input.parentFiles.map((file) => [file.path, file]));
  const issues = validateArtifactWriteSet(input.policy, input.patches.map((patch) => ({
    path: patch.path, operation: patch.operation, parentSha256: parentByPath.get(patch.path)?.sha256,
    contentSha256: patch.contentSha256, sizeBytes: new TextEncoder().encode(patch.content ?? "").byteLength,
  })));
  const observedFailures = new Set(input.observedFailedCaseIds);
  for (const patch of input.patches) {
    const parent = parentByPath.get(patch.path);
    if (patch.operation === "add" && patch.expectedParentSha256) issues.push({ code: "unexpected-parent", path: patch.path, message: "Added files cannot claim a parent hash." });
    if (patch.operation !== "add" && parent && patch.expectedParentSha256 !== parent.sha256) issues.push({ code: "stale-parent", path: patch.path, message: "Patch is not bound to the frozen parent hash." });
    if (patch.operation !== "remove" && patch.content === undefined) issues.push({ code: "content-missing", path: patch.path, message: "Add/update patches require content." });
    if (patch.evidenceCaseIds.some((id) => !observedFailures.has(id))) issues.push({ code: "ungrounded-evidence", path: patch.path, message: "Patch cites a case outside observed failures." });
    if (input.policy.preserveExistingCapabilities && parent?.capabilityIds?.some((id) => !patch.preservedCapabilityIds.includes(id))) issues.push({ code: "capability-regression", path: patch.path, message: "An existing capability lacks a preservation attestation; tests must still verify behavior." });
  }
  return issues;
}

export function artifactReflectionEvidenceBlocker(reflection: Pick<ArtifactReflectionEvidence,"parentCandidateId"|"failureCaseIds"> & Partial<Pick<ArtifactReflectionEvidence,"remainingFailureCaseIds"|"mutationPlan">>, observedFailedCaseIds: string[], expectedParentCandidateId?: string): string | undefined {
  const observed = new Set(observedFailedCaseIds);
  if (expectedParentCandidateId && reflection.parentCandidateId !== expectedParentCandidateId) return "Reflection parent candidate does not match the frozen candidate.";
  const cited = new Set(reflection.failureCaseIds);
  for (const id of cited) if (!observed.has(id)) return "Reflection cites an unobserved failure case: " + id + ".";
  for (const id of reflection.remainingFailureCaseIds ?? []) {
    if (!cited.has(id) || !observed.has(id)) return "Reflection references an unobserved remaining failure: " + id + ".";
  }
  for (const patch of reflection.mutationPlan ?? []) {
    for (const id of patch.evidenceCaseIds) if (!observed.has(id)) return "Mutation " + patch.id + " references an unobserved failure case: " + id + ".";
  }
  return undefined;
}

export function artifactFileMutationBlocker(file: Pick<ArtifactFileDescriptor, "path" | "role" | "mutable">, policy: ArtifactMutationPolicy): string | undefined {
  if (!ArtifactRelativePathSchema.safeParse(file.path).success) return "Artifact file path is not a normalized relative path.";
  if (file.role === "protected" || file.role === "test" || !file.mutable) return "Artifact file is immutable.";
  if (protectedPath(file.path, policy)) return "Artifact file is protected by mutation policy.";
  if (!policy.allowedPaths.includes(file.path)) return "Artifact file is not explicitly allowlisted.";
  return undefined;
}
