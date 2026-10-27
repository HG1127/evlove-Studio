import {expect,it,vi} from "vitest";
import {TestCaseSchema,type TargetRunResult,type TestCase} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {executeServerCurrentArtifactSuite} from "./server-current-artifact-runner";
import {executeServerExperimentCandidate} from "./server-experiment-runner";

function fixture(){
  const {project,current}=acceptedPackageFixture(false);
  project.acceptanceRubric=[{id:"CONTENT",title:"Content",requirement:"correct",source:"user-command",weight:100,hardGate:true,judgeType:"llm",validationMethod:"semantic-judge",minScore:85,evidenceExpected:["observed"],protectedConstraint:false,artifactIds:["source"],category:"outcome"}];
  const test=TestCaseSchema.parse({id:"F",title:"browser",input:"inspect current DOM",expected:["visible"],criterionIds:["CONTENT"],browserSteps:[{action:"visible",selector:"#actual"}]});
  return {project,current,test};
}
it.each(["artifact-runtime","static-evidence","roundtrip","manual"] as const)("keeps declared browser assertions unverified on %s on both sides",async mode=>{
  const {project,current,test}=fixture();test.executionMode=mode;
  const never=vi.fn(async()=>{throw Error("No execution substitute is allowed");});
  const ports={executeSemanticBatch:never,judge:never,executeStoredEvidence:never,buildCurrentArtifactContext:never,executeFrozenStatic:never,executeExternalBatch:never};
  const original=await executeServerCurrentArtifactSuite(project,[test],ports);
  const candidate=await executeServerExperimentCandidate(project,current,ports,[test]);
  for(const runs of [original,candidate])expect(runs).toMatchObject([{testCaseId:"F",verificationStatus:"unverified",error:"SERVER_BROWSER_ASSERTION_MODE_UNAVAILABLE"}]);
  expect(never).not.toHaveBeenCalled();
});
it("preserves declared predicates on the bound external executor on both sides",async()=>{
  const {project,current,test}=fixture();test.executionMode="external-runner";
  const never=vi.fn(async()=>{throw Error("Semantic execution must not substitute for browser execution");});
  const run:TargetRunResult={testCaseId:test.id,artifactHash:current.artifactSnapshots[0]!.frozenArtifact!.sha256,output:"actual browser receipt",verificationStatus:"verified",latencyMs:1,cost:0,trace:[]};
  const external=vi.fn(async({testCases}:{testCases:TestCase[]})=>{expect(testCases).toEqual([test]);return [run];});
  const ports={executeSemanticBatch:never,judge:never,executeExternalBatch:external};
  expect(await executeServerCurrentArtifactSuite(project,[test],ports)).toEqual([run]);
  expect(await executeServerExperimentCandidate(project,current,ports,[test])).toEqual([run]);
  expect(external).toHaveBeenCalledTimes(2);expect(never).not.toHaveBeenCalled();
});
