import {
  ArtifactMetadataSchema, ArtifactWriteGovernanceSchema, ArtifactWriteLineageSchema,
  type ArtifactStorePort, type ArtifactWriteGovernance, type FrozenArtifact,
} from "@evolution/contracts";
export interface ArtifactWriteLineageTarget {
  missionId: string;
  sourceArtifactId: string;
  name: string;
  candidateId: string;
  frozen: Pick<FrozenArtifact, "blobId" | "sha256" | "snapshotHash" | "size">;
}
export interface ArtifactWriteLineagePorts {
  store: Pick<ArtifactStorePort, "get" | "put" | "getMetadata">;
  fingerprint(bytes: Uint8Array): Promise<string>;
}
const encoder = new TextEncoder();
const kind = "candidate-write-lineage";
const maxReceiptBytes = 16 * 1024;

function requireMetadata(ports: ArtifactWriteLineagePorts) {
  if (!ports.store.getMetadata) throw new Error("ARTIFACT_WRITE_LINEAGE_UNAVAILABLE: metadata readback required");
}
async function approvalDigest(governance: unknown, ports: ArtifactWriteLineagePorts) {
  // Zod fixes the field layout/defaults and strips no policy fields (strict schema).
  return ports.fingerprint(encoder.encode(JSON.stringify(ArtifactWriteGovernanceSchema.parse(governance))));
}
async function receiptId(target: ArtifactWriteLineageTarget, approvalSha256: string, ports: ArtifactWriteLineagePorts) {
  return "artifact-write-lineage-" + await ports.fingerprint(encoder.encode(JSON.stringify({
    missionId: target.missionId, sourceArtifactId: target.sourceArtifactId, candidateId: target.candidateId,
    approvalSha256, outputSha256: target.frozen.sha256,
  })));
}
async function readReceipt(target: ArtifactWriteLineageTarget, approvalSha256: string, ports: ArtifactWriteLineagePorts) {
  requireMetadata(ports);
  const id = await receiptId(target, approvalSha256, ports);
  const metadata = ArtifactMetadataSchema.safeParse(await ports.store.getMetadata!(id));
  const blob = await ports.store.get(id);
  if (!metadata.success || !blob || blob.size > maxReceiptBytes) throw new Error("ARTIFACT_WRITE_LINEAGE_UNVERIFIED: missing receipt or metadata");
  const m = metadata.data;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (m.id !== id || m.missionId !== target.missionId || m.kind !== kind || m.mimeType !== "application/json"
    || m.sizeBytes !== bytes.byteLength || m.sha256 !== await ports.fingerprint(bytes)) {
    throw new Error("ARTIFACT_WRITE_LINEAGE_UNVERIFIED: receipt metadata or bytes differ");
  }
  const receipt = ArtifactWriteLineageSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
  if (receipt.missionId !== target.missionId || receipt.sourceArtifactId !== target.sourceArtifactId
    || receipt.name !== target.name || receipt.candidateId !== target.candidateId || receipt.approvalSha256 !== approvalSha256
    || receipt.outputSha256 !== target.frozen.sha256 || receipt.outputBlobId !== target.frozen.blobId
    || receipt.outputSize !== target.frozen.size || receipt.outputSnapshotHash !== target.frozen.snapshotHash) {
    throw new Error("ARTIFACT_WRITE_LINEAGE_UNVERIFIED: receipt does not identify this frozen parent");
  }
  return {id, receipt};
}

/** Rebind only to a physically verified child written under the SAME immutable approval.
 * The caller verifies parent bytes; no model-supplied receipt/hash or policy is accepted here.
 * Rebinding grants permission to attempt a repair, never permission to promote it.
 */
export async function resolveArtifactWriteGovernance(args: {
  approval: unknown;
  actualParentSha256: string;
  parent?: ArtifactWriteLineageTarget;
}, ports: ArtifactWriteLineagePorts): Promise<ArtifactWriteGovernance> {
  requireMetadata(ports);
  const approval = ArtifactWriteGovernanceSchema.parse(args.approval);
  if (args.actualParentSha256 === approval.parentSha256) return approval;
  if (!args.parent || args.parent.frozen.sha256 !== args.actualParentSha256) {
    throw new Error("ARTIFACT_WRITE_STALE_PARENT: no verified governed predecessor");
  }
  await readReceipt(args.parent, await approvalDigest(approval, ports), ports);
  // Original approval/source is not mutated. All permissions and budgets remain identical.
  return {...approval, parentSha256: args.actualParentSha256};
}

/** Archive only after all targets pass preflight and the exact output bytes are frozen.
 * The store is a trusted server port; general model artifact uploads must not mint these records.
 */
export async function archiveArtifactWriteLineage(args: {
  approval: unknown;
  actualParentSha256: string;
  parentCandidateId?: string;
  target: ArtifactWriteLineageTarget;
}, ports: ArtifactWriteLineagePorts): Promise<string> {
  requireMetadata(ports);
  const approvalSha256 = await approvalDigest(args.approval, ports);
  const {target} = args;
  const output = await ports.store.get(target.frozen.blobId);
  if (!output || output.size !== target.frozen.size
    || await ports.fingerprint(new Uint8Array(await output.arrayBuffer())) !== target.frozen.sha256) {
    throw new Error("ARTIFACT_WRITE_LINEAGE_UNVERIFIED: frozen output bytes unavailable");
  }
  const receipt = ArtifactWriteLineageSchema.parse({
    version: "artifact-write-lineage-v1", missionId: target.missionId, sourceArtifactId: target.sourceArtifactId,
    name: target.name, candidateId: target.candidateId, parentCandidateId: args.parentCandidateId,
    approvalSha256, inputSha256: args.actualParentSha256, outputSha256: target.frozen.sha256,
    outputBlobId: target.frozen.blobId, outputSnapshotHash: target.frozen.snapshotHash, outputSize: target.frozen.size,
  });
  const content = JSON.stringify(receipt);
  const id = await receiptId(target, approvalSha256, ports);
  if (await ports.store.getMetadata!(id)) {
    const prior = await readReceipt(target, approvalSha256, ports);
    if (JSON.stringify(prior.receipt) !== content) throw new Error("ARTIFACT_WRITE_LINEAGE_REPLAY_CONFLICT");
    return id;
  }
  if (await ports.store.get(id)) throw new Error("ARTIFACT_WRITE_LINEAGE_UNVERIFIED: orphan receipt must not be overwritten");
  await ports.store.put(id, new Blob([content], {type: "application/json"}), {missionId: target.missionId, kind});
  const stored = await readReceipt(target, approvalSha256, ports);
  if (JSON.stringify(stored.receipt) !== content) throw new Error("ARTIFACT_WRITE_LINEAGE_UNVERIFIED: exact receipt readback differs");
  return id;
}
