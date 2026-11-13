#!/usr/bin/env node
// Deterministic, offline-only P3-X fixture generator. No provider, Vault or database I/O.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {join} from "node:path";

const dir=join(process.cwd(),"tests/fixtures/p3x-synthetic-task-board");
const file="original.html";
const html=readFileSync(join(dir,file),"utf8");
const at="2026-11-13T08:00:00.000Z";
const id="lab-synthetic-html-task-filter-p3x-v1";
const sha256=createHash("sha256").update(html,"utf8").digest("hex");
const size=Buffer.byteLength(html,"utf8");
function fastHash(value){
  // Exact fastHash(string) contract of packages/core/src/stable-hash.ts.
  const str=JSON.stringify(value);
  let hash=2166136261;
  for(let i=0;i<str.length;i++){hash^=str.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16)+"-"+str.length;
}
function criterion(id,title,requirement,weight,category,protectedConstraint=false){
  return {id,title,requirement,source:"user-command",weight,hardGate:true,
    judgeType:protectedConstraint?"integrity":"structural",
    validationMethod:"executable-test",minScore:100,
    evidenceExpected:protectedConstraint?["source-bound header and three original task identities"]
      :id==="FILTER"?["independent browser input and visible card count"]:["role=status aria-live status and exact count"],
    protectedConstraint,artifactIds:["source-task-board"],category};
}
const rubric=[
  criterion("PRESERVE","Retain original identity","Do not change #board-title, #protected-header, or any original task ID and heading.",30,"protected",true),
  criterion("FILTER","Implement accessible filtering","Typing in #task-filter hides every nonmatching task card, case-insensitively. Clearing the field restores all task cards.",45,"behavior"),
  criterion("COUNT","Live count","After input, #result-count announces the visible count with correct singular/plural grammar and retains role=status and aria-live=polite.",25,"ux")
];
function step(action,selector,payload){
  const item={action,selector};
  if(action==="fill"||action==="text")item.value=String(payload??"");
  if(action==="count")item.count=Number(payload);
  return item;
}
function t(id,title,input,expected,criterionIds,browserSteps,hidden){
  return {browserSteps,id,title,input,expected,tags:["synthetic-lab","offline-html"],hidden,criterionIds,
    executionMode:"external-runner",evidenceScope:"product-behavior"};
}
const visible=[
  t("V-PRESERVE","Original board identity","Inspect header and task nodes.",
    ["Exact title and all three original task nodes remain."],["PRESERVE"],[
      step("text","#board-title","Lab Task Board"),step("count",".task-card",3),
      step("visible","#task-alpha"),step("visible","#task-beta"),step("visible","#task-gamma")],false),
  t("V-ALPHA","Search alpha","Enter 'alpha' into the task filter.",
    ["Only Alpha remains; status reads 1 task."],["FILTER","COUNT"],[
      step("fill","#task-filter","alpha"),step("count",".task-card:not([hidden])",1),
      step("text","#result-count","1 task")],false),
  t("V-CLEAR","Clear search","Enter alpha then clear the filter.",
    ["All three cards return; status reads 3 tasks."],["FILTER","COUNT"],[
      step("fill","#task-filter","alpha"),step("fill","#task-filter",""),
      step("count",".task-card:not([hidden])",3),step("text","#result-count","3 tasks")],false),
];
const hidden=[
  t("H-CASE","Case-insensitive search","Enter uppercase BETA.",
    ["Only Beta remains; status reads 1 task."],["FILTER","COUNT"],[
      step("fill","#task-filter","BETA"),step("count",".task-card:not([hidden])",1),
      step("visible","#task-beta"),step("text","#result-count","1 task")],true),
  t("H-ZERO","No match","Enter no-such-task.",
    ["No card remains visible; status reads 0 tasks."],["FILTER","COUNT"],[
      step("fill","#task-filter","no-such-task"),step("count",".task-card:not([hidden])",0),
      step("text","#result-count","0 tasks")],true),
  t("H-PROTECT","Protection after search","Enter alpha; inspect original header and card identity.",
    ["Protected header and all three source cards still exist."],["PRESERVE"],[
      step("fill","#task-filter","alpha"),step("text","#board-title","Lab Task Board"),
      step("count",".task-card",3)],true)
];
const final=[
  t("F-GAMMA","Fresh mixed-case final","Enter GaMmA after candidate freeze.",
    ["Gamma alone remains and status is 1 task."],["FILTER","COUNT"],[
      step("fill","#task-filter","GaMmA"),step("count",".task-card:not([hidden])",1),
      step("visible","#task-gamma"),step("text","#result-count","1 task")],true),
  t("F-ZEBRA","Fresh independent empty search","Enter zebra after candidate freeze.",
    ["No visible cards and status is 0 tasks."],["FILTER","COUNT"],[
      step("fill","#task-filter","zebra"),step("count",".task-card:not([hidden])",0),
      step("text","#result-count","0 tasks")],true),
  t("F-IDENTITY","Fresh protected identity check","Inspect original title and card identities.",
    ["Board title and three task elements still exist."],["PRESERVE"],[
      step("text","#board-title","Lab Task Board"),step("count",".task-card",3),
      step("visible","#task-alpha"),step("visible","#task-beta"),step("visible","#task-gamma")],true)
];
const source={
  mutationGovernance:{version:"artifact-write-governance-v1",parentSha256:sha256,
    policy:{allowedPaths:[file],protectedPaths:[],allowDelete:false,
      preserveExistingCapabilities:true,rejectNoop:true,maxChangedFiles:5,maxFileBytes:5242880}},
  id:"source-task-board",name:file,role:"target",artifactKind:"document",
  mimeType:"text/html",size,extension:"html",inputMode:"paste",parseStatus:"ready",
  textContent:html,structure:[],warnings:[],createdAt:at
};
const goal="Add case-insensitive task search and accurate accessible live result counts to an offline synthetic HTML Task Board while preserving all original tasks and the protected header.";
const command="Evolve original.html in place: wire #task-filter to case-insensitive matching of .task-card data-search, toggle the hidden attribute on nonmatches, and update #result-count with exact visible counts and correct singular/plural messages. Retain #board-title, #protected-header, original task IDs and headings, and all original content. Never add external network calls or claim browser tests passed without real execution evidence.";
const protectedItems=["#board-title exact text: Lab Task Board","#protected-header and source subtitle",
  "#task-alpha, #task-beta, #task-gamma with original task headings",
  "Three original cards are retained in DOM","Single-file HTML without external requests"];
const editableItems=["Inline script for #task-filter","Task hidden attributes",
  "#result-count live text","Local styles without erasing original elements"];
const project={
  id,name:"P3-X Synthetic HTML Task Filter",objectType:"document",
  department:"Isolated Lab",version:"V1",stage:"target",
  goal,evolutionCommand:command,protectedItems,editableItems,metrics:[],sourceArtifacts:[source],
  acceptanceRubric:rubric,acceptanceRubricState:{status:"ready",summary:"Synthetic author-defined rubrics; actual browser execution not yet performed.",
    version:1,weightTotal:100,uncoveredCriterionIds:[],warnings:[]},
  evalSuite:visible,hiddenEvalSuite:hidden,
  gates:[{id:"target-ready",label:"Target Ready",status:"ready"},
    {id:"experiment-ready",label:"Experiment Ready",status:"pending"},
    {id:"artifact-ready",label:"Artifact Ready",status:"pending"},
    {id:"release-ready",label:"Release Ready",status:"pending"}],
  problems:[],candidates:[],experimentPolicy:{},
  baselineRun:{id:"baseline-p3x",status:"idle",suiteName:"P3-X visible",totalCases:3,runs:[]},
  experimentRun:{id:"experiment-p3x",status:"idle",candidateResults:[]},
  validationRun:{id:"validation-p3x",status:"idle",runs:[],baselineRuns:[],checks:[]},
  artifactAcceptance:{id:"acceptance-p3x",status:"idle",overallScore:0,coverageScore:0,
    integrityScore:0,pairwiseScore:0,hardGatePass:false,results:[],attempts:0,
    maxRepairAttempts:1,summary:"Unexecuted synthetic fixture"},
  targetConnection:{adapter:"artifact",connectionId:"artifact",status:"connected",label:"Synthetic HTML Artifact"},
  campaign:{status:"idle",executionMode:"auto-rounds",currentRound:0,candidateCount:1,
    autoApproveOfflineExperiment:false,stopCriteria:{maxRounds:1,patienceRounds:1,minImprovement:1,
      stopWhenAcceptanceMet:true,stopOnSafetyFailure:true,stopWhenMetricTargetsMet:false},
    schedule:{enabled:false,mode:"manual"}},
  release:{status:"idle",history:[],evidenceMode:"none"},
  lessons:[],updatedAt:at
};
const sourceRef=[[source.id,source.role,source.textContent,null]];
const paperHash=fastHash(JSON.stringify(final));
const contractFingerprint=fastHash(JSON.stringify([goal,command,[],protectedItems,editableItems,rubric,sourceRef]));
project.finalHoldout={round:1,suite:final,paperHash,contractFingerprint,createdAt:at};
const approval={
  schemaVersion:"p3x-synthetic-smoke-approval-request-v1",missionId:id,
  status:"prepared-not-approved",userApproved:false,registeredInLab:false,labArmed:false,
  providerCallsPerformed:0,
  source:{file,sourceArtifactId:source.id,sha256,sizeBytes:size},
  models:{generation:"MiniMax-M3",judge:"MiniMax-M3.1-Flash",baseUrl:"https://api.minimaxi.com/v1"},
  proposedTest:"one-generation-smoke-with-independent-judge",
  hardLimits:{maxPhysicalCalls:6,maxMissionTokens:300000,maxDurationMinutes:20,minQuotaRemainingPercent:50},
  nominalCallPlan:{candidate:1,independentJudge:1,otherWorkflowStages:"unknown"},
  finalHoldout:{paperHash,contractFingerprint,caseIds:final.map(x=>x.id)},
  pending:["Explicit approval of this exact synthetic Mission and bounded provider calls",
    "Import Mission and source file to isolated Lab with audited API",
    "Verify actual Chromium execution and approval for one-shot Lab run",
    "Check fresh Subscription Key quota and persist budget before each model call"],
  warning:"No Mission was created, no model called; full Gate F lifecycle within 6 physical calls is unproven."
};
function output(name,data){
  const path=join(dir,name),content=JSON.stringify(data,null,2)+"\n";
  if(existsSync(path)){assert.equal(readFileSync(path,"utf8"),content,"Review mismatch in "+name);return;}
  writeFileSync(path,content,{flag:"wx",encoding:"utf8"});
}
assert.equal(html.includes("<script"),false,"Original should intentionally lack a search handler");
assert.equal(new Set([...visible,...hidden,...final].map(x=>x.id)).size,9,"Duplicate test ID");
output("mission.template.json",project);
output("approval.request.json",approval);
console.log(JSON.stringify({status:"offline-fixtures-generated",missionId:id,sourceSha256:sha256,
  sourceBytes:size,visible:visible.length,hidden:hidden.length,independentFinal:final.length,
  paperHash,providerCalls:0,registeredInLab:false}));
