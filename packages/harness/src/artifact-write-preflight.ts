import { ArtifactRelativePathSchema, ArtifactWriteGovernanceSchema } from "@evolution/contracts";
import { validateArtifactWriteSet, type ArtifactByteMutation } from "@evolution/core";

export interface ArtifactWriteChange {
  path: string;
  operation: "add" | "update" | "remove";
  content?: string;
}

/** Ports only. Pass the same immutable parent bytes used by the writer; no persistence occurs here. */
export async function preflightArtifactWrite(args: {
  governance: unknown;
  parentBytes: Uint8Array;
  changes: ArtifactWriteChange[];
  fingerprint(bytes: Uint8Array): Promise<string>;
  readParentFile(path: string): Promise<Uint8Array | undefined>;
}): Promise<void> {
  const governance = ArtifactWriteGovernanceSchema.parse(args.governance);
  const actualParent = await args.fingerprint(args.parentBytes);
  if (actualParent !== governance.parentSha256) throw new Error("ARTIFACT_WRITE_STALE_PARENT: approved parent bytes changed");
  const writes: ArtifactByteMutation[] = [];
  for (const change of args.changes) {
    // A path is rejected before it can reach the injected file reader.
    if (!ArtifactRelativePathSchema.safeParse(change.path).success) throw new Error("ARTIFACT_WRITE_DENIED: invalid-path " + change.path);
    const prior = await args.readParentFile(change.path);
    if (change.operation !== "remove" && typeof change.content !== "string") throw new Error("ARTIFACT_WRITE_CONTENT_MISSING");
    const content = change.operation === "remove" ? undefined : new TextEncoder().encode(change.content!);
    writes.push({
      path: change.path, operation: change.operation,
      parentSha256: prior === undefined ? undefined : await args.fingerprint(prior),
      contentSha256: content === undefined ? undefined : await args.fingerprint(content),
      sizeBytes: content?.byteLength ?? 0,
    });
  }
  const issues = validateArtifactWriteSet(governance.policy, writes);
  if (issues.length) throw new Error("ARTIFACT_WRITE_DENIED: " + issues.map((issue) => issue.code + " " + (issue.path ?? "")).join("; "));
}
