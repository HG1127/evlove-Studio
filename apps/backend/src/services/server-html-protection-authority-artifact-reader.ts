import { createHash } from "node:crypto";
import { ArtifactMetadataSchema, type ArtifactStorePort, type EvolveProject } from "@evolution/contracts";
import { getServerArtifactStore } from "./artifact-runtime";
import { htmlProtectionCanonicalJson } from "./server-html-protection-authority-attestation";
/** Internal physical reader. Every complete byte read is bracketed by independent metadata reads. */
export function createServerHtmlProtectionPhysicalReader(args: { project: EvolveProject; store?: ArtifactStorePort;
  getArtifact?: (id: string) => Promise<Blob | undefined> }) {
  const store = args.store ?? getServerArtifactStore(), get = args.getArtifact ?? (id => store.get(id)), pinned = new Map<string, string>();
  const sources = args.project.sourceArtifacts.filter(item => item.role === "target"), originals = new Map(sources.filter(item => item.inputMode !== "paste" || item.storageRef?.trim())
    .map(item => [item.storageRef?.trim() || item.id, item]));
  const candidates = [...args.project.candidates, ...(args.project.searchChampion?.candidate ? [args.project.searchChampion.candidate] : []),
    ...args.project.evolutionArchive.filter(item => item.kind === "champion").map(item => item.candidate)];
  const frozen = new Map<string, { sha256: string; size: number; mimeType: string }>();
  for (const candidate of candidates) for (const snapshot of candidate.artifactSnapshots) {
    const receipt = snapshot.frozenArtifact;
    if (!receipt) continue;
    const prior = frozen.get(receipt.blobId), next = { sha256: receipt.sha256, size: receipt.size, mimeType: receipt.mimeType };
    if (prior && htmlProtectionCanonicalJson(prior) !== htmlProtectionCanonicalJson(next)) throw Error("html-protection-frozen-blob-identity-ambiguous");
    frozen.set(receipt.blobId, next);
  }
  const metadata = async (id: string) => {
    if (!store.getMetadata) throw Error("html-protection-physical-metadata-unavailable");
    const result = ArtifactMetadataSchema.safeParse(await store.getMetadata(id));
    if (!result.success || result.data.id !== id || result.data.missionId && result.data.missionId !== args.project.id) throw Error("html-protection-physical-metadata-foreign");
    return result.data;
  };
  const read = async (id: string): Promise<Blob> => {
    const original = originals.get(id), expected = frozen.get(id);
    if (!original && !expected) throw Error("html-protection-physical-artifact-outside-subject");
    const before = await metadata(id), wire = htmlProtectionCanonicalJson(before), blob = await get(id);
    if (!blob || blob.size !== before.sizeBytes || blob.type !== before.mimeType) throw Error("html-protection-physical-file-metadata-mismatch");
    const bytes = Buffer.from(await blob.arrayBuffer()), digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== before.sizeBytes || digest !== before.sha256
      || expected && (digest !== expected.sha256 || bytes.length !== expected.size || before.mimeType !== expected.mimeType)
      || original && (bytes.length !== original.size || before.mimeType !== original.mimeType)) throw Error("html-protection-physical-subject-metadata-mismatch");
    if (htmlProtectionCanonicalJson(await metadata(id)) !== wire || pinned.has(id) && pinned.get(id) !== wire) throw Error("html-protection-physical-metadata-drift");
    pinned.set(id, wire);
    // Return the fully read immutable bytes; a mutable custom Blob/port cannot change after verification.
    return new Blob([new Uint8Array(bytes).buffer], { type: before.mimeType });
  };
  return { getArtifact: read, assertStable: async () => { for (const id of [...pinned.keys()]) await read(id); },
    metadataIdentity: () => htmlProtectionCanonicalJson([...pinned].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) };
}
