import { createHash } from "node:crypto";
import type { Candidate, CandidateArtifactSnapshot, EvolveProject } from "@evolution/contracts";
import { trustedServerBaselineChampion } from "@evolution/harness";
import { getServerArtifactStore } from "./artifact-runtime";
import { serverArtifactSha256, verifyServerCandidateFrozenArtifact } from "./server-experiment-artifacts";

async function frozenBinding(snapshot: CandidateArtifactSnapshot) {
  if (!await verifyServerCandidateFrozenArtifact(snapshot)) throw new Error("Hidden 文件冻结身份不可用。");
  const receipt = snapshot.frozenArtifact!;
  return { sourceArtifactId: snapshot.sourceArtifactId, snapshotHash: receipt.snapshotHash,
    blobId: receipt.blobId, sha256: receipt.sha256, size: receipt.size, name: receipt.name, mimeType: receipt.mimeType };
}

/** Read physical identity locally through the Artifact port; never execute or export user files. */
export async function readServerHoldoutArtifactFingerprint({ project, candidate,observationDeploymentSha }: { project: EvolveProject; candidate: Candidate;observationDeploymentSha?:string|null }): Promise<string | undefined> {
  if (project.targetConnection.adapter !== "artifact") return undefined;
  const sources = project.sourceArtifacts;
  const targets = sources.filter(source => source.role === "target");
  if (!targets.length || sources.length > 12 || new Set(sources.map(source => source.id)).size !== sources.length
    || candidate.artifactSnapshots.length !== targets.length
    || new Set(candidate.artifactSnapshots.map(snapshot => snapshot.sourceArtifactId)).size !== targets.length
    || candidate.artifactSnapshots.some(snapshot => !targets.some(source => source.id === snapshot.sourceArtifactId))) return undefined;
  const champion = project.searchChampion ? trustedServerBaselineChampion(project) : undefined;
  if (project.searchChampion && !champion) return undefined;
  const store = getServerArtifactStore();
  const current = [];
  for (const source of sources) {
    const snapshots = source.role === "target" ? champion?.artifactSnapshots.filter(snapshot => snapshot.sourceArtifactId === source.id) ?? [] : [];
    if (champion && source.role === "target" && snapshots.length !== 1) return undefined;
    if (snapshots[0]) {
      current.push({ id: source.id, role: source.role, frozen: await frozenBinding(snapshots[0]) });
      continue;
    }
    const blobId = source.storageRef?.trim() || (source.inputMode === "upload" ? source.id : undefined);
    if (blobId) {
      const blob = await store.get(blobId);
      if (!blob || blob.size !== source.size || blob.size > 25_000_000) return undefined;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.byteLength !== blob.size) return undefined;
      current.push({ id: source.id, role: source.role, blobId, size: bytes.length, sha256: await serverArtifactSha256(bytes) });
    } else {
      if (source.inputMode !== "paste" || !source.textContent?.trim()) return undefined;
      const bytes = new TextEncoder().encode(source.textContent);
      current.push({ id: source.id, role: source.role, size: bytes.length, sha256: await serverArtifactSha256(bytes) });
    }
  }
  const frozen = [];
  for (const snapshot of candidate.artifactSnapshots) frozen.push(await frozenBinding(snapshot));
  return createHash("sha256").update(JSON.stringify({
    version: "server-holdout-artifact-binding-v1", deploymentSha: observationDeploymentSha===null?undefined:observationDeploymentSha??process.env.VERCEL_GIT_COMMIT_SHA,
    current, candidate: { id: candidate.id, frozen },
  })).digest("hex");
}
