import {createHash} from "node:crypto";
import type {ArtifactRole} from "@evolution/contracts";

export type SourceParseIdentityInput={
  artifactId:string;
  name:string;
  mimeType:string;
  role:ArtifactRole;
  bytes:Uint8Array;
};

export function sourceParseContentSha256(bytes:Uint8Array){
  return createHash("sha256").update(bytes).digest("hex");
}

export function sourceParseIdempotencyIdentity(input:SourceParseIdentityInput){
  const contentSha256=sourceParseContentSha256(input.bytes);
  const semanticIdentity=[
    "parse-v2",
    input.artifactId,
    input.role,
    input.name.trim(),
    input.mimeType.trim().toLowerCase(),
    contentSha256,
  ].join("\u0000");
  const keyDigest=createHash("sha256").update(semanticIdentity,"utf8").digest("hex");
  return {
    contentSha256,
    idempotencyKey:`parse-v2:${keyDigest}`,
  };
}
