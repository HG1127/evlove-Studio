import {describe,expect,it,vi} from "vitest";
import {TestCaseSchema,type IndependentFinalExecutionContract} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {assertIndependentFinalExecution,finalHoldoutContractFingerprint,finalHoldoutExecutionFingerprint,finalHoldoutPaperHash} from "@evolution/core";
import {prepareServerIndependentFinalPaper} from "./server-final-paper";
const execution:IndependentFinalExecutionContract={schemaVersion:"independent-final-execution-v1",
  supportedModes:["artifact-runtime","static-evidence","roundtrip","external-runner"],requireBrowserStepsForExternal:true,limitations:["no human trials"]};
const at="2026-10-23T00:00:00.000Z";
const paper=(id="F1",input="novel source scenario")=>[TestCaseSchema.parse({id,input,title:id,expected:["correct"],hidden:true,criterionIds:["CONTENT"]})];
function fixture(){
 const {project:p}=acceptedPackageFixture(false);
 p.acceptanceRubric=[{...p.acceptanceRubric[0]!,id:"CONTENT",hardGate:true}];
 p.evalSuite=[TestCaseSchema.parse({id:"V",title:"visible",input:"visible",expected:["correct"],criterionIds:["CONTENT"]})];
 p.hiddenEvalSuite=[TestCaseSchema.parse({id:"H",title:"hidden",input:"regression",expected:["correct"],hidden:true,criterionIds:["CONTENT"]})];
 p.candidates=[];p.experimentRun.candidateResults=[];p.validationRun={id:"v",status:"idle",checks:[],runs:[],baselineRuns:[]};
 p.artifactAcceptance={...p.artifactAcceptance,candidateId:undefined,attempts:0};p.roundHistory=[];p.finalHoldout=undefined;
 return p;
}
const args=(reserve:(payload:unknown)=>Promise<ReturnType<typeof paper>>)=>({round:1,at,artifacts:[{id:"source",content:"Original only"}],executionContract:execution,reserve});
describe("independent final reservation execution contract",()=>{
 it("reserves the feasible paper with only Original inputs and the fixed execution contract",async()=>{
  const p=fixture();p.diagnosis={...p.diagnosis!,rootCause:"PRIVATE-DIAGNOSIS"};
  const reserve=vi.fn(async(payload:unknown)=>{expect(payload).toMatchObject({executionContract:execution,project:{artifacts:[{id:"source",content:"Original only"}]}});
   expect(JSON.stringify(payload)).not.toContain("PRIVATE-DIAGNOSIS");return paper();});
  const result=await prepareServerIndependentFinalPaper(p,args(reserve));
  expect(result.reserved).toBe(true);expect(result.project.finalHoldout?.executionContractFingerprint).toBe(finalHoldoutExecutionFingerprint(execution));
  expect(p.finalHoldout).toBeUndefined();
 });
 it.each(["manual","visual-review"] as const)("never reserves an unavailable %s paper",async mode=>{
  const p=fixture(),suite=paper();suite[0]!.executionMode=mode;
  await expect(prepareServerIndependentFinalPaper(p,args(async()=>suite))).rejects.toThrow("执行能力");
  expect(p.finalHoldout).toBeUndefined();
 });
 it("corrects missing Hidden coverage once using precise IDs and the unchanged Original/criteria",async()=>{
  const p=fixture();p.acceptanceRubric.push({...p.acceptanceRubric[0]!,id:"PROTECT"});
  p.evalSuite[0]!.criterionIds.push("PROTECT");
  const corrected=paper("F2","new independent source scenario");corrected[0]!.criterionIds.push("PROTECT");
  const reserve=vi.fn().mockResolvedValueOnce(paper()).mockResolvedValueOnce(corrected);
  const result=await prepareServerIndependentFinalPaper(p,args(reserve));
  expect(result.reserved).toBe(true);expect(reserve).toHaveBeenCalledTimes(2);
  const first=reserve.mock.calls[0]![0],second=reserve.mock.calls[1]![0];
  expect(first).toMatchObject({requiredHiddenCriterionIds:["CONTENT","PROTECT"],responseUse:expect.stringContaining("Only hiddenCases")});
  expect(second.generationCorrection).toContain("PROTECT");
  expect(second.project).toEqual(first.project);expect(second.acceptanceRubric).toEqual(first.acceptanceRubric);
  expect(p.finalHoldout).toBeUndefined();expect(p.candidates).toHaveLength(0);
 });
 it("does not retry provider failures as if they were paper-contract corrections",async()=>{
  const p=fixture(),failure=Object.assign(Error("provider timeout"),{code:"SERVER_AI_PROVIDER_TIMEOUT"});
  const reserve=vi.fn(async()=>{throw failure;});
  await expect(prepareServerIndependentFinalPaper(p,args(reserve))).rejects.toBe(failure);
  expect(reserve).toHaveBeenCalledTimes(1);expect(p.finalHoldout).toBeUndefined();
 });
 it("does not let Visible coverage replace a soft criterion missing from the independent paper",async()=>{
  const p=fixture();p.acceptanceRubric.push({...p.acceptanceRubric[0]!,id:"SOFT",hardGate:false});
  p.evalSuite[0]!.criterionIds.push("SOFT");
  const reserve=vi.fn(async()=>paper());
  await expect(prepareServerIndependentFinalPaper(p,args(reserve))).rejects.toThrow("SOFT");
  expect(reserve).toHaveBeenCalledTimes(2);expect(p.finalHoldout).toBeUndefined();
 });
 it("requires an actual browser assertion and validates text/count operands",()=>{
  const suite=paper();suite[0]!.executionMode="external-runner";
  for(const browserSteps of [undefined,[],[{action:"click" as const,selector:"#go"}],
   [{action:"text" as const,selector:"#result",value:""}],[{action:"count" as const,selector:"article"}]]){
   suite[0]!.browserSteps=browserSteps;expect(()=>assertIndependentFinalExecution(suite,execution)).toThrow("浏览器断言");
  }
  suite[0]!.browserSteps=[{action:"count",selector:"article",count:111}];
  expect(()=>assertIndependentFinalExecution(suite,execution)).not.toThrow();
 });
 it("fingerprints the optional browser-mode binding without changing historical contracts",()=>{
  const suite=paper();suite[0]!.browserSteps=[{action:"visible",selector:"#actual"}];
  expect(()=>assertIndependentFinalExecution(suite,execution)).not.toThrow();
  const bound={...execution,browserAssertionModes:["external-runner" as const]};
  expect(finalHoldoutExecutionFingerprint(bound)).not.toBe(finalHoldoutExecutionFingerprint(execution));
  expect(()=>assertIndependentFinalExecution(suite,bound)).toThrow("浏览器断言");
  suite[0]!.executionMode="external-runner";
  expect(()=>assertIndependentFinalExecution(suite,bound)).not.toThrow();
 });
 it("archives an unattempted legacy reservation and never sends its private cases to generation",async()=>{
  const p=fixture(),old=paper("OLD","PRIVATE-OLD-FINAL");old[0]!.executionMode="manual";
  p.finalHoldout={round:1,suite:old,paperHash:finalHoldoutPaperHash(old),contractFingerprint:finalHoldoutContractFingerprint(p),createdAt:at};
  const original=structuredClone(p.finalHoldout);
  const reserve=vi.fn(async payload=>{expect(JSON.stringify(payload)).not.toContain("PRIVATE-OLD-FINAL");return paper();});
  const result=await prepareServerIndependentFinalPaper(p,args(reserve));
  expect(result.project.supersededFinalHoldouts?.[0]).toMatchObject(original);
  expect(result.project.finalHoldout?.paperHash).not.toBe(original.paperHash);expect(p.finalHoldout).toEqual(original);
  await expect(prepareServerIndependentFinalPaper(p,args(async()=>[{...old[0]!,id:"RENAMED",executionMode:"manual"}]))).rejects.toThrow("复制");
 });
 it("refuses to replace a paper once any Candidate or Candidate feedback exists",async()=>{
  for(const feedback of ["candidate","validation"]){
   const p=fixture(),old=paper("OLD","old final");
   p.finalHoldout={round:1,suite:old,paperHash:finalHoldoutPaperHash(old),contractFingerprint:finalHoldoutContractFingerprint(p),createdAt:at};
   if(feedback==="candidate")p.candidates=[{id:"C1"}] as typeof p.candidates;else p.validationRun.candidateId="C1";
   const reserve=vi.fn(async()=>paper());await expect(prepareServerIndependentFinalPaper(p,args(reserve))).rejects.toThrow("不能替换");
   expect(reserve).not.toHaveBeenCalled();
  }
 });
 it("reuses an exact locked reservation even after Candidate generation starts",async()=>{
  const p=fixture(),reserve=vi.fn(async()=>paper());
  const first=await prepareServerIndependentFinalPaper(p,args(reserve));
  first.project.candidates=[{id:"C1"}] as typeof p.candidates;
  const second=await prepareServerIndependentFinalPaper(first.project,args(reserve));
  expect(second.reserved).toBe(false);expect(reserve).toHaveBeenCalledTimes(1);
 });
});
