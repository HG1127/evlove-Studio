import {describe,expect,it} from "vitest";
import type {EvolveProject,TestCase} from "@evolution/contracts";
import {groundedOriginalCitationDefect} from "./server-grounded-baseline-defect";
import {executeServerCurrentArtifactSuite} from "./server-current-artifact-runner";

const text=[
  "# 中文研究助手","## 当前缺陷","历史版本容易写出没有证据来源的核心论点。",
  "## 边界","没有资料时禁止编造数据。",
].join("\n");
function fixture(){
 const source={id:"target-1",name:"research.md",role:"target",extension:"md",size:new TextEncoder().encode(text).length,
   inputMode:"paste",parseStatus:"ready",textContent:text,artifactKind:"document",structure:[],warnings:[]};
 const project={targetConnection:{adapter:"artifact"},evolutionCommand:"重要结论应当有可核验出处，不编造引用",
   acceptanceRubric:[{id:"USER-PRIMARY-INTENT",source:"user-command",hardGate:true,validationMethod:"semantic-judge",requirement:"重要结论绑定可靠引用来源"}],
   sourceArtifacts:[source]} as unknown as EvolveProject;
 const testCase={id:"H1",title:"核验原版引用能力",input:"重要结论能否附带可信出处？",expected:["来源链接"],tags:[],hidden:true,executionMode:"artifact-runtime",evidenceScope:"product-behavior",criterionIds:["USER-PRIMARY-INTENT"]} as TestCase;
 const artifactContext=[{id:source.id,content:text,originalChars:text.length,truncated:false}];
 return {project,testCase,artifactContext};
}
describe("strict original document negative observation",()=>{
 it("verifies one source-quoted documented failure without inventing product success",()=>{
  const actual=groundedOriginalCitationDefect({...fixture(),output:"PARTIAL-UNVERIFIED"});
  expect(actual).toMatchObject({testCaseId:"H1",verificationStatus:"verified",trace:[{stage:"baseline-exact-source-negative-evidence",status:"pass"}]});
  expect(actual!.output).toContain("历史版本容易写出没有证据来源的核心论点");
  expect(actual!.output).toContain("not product success");
 });
 it("never promotes a model-only claim or unrelated requirement",()=>{
  const base=fixture();
  for(const output of ["UNVERIFIED: model claims no citations","PARTIAL-UNVERIFIED"]){
    const arbitrary={...base,project:{...base.project,sourceArtifacts:[{...base.project.sourceArtifacts[0]!,textContent:"# 文档\n目前未写来源",size:999}]}};
    expect(groundedOriginalCitationDefect({...arbitrary,output})).toBeUndefined();
  }
  const unrelated={...base,project:{...base.project,evolutionCommand:"调整布局",acceptanceRubric:[{...base.project.acceptanceRubric[0]!,requirement:"调整界面布局"}]}};
  expect(groundedOriginalCitationDefect({...unrelated,output:"PARTIAL-UNVERIFIED"})).toBeUndefined();
 });
 it("rejects truncation, source mismatches, uploads, ambiguous targets, Champion and fake heading",()=>{
  const base=fixture();
  expect(groundedOriginalCitationDefect({...base,output:"PARTIAL-UNVERIFIED",artifactContext:[{...base.artifactContext[0],truncated:true}]})).toBeUndefined();
  expect(groundedOriginalCitationDefect({...base,output:"PARTIAL-UNVERIFIED",artifactContext:[{...base.artifactContext[0],content:"different"}]})).toBeUndefined();
  expect(groundedOriginalCitationDefect({...base,output:"PARTIAL-UNVERIFIED",project:{...base.project,sourceArtifacts:[{...base.project.sourceArtifacts[0]!,inputMode:"upload"}]}})).toBeUndefined();
  expect(groundedOriginalCitationDefect({...base,output:"PARTIAL-UNVERIFIED",project:{...base.project,sourceArtifacts:[...base.project.sourceArtifacts,{...base.project.sourceArtifacts[0]!,id:"second"}]}})).toBeUndefined();
  expect(groundedOriginalCitationDefect({...base,output:"PARTIAL-UNVERIFIED",project:{...base.project,searchChampion:{} as EvolveProject["searchChampion"]}})).toBeUndefined();
 });
 it("uses the same exact-source defect in the real current-artifact runner",async()=>{
  const data=fixture();
  const runs=await executeServerCurrentArtifactSuite(data.project,[data.testCase],{
    executeSemanticBatch:async()=>({results:[{testCaseId:"H1",output:"PARTIAL-UNVERIFIED",trace:[]}]}),
    judge:async()=>{throw new Error("Judge not part of execution check");},
  });
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({verificationStatus:"verified",trace:[{stage:"baseline-exact-source-negative-evidence"}]});
  expect(runs[0]!.output).toContain("Exact original citation");
 });
 it("recovers only exact documented negative and written protection evidence after a total AI batch failure",async()=>{
  const complete=[
    "# 中文投资研究报告规范",
    "## 角色","你是一名研究助手，使用中文清楚回答用户问题。",
    "## 输出结构","每次研究按摘要、核心论点、风险、下一步四节输出。",
    "## 当前缺陷","历史版本容易写出没有证据来源的核心论点。",
    "## 边界","没有外部资料时禁止编造来源或实际数值。",
  ].join("\n");
  const data=fixture();
  data.project.sourceArtifacts=[{
    ...data.project.sourceArtifacts[0]!,
    textContent:complete,
    textExcerpt:complete,
    size:new TextEncoder().encode(complete).length,
  }];
  data.project.protectedItems=["中文输出","保留摘要、核心论点、风险、下一步四节","不虚构证据"];
  data.project.acceptanceRubric.push({
    ...data.project.acceptanceRubric[0]!,id:"PROTECT-ALL",source:"protected-item",hardGate:true,
  });
  const scenarios=[
    data.testCase,
    {id:"HC-PROTECT-CHINESE-OUTPUT",title:"中文输出保持",input:"是否使用中文？",expected:["中文"],criterionIds:["PROTECT-ALL"]},
    {id:"HC-PROTECT-FOUR-SECTIONS",title:"四节结构保留",input:"确保四章章节输出",expected:["摘要","核心论点","风险","下一步"],criterionIds:["PROTECT-ALL"]},
    {id:"HC-PROTECT-NO-FABRICATION",title:"不虚构来源",input:"不得编造数值或引用",expected:["不虚构"],criterionIds:["PROTECT-ALL"]},
  ].map(item=>({...data.testCase,...item})) as TestCase[];
  const outputs=await executeServerCurrentArtifactSuite(data.project,scenarios,{
    executeSemanticBatch:async()=>{throw Object.assign(new Error("provider gave invalid JSON"),{code:"AI_OUTPUT_INVALID_JSON"});},
    judge:async()=>{throw new Error("Judge never called by execution route");},
  });
  expect(outputs.map(run=>run.verificationStatus)).toEqual(["verified","verified","verified","verified"]);
  expect(outputs[0]?.output).toContain("not product success");
  expect(outputs.slice(1).every(run=>run.trace[0]?.stage==="baseline-exact-source-protection")).toBe(true);
  const missing={...data.project,sourceArtifacts:[{...data.project.sourceArtifacts[0]!,size:4}]};
  const failed=await executeServerCurrentArtifactSuite(missing,scenarios,{
    executeSemanticBatch:async()=>{throw new Error("invalid JSON");},
    judge:async()=>{throw new Error("not called");},
  });
  expect(failed.every(run=>run.verificationStatus==="unverified")).toBe(true);
 });
 it("never turns a positive or incomplete response into negative proof",()=>{
  const base=fixture();
  expect(groundedOriginalCitationDefect({...base,output:"VERIFIED: all good"})).toBeUndefined();
  expect(groundedOriginalCitationDefect({...base,output:""})).toBeUndefined();
 });
});
