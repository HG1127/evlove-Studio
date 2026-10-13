import { describe, expect, it } from "vitest";
import { experimentRecoveryFixture } from "@evolution/testkit";
import { campaignScoringInputFingerprint, campaignScoringInputLegacyV1Fingerprint, campaignScoringInputBlocker } from "./campaign-scoring-input";

describe("explicit pre-protection-policy scoring identity", () => {
  it("keeps legacy identity separate from current scoring and refuses legacy score reuse", () => {
    const p = experimentRecoveryFixture().project;
    const current = campaignScoringInputFingerprint(p), legacy = campaignScoringInputLegacyV1Fingerprint(p);
    expect(current).not.toBe(legacy);
    const scored = { ...p, campaign: { ...p.campaign, currentRound: 1, scoringInputFingerprint: legacy } };
    expect(campaignScoringInputBlocker(scored)).toBeDefined();
    expect(campaignScoringInputFingerprint(p)).toBe(current);
  });
  it.each(["source", "goal", "visible", "hidden", "rubric", "target", "protected", "editable"])("still binds the real %s input in legacy identity", kind => {
    const p = experimentRecoveryFixture().project, legacy = campaignScoringInputLegacyV1Fingerprint(p);
    if (kind === "source") p.sourceArtifacts[0]!.textContent += " changed";
    if (kind === "goal") p.goal += " changed";
    if (kind === "visible") p.evalSuite[0]!.input += " changed";
    if (kind === "hidden") p.hiddenEvalSuite[0]!.input += " changed";
    if (kind === "rubric") p.acceptanceRubric[0]!.requirement += " changed";
    if (kind === "target") p.targetConnection.connectionId += " changed";
    if (kind === "protected") p.protectedItems.push("new protection");
    if (kind === "editable") p.editableItems.push("new permission");
    expect(campaignScoringInputLegacyV1Fingerprint(p)).not.toBe(legacy);
  });
});
