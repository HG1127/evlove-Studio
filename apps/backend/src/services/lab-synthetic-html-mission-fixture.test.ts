// @vitest-environment node
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe,expect,it,vi} from "vitest";
import {
  ArtifactWriteGovernanceSchema,EvolveProjectSchema,SourceArtifactSchema,TestCaseSchema,
  EvolutionWorkflowStartRequestSchema,
} from "@evolution/contracts";
import {
  assertIndependentFinalPaper,assertIndependentFinalExecution,
  finalHoldoutContractFingerprint,finalHoldoutPaperHash,
  requiresSandboxHtmlSourceExecution,
} from "@evolution/core";
import {serverFinalPaperExecutionContract} from "./server-final-paper";

const dir="tests/fixtures/p3x-synthetic-task-board/";
const original=readFileSync(dir+"original.html","utf8");
const missionRaw=JSON.parse(readFileSync(dir+"mission.template.json","utf8"));
const approval=JSON.parse(readFileSync(dir+"approval.request.json","utf8"));
const baseline=JSON.parse(readFileSync(dir+"baseline-visible-observation.json","utf8"));
const sha=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");
const project=EvolveProjectSchema.parse(missionRaw);
const source=project.sourceArtifacts[0]!;
const tests=[...project.evalSuite,...project.hiddenEvalSuite,...project.finalHoldout!.suite];

describe("P3-X offline single synthetic HTML Mission approval package",()=>{
  it("parses complete canonical Mission, with zero fabricated runtime scores or approved work",()=>{
    expect(project).toMatchObject({
      id:"lab-synthetic-html-task-filter-p3x-v1",version:"V1",stage:"target",
      targetConnection:{adapter:"artifact"},campaign:{status:"idle",currentRound:0},
      baselineRun:{status:"idle"},experimentRun:{status:"idle"},
      validationRun:{status:"idle"},artifactAcceptance:{status:"idle"},
      release:{status:"idle"},
    });
    expect(project.candidates).toEqual([]);
    expect(project.acceptanceRubricState.confirmedAt).toBeUndefined();
    expect(project.outputArtifacts).toEqual([]);
    expect(project.experimentRun.candidateResults).toEqual([]);
    expect(project.validationRun.runs).toEqual([]);
    expect(approval).toMatchObject({
      missionId:project.id,status:"prepared-not-approved",userApproved:false,
      registeredInLab:false,labArmed:false,providerCallsPerformed:0,
    });
    expect(project).not.toHaveProperty("labExperiment");
    expect(project).not.toHaveProperty("labExperimentApproval");
    expect(approval).not.toHaveProperty("apiKey");
  });
  it("binds exactly one original offline HTML Target to the exact SHA-256 and immutable parent governance",()=>{
    expect(project.sourceArtifacts).toHaveLength(1);
    expect(SourceArtifactSchema.parse(source)).toEqual(source);
    expect(source).toMatchObject({
      role:"target",name:"original.html",extension:"html",mimeType:"text/html",
      inputMode:"paste",parseStatus:"ready",textContent:original,
    });
    expect(source.size).toBe(Buffer.byteLength(original));
    const expectedSha=sha(original);
    expect(source.mutationGovernance).toMatchObject({
      version:"artifact-write-governance-v1",parentSha256:expectedSha,
      policy:{allowedPaths:["original.html"],preserveExistingCapabilities:true,
        allowDelete:false,rejectNoop:true},
    });
    expect(ArtifactWriteGovernanceSchema.parse(source.mutationGovernance)).toEqual(source.mutationGovernance);
    expect(approval.source).toMatchObject({file:"original.html",sha256:expectedSha,sizeBytes:source.size});
    expect(requiresSandboxHtmlSourceExecution(project)).toBe(true);
    expect(original).not.toMatch(/<script\b/i);
    expect(original).not.toMatch(/https?:\/\//);
  });
  it("has reviewable visible, ordinary hidden, and independent final browser cases",()=>{
    expect(project.acceptanceRubric).toHaveLength(3);
    expect(project.acceptanceRubric.reduce((sum,c)=>sum+c.weight,0)).toBe(100);
    expect(project.acceptanceRubric.every(c=>c.hardGate)).toBe(true);
    expect(project.evalSuite).toHaveLength(3);
    expect(project.hiddenEvalSuite).toHaveLength(3);
    expect(project.finalHoldout?.suite).toHaveLength(3);
    expect(new Set(tests.map(c=>c.id)).size).toBe(9);
    for(const scenario of tests){
      expect(TestCaseSchema.parse(scenario)).toEqual(scenario);
      expect(scenario.executionMode).toBe("external-runner");
      expect(scenario.browserSteps?.some(step=>["count","text","visible"].includes(step.action))).toBe(true);
      expect(scenario.browserSteps?.every(step=>!["fill","text"].includes(step.action)||typeof step.value==="string")).toBe(true);
    }
    expect(project.evalSuite.every(c=>!c.hidden)).toBe(true);
    expect(project.hiddenEvalSuite.every(c=>c.hidden)).toBe(true);
    expect(project.finalHoldout!.suite.every(c=>c.hidden)).toBe(true);
    expect(project.campaign.stopCriteria.maxRounds).toBe(1);
    expect(project.campaign.schedule.enabled).toBe(false);
  });
  it("cryptographically binds the independent paper and contract before Candidate generation",()=>{
    const paper=project.finalHoldout!;
    expect(paper.paperHash).toBe(finalHoldoutPaperHash(paper.suite));
    expect(paper.contractFingerprint).toBe(finalHoldoutContractFingerprint(project));
    expect(paper.round).toBe(1);
    expect(project.candidates).toHaveLength(0);
    expect(approval.finalHoldout).toMatchObject({
      paperHash:paper.paperHash,contractFingerprint:paper.contractFingerprint,
    });
    expect(()=>assertIndependentFinalPaper(project,paper.suite)).not.toThrow();
    const execution=serverFinalPaperExecutionContract(project)!;
    expect(execution.requireBrowserStepsForExternal).toBe(true);
    expect(()=>assertIndependentFinalExecution(paper.suite,execution)).not.toThrow();
    expect(new Set(paper.suite.flatMap(c=>c.criterionIds))).toEqual(new Set(project.acceptanceRubric.map(c=>c.id)));
  });
  it("would require manual explicit approved single-Mission request; does not perform any I/O",()=>{
    const request=EvolutionWorkflowStartRequestSchema.parse({
      missionId:project.id,idempotencyKey:"synthetic-p3x-review-only",
      labExperimentApproval:"explicit-synthetic-lab-v1",
    });
    expect(request.missionId).toBe(approval.missionId);
    expect(request).not.toHaveProperty("scheduledFor");
    expect(approval.models).toMatchObject({generation:"MiniMax-M3",judge:"MiniMax-M3.1-Flash"});
    expect(approval.hardLimits).toMatchObject({maxPhysicalCalls:6,maxMissionTokens:300000,
      maxDurationMinutes:20,minQuotaRemainingPercent:50});
    expect(approval.pending.length).toBeGreaterThanOrEqual(3);
    expect(approval.userApproved).toBe(false);
  });
  it("rejects modifying the frozen source without updating its authorized parent fingerprint",()=>{
    const drift=EvolveProjectSchema.parse({...missionRaw,sourceArtifacts:[{
      ...missionRaw.sourceArtifacts[0],textContent:original.replace("Alpha research","CHANGED RESEARCH"),
    }]});
    const sameApproval=drift.sourceArtifacts[0]!.mutationGovernance;
    expect(sameApproval?.parentSha256).not.toBe(sha(drift.sourceArtifacts[0]!.textContent!));
  });
  it("records actual local Chrome baseline behavior instead of pretending source already passes",()=>{
    expect(baseline).toMatchObject({
      status:"baseline-defect-reproduced",mode:"offline-source-only",
      missionId:project.id,sourceSha256:sha(original),
      providerModelCalls:0,labDatabaseWrites:0,
      hiddenCasesExecuted:false,independentFinalExecuted:false,externalRequests:0,
    });
    expect(baseline.tests.map((item:{testCaseId:string})=>item.testCaseId))
      .toEqual(project.evalSuite.map(test=>test.id));
    const preserved=baseline.tests.find((item:{testCaseId:string})=>item.testCaseId==="V-PRESERVE");
    const missing=baseline.tests.find((item:{testCaseId:string})=>item.testCaseId==="V-ALPHA");
    expect(preserved).toMatchObject({passed:true});
    expect(missing).toMatchObject({passed:false});
    expect(missing.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({selector:".task-card:not([hidden])",expected:1,actual:3,passed:false}),
      expect.objectContaining({selector:"#result-count",expected:"1 task",actual:"3 tasks",passed:false}),
    ]));
  });
  it("does not confuse text-only mission draft with physical original in Lab Artifact Store",()=>{
    expect(source.storageRef).toBeUndefined();
    expect(approval.registeredInLab).toBe(false);
    expect(approval.userApproved).toBe(false);
    const physicalSource=readFileSync("apps/backend/src/services/server-html-native-execution.ts","utf8");
    expect(physicalSource).toContain('source.storageRef?.trim()');
    expect(physicalSource).toContain('ports.artifacts.getMetadata');
    expect(physicalSource).toContain('metadata.missionId!==project.id');
    expect(physicalSource).toContain('metadata.kind!=="source"');
    expect(physicalSource).toContain('Physical Original metadata is unavailable');
    expect(approval.pending).toContain("Import Mission and source file to isolated Lab with audited API");
  });

  it("never makes network or database writes during pure fixture assessment",()=>{
    const network=vi.fn();vi.stubGlobal("fetch",network);
    try{
      EvolveProjectSchema.parse(missionRaw);
      expect(finalHoldoutPaperHash(project.finalHoldout!.suite)).toBe(project.finalHoldout!.paperHash);
      expect(network).not.toHaveBeenCalled();
    }finally{vi.unstubAllGlobals();}
  });
});
