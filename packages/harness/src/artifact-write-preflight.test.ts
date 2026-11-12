import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ArtifactWriteGovernanceSchema } from "@evolution/contracts";
import { preflightArtifactWrite } from "./artifact-write-preflight";

const bytes = (text: string) => new TextEncoder().encode(text);
const fingerprint = async (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
async function fixture() {
  const parentBytes = bytes("parent artifact");
  const governance = ArtifactWriteGovernanceSchema.parse({ version:"artifact-write-governance-v1", parentSha256:await fingerprint(parentBytes),
    policy:{allowedPaths:["config.json","new.txt"],protectedPaths:["tests"],maxFileBytes:20,maxChangedFiles:2} });
  const readParentFile = vi.fn(async (path:string) => path==="config.json"?bytes("old"):undefined);
  return {governance,parentBytes,fingerprint,readParentFile};
}

describe("trusted artifact write preflight", () => {
  it("computes parent/output hashes from actual bytes and accepts a legal update", async () => {
    await expect(preflightArtifactWrite({...await fixture(),changes:[{path:"config.json",operation:"update",content:"new"}]})).resolves.toBeUndefined();
  });
  it("rejects stale root bytes before reading files", async () => {
    const f=await fixture();
    await expect(preflightArtifactWrite({...f,parentBytes:bytes("different"),changes:[]})).rejects.toThrow("STALE_PARENT");
    expect(f.readParentFile).not.toHaveBeenCalled();
  });
  it("rejects traversal before invoking the file reader", async () => {
    const f=await fixture();
    await expect(preflightArtifactWrite({...f,changes:[{path:"../outside",operation:"add",content:"x"}]})).rejects.toThrow("invalid-path");
    expect(f.readParentFile).not.toHaveBeenCalled();
  });
  it("rejects a no-op using measured hashes", async () => {
    await expect(preflightArtifactWrite({...await fixture(),changes:[{path:"config.json",operation:"update",content:"old"}]})).rejects.toThrow("noop");
  });
  it("rejects unapproved deletion", async () => {
    await expect(preflightArtifactWrite({...await fixture(),changes:[{path:"config.json",operation:"remove"}]})).rejects.toThrow("delete-forbidden");
  });
  it("measures UTF-8 bytes instead of character counts", async () => {
    await expect(preflightArtifactWrite({...await fixture(),changes:[{path:"config.json",operation:"update",content:"汉".repeat(7)}]})).rejects.toThrow("content-too-large");
  });
  it("rejects protected descendants and arbitrary new files", async () => {
    const f=await fixture();
    await expect(preflightArtifactWrite({...f,changes:[{path:"tests/answers.json",operation:"add",content:"x"}]})).rejects.toThrow("protected-path");
    await expect(preflightArtifactWrite({...f,changes:[{path:"unapproved.txt",operation:"add",content:"x"}]})).rejects.toThrow("not-allowlisted");
  });
  it("validates malformed policy instead of silently disabling protection", async () => {
    await expect(preflightArtifactWrite({...await fixture(),governance:null,changes:[]})).rejects.toThrow();
  });
  it("allows explicitly authorized additions without inventing failure evidence", async () => {
    await expect(preflightArtifactWrite({...await fixture(),changes:[{path:"new.txt",operation:"add",content:"new"}]})).resolves.toBeUndefined();
  });
});
