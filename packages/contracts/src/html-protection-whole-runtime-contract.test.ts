import { describe, expect, it } from "vitest";
import { HtmlProtectionWholeRuntimeRequestSchema, HtmlProtectionWholeRuntimeRegistrationSchema } from "./html-protection-whole-runtime-contract";
const original = { sourceArtifactId: "html", sha256: "a".repeat(64), byteLength: 99 };
function input() { return { schemaVersion: "html-protection-whole-runtime-request-v1", sourceRole: "original", subjectScriptLocations: [], sourcePlanSha256: "b".repeat(64),
  binding: { missionId: "mission", testCaseId: "hidden", criterionId: "protect", paperSha256: "c".repeat(64), original, executed: original, subject: { kind: "current", versionId: "current" } },
  execution: { executionId: "execution", jobId: "job", generation: 1 }, sourcePlan: { schemaVersion: "original-owned-whole-runtime-v1", original,
    sourceCensus: { elements: 3, cards: 0, scripts: 0, styles: 0, controls: 0 }, originalElementPaths: ["0/0"], runtimeParentIds: [], scriptShape: [], viewports: [{ width: 1280, height: 900 }], queryPositive: null, queryNegative: "nomatch", gaps: [] } }; }
describe("whole runtime physical Original boundary", () => {
  it("validates only closed source/job/subject requests", () => { expect(HtmlProtectionWholeRuntimeRequestSchema.parse(input()).sourceRole).toBe("original"); });
  it("rejects Candidate-derived registration", () => { expect(HtmlProtectionWholeRuntimeRequestSchema.safeParse({ ...input(), sourceRole: "executed" }).success).toBe(false); });
  it("rejects foreign Original source identity", () => { const value=input(); value.sourcePlan.original={...original,sha256:"d".repeat(64)}; expect(HtmlProtectionWholeRuntimeRequestSchema.safeParse(value).success).toBe(false); });
  it.each(["eval", "baseUrl", "command", "sourceUrl", "key"])("rejects arbitrary %s at the request boundary", key => { expect(HtmlProtectionWholeRuntimeRequestSchema.safeParse({ ...input(), [key]: "unsafe" }).success).toBe(false); });
  it("rejects viewport and generation outside the owned bounds", () => { const value=input(); value.execution.generation=0; expect(HtmlProtectionWholeRuntimeRequestSchema.safeParse(value).success).toBe(false); });
  it("retains unknown controls instead of declaring them supported", () => { const registration=HtmlProtectionWholeRuntimeRegistrationSchema.parse({schemaVersion:"html-protection-owned-boot-registration-v1",original,sourcePlanSha256:"b".repeat(64),nativeBootSha256:"c".repeat(64),nativeElementCount:1,controls:[],revealTargets:[],gaps:["unknown-native-control"]});expect(registration.gaps).toEqual(["unknown-native-control"]); });
});
