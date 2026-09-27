import { describe, expect, it } from "vitest";
import type { EvolveProject, TargetRunResult, TestCase } from "@evolution/contracts";
import { currentSemanticArtifactContext, storedBaselineEvidence } from "./server-baseline-evidence";
import { executeServerCurrentArtifactSuite } from "./server-current-artifact-runner";

const testCase: TestCase = { id: "H1", title: "Check guide", input: "Check actual file", expected: [], tags: [], hidden: true, criterionIds: [], executionMode: "static-evidence", evidenceScope: "implementation" };
function project(stored = true): EvolveProject {
  return { sourceArtifacts: [{ id: "guide", role: "target", name: "guide.md", extension: "md", storageRef: stored ? "raw-guide" : undefined, textContent: "STALE METADATA", structure: [] }], acceptanceRubric: [] } as unknown as EvolveProject;
}

describe("Server current-version file evidence routing", () => {
  it("never upgrades uploaded Source metadata when the stored file port is missing", async () => {
    const current = project();
    const result = await storedBaselineEvidence(current, testCase);
    expect(result?.verificationStatus).toBe("unverified");
    expect(result?.output).toContain("实际文件读取端口");
  });
  it("runs the stored evidence port in the hidden current-version suite", async () => {
    const current = project();
    const verified: TargetRunResult = { testCaseId: "H1", output: "ACTUAL FILE", latencyMs: 0, cost: 0, verificationStatus: "verified", trace: [] };
    const runs = await executeServerCurrentArtifactSuite(current, [testCase], {
      executeSemanticBatch: async () => ({ results: [] }), judge: async () => { throw new Error("not needed"); },
      executeStoredEvidence: async () => verified,
    });
    expect(runs[0]).toEqual(verified);
    expect((await storedBaselineEvidence(current, testCase, async () => ({ ...verified, testCaseId: "wrong" })))?.verificationStatus).toBe("unverified");
  });
  it("refuses an uploaded Source without its Blob reference and never uses one file for Pairwise", async () => {
    const uploaded = project(false);
    uploaded.sourceArtifacts[0]!.inputMode = "upload";
    expect((await storedBaselineEvidence(uploaded, testCase))?.verificationStatus).toBe("unverified");
    const pairwise = { ...testCase, criterionIds: ["SYS-PAIRWISE"] };
    const port = async () => { throw new Error("Pairwise must not read a static file"); };
    expect((await storedBaselineEvidence(project(), pairwise, port))?.verificationStatus).toBe("unverified");
  });  it("rejects stale semantic context without a file port and downgrades truncated evidence", async () => {
    const current = project();
    await expect(currentSemanticArtifactContext(current)).rejects.toThrow("实际文件语义上下文端口");
    const semantic = { ...testCase, executionMode: "artifact-runtime" as const };
    const runs = await executeServerCurrentArtifactSuite(current, [semantic], {
      buildCurrentArtifactContext: async () => [{ id: "guide", content: "ACTUAL FILE", truncated: true }],
      executeSemanticBatch: async () => ({ results: [{ testCaseId: "H1", output: "ACTUAL FILE", trace: [] }] }),
      judge: async () => { throw new Error("not needed"); },
    });
    expect(runs[0]?.verificationStatus).toBe("partial");
    const missing = await executeServerCurrentArtifactSuite(current, [semantic], {
      buildCurrentArtifactContext: async () => [],
      executeSemanticBatch: async () => { throw new Error("stale context must not reach AI"); },
      judge: async () => { throw new Error("not needed"); },
    });
    expect(missing[0]?.verificationStatus).toBe("unverified");
  });  it("keeps direct pasted text on the local evidence path", async () => {
    expect(await storedBaselineEvidence(project(false), testCase)).toBeUndefined();
  });
});