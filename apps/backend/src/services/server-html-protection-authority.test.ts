// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { bindHtmlProtectionAuthorities, htmlProtectionCriterionAuthority, htmlProtectionAcceptanceBlocker } from "@evolution/core";
import { collectServerSuiteHtmlProtectionAuthority } from "@evolution/harness";
import { createServerHtmlProtectionAuthorityCollector, restoreServerHtmlProtectionAuthority } from "./server-html-protection-authority";
import { serverHtmlProtectionAuthorityTestFixture } from "./server-html-protection-authority-test-fixtures";
import { prepareServerHtmlProtectionAuthorityPlan, prepareServerHtmlProtectionSemanticFrozenRequirements } from "./server-html-protection-authority-plan";
afterEach(()=>vi.restoreAllMocks());
describe("actual App composition boundaries with controlled local ports",()=>{
  it("retains truthful Current partial scope and independently restores it without granting whole PASS",async()=>{
    const f=serverHtmlProtectionAuthorityTestFixture(),collect=createServerHtmlProtectionAuthorityCollector(f.ports);
    const result=await collect({project:f.project,testCases:[f.test],runs:[f.currentRun]});
    expect(result.runs[0]?.verificationStatus).toBe("verified");expect(result.runs[0]?.htmlProtectionProof?.verificationStatus).toBe("partial");
    expect(result.runs[0]?.htmlProtectionAuthorityRefs).toHaveLength(1);expect(result.authorities).toHaveLength(1);
    bindHtmlProtectionAuthorities(f.project,result.authorities);
    expect(htmlProtectionCriterionAuthority({project:f.project,criterion:f.criterion,testCases:[f.test],runs:result.runs}).passed).toBe(false);
    const token=await restoreServerHtmlProtectionAuthority({project:f.project,testCase:f.test,run:result.runs[0]!,reference:result.runs[0]!.htmlProtectionAuthorityRefs![0]!,criterionId:f.criterion.id},f.ports);
    expect(token).toBeDefined();expect(htmlProtectionAcceptanceBlocker(f.project)).toBeTruthy();
    expect(f.ports.observeSemantic).not.toHaveBeenCalled();expect(f.ports.observeVisual).not.toHaveBeenCalled();expect(f.store.delete).not.toHaveBeenCalled();
  });
  it("retains actual full-file Candidate losses through draft→built→settled without invented native success",async()=>{
    const f=serverHtmlProtectionAuthorityTestFixture(true,true),collect=createServerHtmlProtectionAuthorityCollector(f.ports);
    const runs=await collectServerSuiteHtmlProtectionAuthority({project:f.project,candidate:f.candidate,testCases:[f.test],runs:[f.candidateRun]},collect);
    expect(f.project.candidates[0]!.artifactSnapshots).toEqual([]);expect(runs[0]?.verificationStatus).toBe("failed");
    expect(htmlProtectionCriterionAuthority({project:f.project,criterion:f.criterion,testCases:[f.test],runs}).observedFailure).toBe(true);
    expect(htmlProtectionAcceptanceBlocker(f.project)).toBeTruthy();
  });
  it.each(["output","paper","editable-scope","protected-scope","command","receipt","bytes","job-generation","route"] as const)("rejects %s drift on serialized envelope restoration",async kind=>{
    const f=serverHtmlProtectionAuthorityTestFixture(true),collect=createServerHtmlProtectionAuthorityCollector(f.ports);
    const result=await collect({project:f.project,candidate:f.candidate,testCases:[f.test],runs:[f.candidateRun]}),run=structuredClone(result.runs[0]!);
    const args={project:f.project,candidate:f.candidate,testCase:f.test,run,reference:run.htmlProtectionAuthorityRefs![0]!,criterionId:f.criterion.id};
    if(kind==="output")run.output+="changed";if(kind==="paper")f.project.hiddenEvalSuite[0]!.expected.push("another frozen paper");
    if(kind==="editable-scope")f.project.editableItems=["All body text"];if(kind==="protected-scope")f.project.protectedItems.push("card #one");if(kind==="command")f.project.evolutionCommand+="new permission";
    if(kind==="receipt")f.candidate.artifactSnapshots[0]!.frozenArtifact!.blobId="foreign";
    if(kind==="bytes")f.bytes.set("candidate",new Blob([f.executed.replace("Different","Untrusted")]));
    if(kind==="job-generation")f.job.generation++;if(kind==="route")f.selection.settings.model="different-model";
    await expect(restoreServerHtmlProtectionAuthority(args,f.ports)).rejects.toThrow();
  });
  it("binds the exact normal Judge status reduction while keeping complete raw output physically in the private envelope",async()=>{
    const f=serverHtmlProtectionAuthorityTestFixture();f.currentRun.output="Full actual case output "+"X".repeat(70000);
    const result=await createServerHtmlProtectionAuthorityCollector(f.ports)({project:f.project,testCases:[f.test],runs:[f.currentRun]});
    expect(result.runs[0]?.verificationStatus).toBe("partial");expect(result.runs[0]?.output).toBe(f.currentRun.output);
    const token=await restoreServerHtmlProtectionAuthority({project:f.project,testCase:f.test,run:result.runs[0]!,reference:result.runs[0]!.htmlProtectionAuthorityRefs![0]!,criterionId:f.criterion.id},f.ports);
    expect(token).toBeDefined();const changed={...result.runs[0]!,verificationStatus:"verified" as const};
    await expect(restoreServerHtmlProtectionAuthority({project:f.project,testCase:f.test,run:changed,reference:changed.htmlProtectionAuthorityRefs![0]!,criterionId:f.criterion.id},f.ports)).rejects.toThrow();
  });
  it("keeps missing signer as a real gap and never issues complete acceptance",async()=>{
    const f=serverHtmlProtectionAuthorityTestFixture();f.ports.readSigning=async()=>undefined;
    const result=await createServerHtmlProtectionAuthorityCollector(f.ports)({project:f.project,testCases:[f.test],runs:[f.currentRun]});
    expect(result.runs[0]?.htmlProtectionAuthorityRefs).toBeUndefined();expect(result.runs[0]?.trace.some(item=>item.id==="html-protection-signing-unavailable")).toBe(true);
    bindHtmlProtectionAuthorities(f.project,result.authorities);expect(htmlProtectionCriterionAuthority({project:f.project,criterion:f.criterion,testCases:[f.test],runs:result.runs}).passed).toBe(false);
  });
  it("rejects subject mutation during signing/storage awaits before minting any token",async()=>{
    const f=serverHtmlProtectionAuthorityTestFixture(true);f.ports.readSigning=async()=>{f.candidate.artifactSnapshots[0]!.content+="changed";f.project.candidates[0]!.artifactSnapshots[0]!.content+="changed";return f.signer;};
    await expect(createServerHtmlProtectionAuthorityCollector(f.ports)({project:f.project,candidate:f.candidate,testCases:[f.test],runs:[f.candidateRun]})).rejects.toThrow();
  });
  it.each(["key-only","same-revision-settings"] as const)("rejects %s replacement during actual envelope storage even when the pinned model route remains unchanged",async kind=>{
    const f=serverHtmlProtectionAuthorityTestFixture(),put=f.store.put;f.store.put=async(...args)=>{await put(...args);if(kind==="key-only")f.selection.sealedRecordSha256="8".repeat(64);else f.selection.settings.label+="changed";};
    await expect(createServerHtmlProtectionAuthorityCollector(f.ports)({project:f.project,testCases:[f.test],runs:[f.currentRun]})).rejects.toThrow();
  });
  it("preserves the truthful capability gap when there is no independently bound saved selection",async()=>{
    const f=serverHtmlProtectionAuthorityTestFixture();f.ports.owner!.readSelection=async()=>({availability:"unavailable",reason:"environment-credential-epoch-unavailable"});
    const result=await createServerHtmlProtectionAuthorityCollector(f.ports)({project:f.project,testCases:[f.test],runs:[f.currentRun]});
    expect(result.authorities).toEqual([]);expect(result.runs[0]!.htmlProtectionAuthorityRefs).toBeUndefined();
    expect(result.runs[0]!.trace.some(item=>item.summary.includes("environment-credential-epoch-unavailable"))).toBe(true);
  });
  it("authenticates the signed complete context before invoking the historical stored-selection reader",async()=>{
    const f=serverHtmlProtectionAuthorityTestFixture(),result=await createServerHtmlProtectionAuthorityCollector(f.ports)({project:f.project,testCases:[f.test],runs:[f.currentRun]});
    f.ports.owner!.readStoredSelection=vi.fn(async()=>{throw Error("Invalid signature must not reach stored selection");});
    const run={...result.runs[0]!,output:"changed actual canonical result"};
    await expect(restoreServerHtmlProtectionAuthority({project:f.project,testCase:f.test,run,reference:run.htmlProtectionAuthorityRefs![0]!,criterionId:f.criterion.id},f.ports)).rejects.toThrow();
    expect(f.ports.owner!.readStoredSelection).not.toHaveBeenCalled();
  });
  it("reconstructs complete frozen semantic requirements from the same actual stored paper rather than hash-only or Candidate notes",async()=>{
    const f=serverHtmlProtectionAuthorityTestFixture(),prepared=await prepareServerHtmlProtectionAuthorityPlan({project:f.project,testCase:f.test,criterionId:f.criterion.id,
      execution:{executionId:"sdk-run",jobId:f.job.id,generation:f.job.generation},ports:{getArtifact:f.store.get}});
    expect(prepared.semanticRequirements).toMatchObject({missionId:f.project.id,sourceArtifactId:"source",testCase:f.test,paper:f.project.hiddenEvalSuite,rubric:f.project.acceptanceRubric,
      goal:f.project.goal,evolutionCommand:f.project.evolutionCommand,protectedItems:f.project.protectedItems,editableItems:f.project.editableItems,paperSha256:prepared.binding.paperSha256});
    const before=prepared.semanticRequirementsSha256;f.project.editableItems=["Only body text of card #one"];
    expect(prepareServerHtmlProtectionSemanticFrozenRequirements({project:f.project,testCase:f.test,binding:prepared.binding}).semanticRequirementsSha256).not.toBe(before);
    f.project.hiddenEvalSuite[0]!.input+="changed same-ID case";
    expect(()=>prepareServerHtmlProtectionSemanticFrozenRequirements({project:f.project,testCase:f.test,binding:prepared.binding})).toThrow("frozen-paper-binding-invalid");
  });
});
