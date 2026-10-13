import { createHash } from "node:crypto";
import { ArtifactMetadataSchema, CandidateSchema, TestCaseSchema, type ArtifactMetadata, type Candidate, type EvolveProject, type TestCase } from "@evolution/contracts";
import { compareHtmlCompleteSourceRetention } from "@evolution/core";
import { getServerArtifactStore } from "./artifact-runtime";
import { readServerHtmlProtectionInputs, type ServerHtmlProtectionInputPorts } from "./server-html-protection-input";

export type ServerHtmlCompleteSourceRetentionPorts = ServerHtmlProtectionInputPorts & {
  getMetadata(id: string): Promise<ArtifactMetadata | undefined>;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const callerState = (args: { project: EvolveProject; testCase: TestCase; criterionId: string; candidate?: Candidate }) =>
  digest({ project: args.project, testCase: args.testCase, criterionId: args.criterionId, candidate: args.candidate });

/** Internal read-only facts, not a public/model proof input or a protection settlement. */
export async function collectServerHtmlCompleteSourceRetention(args: {
  project: EvolveProject; testCase: TestCase; criterionId: string; candidate?: Candidate;
  ports?: ServerHtmlCompleteSourceRetentionPorts;
}) {
  if (Object.keys(args).some(key => !["project", "testCase", "criterionId", "candidate", "ports"].includes(key))) {
    throw Error("Invalid complete-source collection input");
  }
  const captured = callerState(args), project = structuredClone(args.project);
  const testCase = TestCaseSchema.parse(structuredClone(args.testCase)), criterionId = args.criterionId;
  const candidate = args.candidate ? CandidateSchema.parse(structuredClone(args.candidate)) : undefined;
  if (candidate) {
    const stored = project.candidates.filter(item => item.id === candidate.id);
    if (stored.length !== 1 || digest(CandidateSchema.parse(stored[0])) !== digest(candidate)) {
      throw Error("Complete-source Candidate differs from stored Mission subject");
    }
  }
  const store = args.ports ?? getServerArtifactStore();
  const getMetadata = store.getMetadata?.bind(store);
  if (!getMetadata) throw Error("Complete-source metadata anchor is unavailable");
  const getArtifact = "getArtifact" in store ? store.getArtifact.bind(store) : store.get.bind(store);
  const ports = { getArtifact };
  // The input reader pins exact unique stored paper/scope and physical frozen bytes.
  const first = await readServerHtmlProtectionInputs({ project, testCase, criterionId, candidate, ports });
  const source = project.sourceArtifacts.find(item => item.id === first.binding.original.sourceArtifactId)!;
  if (source.inputMode === "paste" && !source.storageRef?.trim()) throw Error("Complete-source physical Original receipt is unavailable");
  const originalId = source.storageRef?.trim() || source.id;
  const selected = first.binding.subject.kind === "candidate" ? candidate
    : project.searchChampion?.candidate;
  const snapshot = selected?.artifactSnapshots.find(item => item.sourceArtifactId === source.id);
  const executedId = snapshot?.frozenArtifact?.blobId ?? originalId;
  async function metadata(id: string, expected: { sha256: string; byteLength: number }) {
    const raw = await getMetadata!(id);
    if (!raw) throw Error("Complete-source metadata anchor is missing");
    const row = ArtifactMetadataSchema.parse(structuredClone(raw));
    if (row.id !== id || row.sha256 !== expected.sha256 || row.sizeBytes !== expected.byteLength
      || row.missionId !== undefined && row.missionId !== project.id) {
      throw Error("Complete-source bytes differ from stored metadata anchor");
    }
    return row;
  }
  function sharedAnchor(row: ArtifactMetadata, expected: { sha256: string; byteLength: number }) {
    if (row.sha256 !== expected.sha256 || row.sizeBytes !== expected.byteLength) {
      throw Error("Complete-source shared Blob metadata anchor differs between arms");
    }
    return row;
  }
  const originalBefore = await metadata(originalId, first.binding.original);
  const executedBefore = executedId === originalId ? sharedAnchor(originalBefore, first.binding.executed) : await metadata(executedId, first.binding.executed);
  // Re-read bytes between independent stored metadata observations. A computed hash
  // alone cannot replace the stored anchor or certify an earlier uploaded file.
  const second = await readServerHtmlProtectionInputs({ project, testCase, criterionId, candidate, ports });
  const originalAfter = await metadata(originalId, second.binding.original);
  const executedAfter = executedId === originalId ? sharedAnchor(originalAfter, second.binding.executed) : await metadata(executedId, second.binding.executed);
  if (digest(first.binding) !== digest(second.binding) || first.originalHtml !== second.originalHtml
    || first.executedHtml !== second.executedHtml || digest(originalBefore) !== digest(originalAfter)
    || digest(executedBefore) !== digest(executedAfter) || callerState(args) !== captured) {
    throw Error("Complete-source paper, subject, bytes or metadata changed during collection");
  }
  const comparison = compareHtmlCompleteSourceRetention({ originalHtml: second.originalHtml, currentHtml: second.executedHtml });
  return {
    schemaVersion: "server-html-complete-source-retention-facts-v1" as const,
    binding: second.binding,
    storedAnchors: {
      original: { blobId: originalId, ...second.binding.original, metadataSha256: digest(originalAfter) },
      executed: { blobId: executedId, ...second.binding.executed, metadataSha256: digest(executedAfter) },
    },
    comparison,
    limitations: [
      "Read-only physical bytes were matched to stored metadata; earlier upload custody still requires its independently retained receipt.",
      "Source reconstruction and additions are facts, not modification permission or a protection verdict.",
      "No browser, semantic, visual, signing, Hidden settlement or Gate F execution occurred.",
    ],
  };
}
