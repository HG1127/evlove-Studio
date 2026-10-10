import {describe,it,expect,vi} from "vitest";
import {acceptedLegacyHtmlPaperFixture} from "@evolution/testkit";
import {runServerHoldout,type ServerHoldoutPorts} from "./server-holdout";
describe("persisted old HTML paper after Experiment",()=>{
 it("persists a recoverable pause before any execution without rewriting frozen papers",async()=>{
  const f=acceptedLegacyHtmlPaperFixture();
  f.project.campaign.checkpoint={round:1,completedPhase:"experiment",at:f.project.updatedAt};
  const before=structuredClone({visible:f.project.evalSuite,hidden:f.project.hiddenEvalSuite});
  const unavailable=vi.fn(async()=>{throw new Error("Preflight must not call ports");});
  const ports:ServerHoldoutPorts={
   current:{executeSemanticBatch:unavailable,judge:unavailable,executeExternalBatch:unavailable},
   candidate:{executeSemanticBatch:unavailable,judge:unavailable,executeExternalBatch:unavailable},
   readArtifactFingerprint:unavailable,releaseReview:unavailable,
  };
  const outcome=await runServerHoldout(f.project,ports);
  expect(outcome.control).toBe("stop");expect(outcome.readyForArtifactAcceptance).toBe(false);
  expect(outcome.project.campaign.stopReason).toContain("html-protection-contract-pending");
  expect(outcome.project.campaign.checkpoint).toEqual(f.project.campaign.checkpoint);
  expect(outcome.project.evalSuite).toEqual(before.visible);expect(outcome.project.hiddenEvalSuite).toEqual(before.hidden);
  expect(unavailable).not.toHaveBeenCalled();
 });
});
