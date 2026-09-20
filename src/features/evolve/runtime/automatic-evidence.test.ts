import { describe, expect, it } from "vitest";
import { automaticEvidenceKey } from "./automatic-evidence";
import { demoProject } from "../data/mock-project";

describe("automatic evidence lifecycle", () => {
  it("does not restart when only evolution state changes", () => {
    const first = automaticEvidenceKey(demoProject);
    const evolved = {
      ...demoProject,
      campaign: { ...demoProject.campaign, currentRound: demoProject.campaign.currentRound + 1 },
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    };
    expect(automaticEvidenceKey(evolved)).toBe(first);
  });

  it("restarts when executable E2E steps change", () => {
    const base = {
      ...demoProject,
      evalSuite: [{
        id: "browser-1",
        title: "保存",
        input: "保存内容",
        expected: ["出现成功提示"],
        tags: [],
        hidden: false,
        criterionIds: [],
        executionMode: "external-runner" as const,
        evidenceScope: "product-behavior" as const,
        browserSteps: [
          { action: "click" as const, selector: "#save" },
          { action: "text" as const, selector: "#status", value: "已保存" },
        ],
      }],
    };
    const first = automaticEvidenceKey(base);
    const changed = {
      ...base,
      evalSuite: base.evalSuite.map((test) => ({
        ...test,
        browserSteps: [...test.browserSteps, { action: "visible" as const, selector: "#result" }],
      })),
    };
    expect(automaticEvidenceKey(changed)).not.toBe(first);
  });

  it("restarts when the source material fingerprint changes", () => {
    const first = automaticEvidenceKey(demoProject);
    const sourceArtifacts = demoProject.sourceArtifacts.map((artifact, index) => index === 0 ? { ...artifact, size: artifact.size + 1 } : artifact);
    expect(automaticEvidenceKey({ ...demoProject, sourceArtifacts })).not.toBe(first);
  });
});

