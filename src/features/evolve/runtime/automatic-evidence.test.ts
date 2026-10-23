import { describe, expect, it } from "vitest";
import { automaticEvidenceKey,canAutoAdoptDiscoveredRunner } from "./automatic-evidence";
import { demoProject } from "../data/mock-project";

describe("automatic evidence lifecycle", () => {
  it("never auto-replaces a real uploaded Artifact with a connected HTTP Target Proxy",()=>{
    const imported={...demoProject,
      sourceArtifacts:[{...demoProject.sourceArtifacts[0]!,extension:"html"}],
      targetConnection:{...demoProject.targetConnection,adapter:"artifact" as const},
    };
    expect(canAutoAdoptDiscoveredRunner(imported)).toBe(false);
    expect(canAutoAdoptDiscoveredRunner({
      ...imported,sourceArtifacts:[{...imported.sourceArtifacts[0]!,role:"reference" as const}],
      targetConnection:{...imported.targetConnection,adapter:"mock" as const},
    })).toBe(true);
    expect(canAutoAdoptDiscoveredRunner({
      ...imported,targetConnection:{...imported.targetConnection,adapter:"http" as const},
    })).toBe(false);
  });

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

