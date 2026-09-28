import type { Candidate, EvolveProject, FrozenArtifact } from "@evolution/contracts";
import { readFrozenArtifact } from "./frozen-artifact";

// Early browser builders used this planning fingerprint before freezing the actual file.
function legacyFingerprint(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}

/** Repair only a legacy Candidate whose exact frozen Blob still verifies against its content. */
export async function repairLegacyFrozenCandidateIdentities(
  project: EvolveProject,
  read: (receipt: FrozenArtifact | undefined, content: string) => Promise<Blob> = readFrozenArtifact,
): Promise<EvolveProject> {
  let changed = false;
  const candidates = await Promise.all(project.candidates.map(async (candidate): Promise<Candidate> => {
    const artifactSnapshots = await Promise.all(candidate.artifactSnapshots.map(async (snapshot) => {
      const receipt = snapshot.frozenArtifact;
      if (!receipt || snapshot.contentHash !== legacyFingerprint(snapshot.content)
        || receipt.sourceArtifactId !== snapshot.sourceArtifactId) return snapshot;
      try {
        await read(receipt, snapshot.content);
      } catch {
        // Never endorse a missing, changed, or unreadable Blob by copying receipt metadata.
        return snapshot;
      }
      changed = true;
      return { ...snapshot, contentHash: receipt.snapshotHash, name: receipt.name, mimeType: receipt.mimeType };
    }));
    return { ...candidate, artifactSnapshots };
  }));
  return changed ? { ...project, candidates } : project;
}