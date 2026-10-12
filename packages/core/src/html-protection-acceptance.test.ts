import {describe,it,expect} from "vitest";
import {acceptedLegacyHtmlPaperFixture} from "@evolution/testkit";
import {acceptanceArtifacts,assertDeliverablePackageIdentity,deliveryReadiness,materializeAcceptedCandidatePackage,materializeAcceptedChampionPackage,settleArtifactAcceptanceFromValidation} from "./index";
describe("prior generated HTML paper cannot approve delivery",()=>{
 it("keeps direct Gate F unverified even with matching stored scores, fingerprints and frozen bytes",()=>{
  const f=acceptedLegacyHtmlPaperFixture();
  const result=settleArtifactAcceptanceFromValidation({project:f.project,candidate:f.current,validation:f.project.validationRun,frozenArtifacts:f.project.artifactAcceptance.frozenArtifacts!});
  expect(result.status).toBe("unverified");expect(result.acceptedAt).toBeUndefined();expect(result.hardGatePass).toBe(false);
  expect(result.summary).toContain("html-protection-contract-pending");
 });
 it.each([false,true])("rejects persisted package and release eligibility (%s)",withChampion=>{
  const f=acceptedLegacyHtmlPaperFixture(withChampion);
  expect(f.project.outputArtifacts.some(a=>a.kind==="primary"&&a.accepted)).toBe(true);
  expect(deliveryReadiness(f.project).ready).toBe(false);
  expect(deliveryReadiness(f.project).reasons.join(" ")).toContain("html-protection-contract-pending");
  expect(()=>assertDeliverablePackageIdentity(f.project)).toThrow("html-protection-contract-pending");
 });
 it.each([false,true])("rejects stored ZIP identity independently (%s)",withChampion=>{
  expect(()=>assertDeliverablePackageIdentity(acceptedLegacyHtmlPaperFixture(withChampion).project)).toThrow("html-protection-contract-pending");
 });
 it("does not generate accepted primary files or a current Candidate package",()=>{
  const f=acceptedLegacyHtmlPaperFixture();
  expect(acceptanceArtifacts(f.project,f.current,f.project.artifactAcceptance).some(a=>a.accepted)).toBe(false);
  expect(()=>materializeAcceptedCandidatePackage(f.project,f.current,f.project.artifactAcceptance)).toThrow();
 });
 it("does not regenerate accepted Champion output",()=>{
  const f=acceptedLegacyHtmlPaperFixture(true);
  expect(()=>materializeAcceptedChampionPackage(f.project)).toThrow("html-protection-contract-pending");
 });
});
