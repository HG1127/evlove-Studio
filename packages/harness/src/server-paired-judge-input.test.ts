// @vitest-environment node
import {describe,expect,it} from "vitest";
import {pairedJudgeFixture} from "@evolution/testkit";
import {PairedJudgeMetricDefinitionSchema} from "@evolution/contracts";
import {serverPairedJudgeRequest} from "./server-paired-judge";

describe("paired judge metric evidence separation",()=>{
 it("keeps published metric definitions and excludes mutable values and trends without mutating the project",()=>{
  const x=pairedJudgeFixture();
  x.project.metrics=[{key:"quality",label:"Document quality",value:731,trend:-223,unit:"%",target:85,direction:"higher",description:"Published definition"}];
  const before=structuredClone(x.project),request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
  expect(request.metrics).toEqual([{key:"quality",label:"Document quality",unit:"%",target:85,direction:"higher",description:"Published definition"}]);
  expect(PairedJudgeMetricDefinitionSchema.array().parse(request.metrics)).toEqual(request.metrics);
  expect(request.criteria).toEqual(x.project.acceptanceRubric);expect(request.testCases).toEqual(x.project.evalSuite);
  expect(request.goal).toBe(x.project.goal);expect(x.project).toEqual(before);
 });
 it("leaves the issued comparison unchanged when only stored scores change, while a target change rebinds it",()=>{
  const x=pairedJudgeFixture();
  x.project.metrics=[{key:"quality",label:"Document quality",value:10,trend:2,unit:"%",target:85,direction:"higher"}];
  const issue=()=>serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
  const before=issue();x.project.metrics[0]!.value=99;x.project.metrics[0]!.trend=-15;
  expect(issue()).toEqual(before);
  x.project.metrics[0]!.target=86;
  expect(issue().context.inputFingerprint).not.toBe(before.context.inputFingerprint);
 });
});
