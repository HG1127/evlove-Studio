import {describe,it,expect} from "vitest";
import {acceptedLegacyHtmlPaperFixture} from "@evolution/testkit";
import {acceptanceArtifacts,evidenceFingerprint,assertDeliverablePackageIdentity,deliveryReadiness,materializeAcceptedCandidatePackage,materializeAcceptedChampionPackage,settleArtifactAcceptanceFromValidation} from "./index";
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

describe("whole HTML protection acceptance cannot be reduced to evidence slices",()=>{
 it.each(["search","static","mixed"] as const)("keeps %s high matched Hidden/frozen Gate F unverified without whole authority",mode=>{
  const f=acceptedLegacyHtmlPaperFixture(false,mode);
  expect(f.project.hiddenEvalSuite.every(t=>!t.tags.length)).toBe(true);
  expect(f.project.artifactAcceptance.status).toBe("passed");
  expect(f.project.artifactAcceptance.overallScore).toBe(100);
  const result=settleArtifactAcceptanceFromValidation({project:f.project,candidate:f.current,validation:f.project.validationRun,frozenArtifacts:f.project.artifactAcceptance.frozenArtifacts!});
  expect(result.status).toBe("unverified");expect(result.acceptedAt).toBeUndefined();expect(result.hardGatePass).toBe(false);
  expect(result.summary).toContain("html-protection-scope-pending");
 });
 for(const champion of [false,true])it.each(["search","static","mixed"] as const)("blocks stored "+(champion?"Champion":"Candidate")+" %s output/readiness/package",mode=>{
  const f=acceptedLegacyHtmlPaperFixture(champion,mode);
  const candidate=champion?f.prior:f.current,acceptance=champion?f.project.searchChampion!.artifactAcceptance!:f.project.artifactAcceptance;
  expect(f.project.outputArtifacts.some(a=>a.kind==="primary"&&a.accepted)).toBe(true);
  expect(deliveryReadiness(f.project).ready).toBe(false);
  expect(deliveryReadiness(f.project).reasons.join(" ")).toContain("html-protection-scope-pending");
  expect(acceptanceArtifacts(f.project,candidate,acceptance).every(a=>!a.accepted)).toBe(true);
  expect(()=>assertDeliverablePackageIdentity(f.project)).toThrow("html-protection-scope-pending");
  if(champion)expect(()=>materializeAcceptedChampionPackage(f.project)).toThrow("html-protection-scope-pending");
  else expect(()=>materializeAcceptedCandidatePackage(f.project,candidate,acceptance)).toThrow();
 });
 it("does not treat a stored DTO proof or changed canonical method/hardGate as authority",()=>{
  const f=acceptedLegacyHtmlPaperFixture(false,"mixed");
  Object.assign(f.project.artifactAcceptance,{htmlProtectionProof:{version:"html-protection-proof-v1",status:"verified",complete:true}});
  f.project.acceptanceRubric=f.project.acceptanceRubric.map(c=>c.id==="PROTECT-ALL"?{...c,hardGate:false,protectedConstraint:false,validationMethod:"format-roundtrip" as const}:c);
  const oldBinding=f.project.artifactAcceptance.evidenceFingerprint!,binding=evidenceFingerprint(f.project,f.current);
  f.project.validationRun.evidenceFingerprint=binding;f.project.artifactAcceptance.evidenceFingerprint=binding;
  const reports=acceptanceArtifacts(f.project,f.current,f.project.artifactAcceptance);
  f.project.outputArtifacts=f.project.outputArtifacts.map(a=>({...a,content:["acceptance-report","requirement-matrix"].includes(a.kind)
    ?reports.find(r=>r.kind===a.kind)!.content:a.content.replaceAll(oldBinding,binding)}));
  expect(deliveryReadiness(f.project).reasons.join(" ")).toContain("html-protection-scope-pending");
  expect(()=>assertDeliverablePackageIdentity(f.project)).toThrow("html-protection-scope-pending");
 });
});
it.each(["SYS-INTEGRITY","USER-PROTECTION"] as const)("keeps %s whole HTML high-score settlement unverified independent of tags/method",criterionId=>{
 const f=acceptedLegacyHtmlPaperFixture(false,"static");
 f.project.acceptanceRubric=f.project.acceptanceRubric.map(c=>c.id==="PROTECT-ALL"?{...c,id:criterionId,title:"完整保护",requirement:"保留所有原始卡片和交互",protectedConstraint:false,hardGate:false,validationMethod:"format-roundtrip" as const}:c);
 f.project.validationRun.evaluation!.criterionScores=f.project.validationRun.evaluation!.criterionScores!.map(s=>s.criterionId==="PROTECT-ALL"?{...s,criterionId}:s);
 f.project.validationRun.evidenceFingerprint=evidenceFingerprint(f.project,f.current);
 const result=settleArtifactAcceptanceFromValidation({project:f.project,candidate:f.current,validation:f.project.validationRun,frozenArtifacts:f.project.artifactAcceptance.frozenArtifacts!});
 expect(result.status).toBe("unverified");expect(result.summary).toContain("html-protection-scope-pending");expect(result.acceptedAt).toBeUndefined();
});