// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {PAIRED_JSONL_PROTOCOL,PAIRED_CRITERION_EVIDENCE_POLICY,type PairedEvaluationAiResult} from "@evolution/contracts";
import {SERVER_SEMANTIC_CONTEXT_VERSION,SERVER_MEASURED_REVIEW_VERSION,SERVER_PAIRED_INPUT_VERSION,serverPairedJudgeRequest,settleServerPairedJudgment} from "@evolution/harness";
import {pairedJudgeFixture,pairedJudgeRawEvaluation} from "@evolution/testkit";
import {runServerAi,serverAiScoringRouteFingerprint} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {serverAiPairedContract} from "./server-paired-ai-contract";
import {runServerPairedEvidenceJudge} from "./server-paired-evidence-judge";
import {SERVER_PAIRED_GENERATION_SCHEMA_VERSION} from "./server-paired-json-schema";
import {SERVER_PAIRED_JSONL_GENERATION_VERSION} from "./server-paired-jsonl-output";
import {serverAiPairedOutcomeReferenceMode,SERVER_PAIRED_OUTCOME_REFERENCE_VERSION} from "./server-ai-output-policy";

const connection={connectionId:"fixture",label:"Fixture",apiKey:"test-only",baseUrl:"https://fixture.invalid/v1",model:"fixture",protocol:"chat-completions" as const,responseFormat:"json-schema" as const};
const issued=()=>({schemaVersion:"paired-judge-input-v1",requestFingerprint:"fixed",acceptanceRubric:[{id:"REL",judgeType:"pairwise",category:"outcome",protectedConstraint:false,minScore:85},
 {id:"SEM",judgeType:"pairwise",category:"artifact-specific",protectedConstraint:false,minScore:92},{id:"PROTECT",judgeType:"pairwise",category:"protected",protectedConstraint:true,minScore:95},
 {id:"ABS",judgeType:"llm",category:"outcome",protectedConstraint:false,minScore:92}],
 testCases:[{id:"V1",criterionIds:["REL","SEM","PROTECT","ABS"]}],issuedCriterionCaseBindings:["REL","SEM","PROTECT","ABS"].map(criterionId=>({criterionId,testCaseIds:["V1"]}))});
function reply(fingerprint:string,referenceScore=0,status?:"sufficient"|"unknown",safety:"REVIEW"|"FAIL"="REVIEW",absolute?:{status?:"sufficient"|"unknown"}){
 const original=pairedJudgeRawEvaluation(50),candidate=pairedJudgeRawEvaluation(50);
 Object.assign(original.criteria[0]!,{score:referenceScore,pass:false});Object.assign(candidate.criteria[0]!,{score:0,pass:false});
 for(const a of [original,candidate]){Object.assign(a,{accuracy:50,evidence:50,riskCoverage:50,completeness:50,safety});a.criteria[0]!.gaps=["Synthetic fixture; not model evidence."];if(status)a.criteria[0]!.evidenceStatus=status;}
 if(absolute)for(const a of [original,candidate])a.criteria.push({criterionId:"ABS",score:0,pass:false,testCaseIds:["V1"],evidence:absolute.status==="sufficient"?["Synthetic confirmed absence"]:[],gaps:["Synthetic fixture"],...(absolute.status?{evidenceStatus:absolute.status}:{})});
 const reverse=fingerprint.endsWith(":1");
 const versions:PairedEvaluationAiResult["versions"]=[{slot:"A",result:reverse?candidate:original},{slot:"B",result:reverse?original:candidate},{slot:"C",result:structuredClone(original)}];
 const records:unknown[]=[{kind:"header",protocol:PAIRED_JSONL_PROTOCOL,requestFingerprint:fingerprint}];
 for(const arm of versions){const {criteria,...summary}=arm.result;records.push({kind:"summary",slot:arm.slot,value:summary});for(const row of criteria)records.push({kind:"criterion",slot:arm.slot,value:row});}
 records.push({kind:"end",requestFingerprint:fingerprint,criterionRecords:versions[0]!.result.criteria.length*3});return records.map(r=>JSON.stringify(r)).join("\n");
}
beforeEach(()=>{vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","jsonl-v1");vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","");vi.stubEnv("EVOLUTION_AI_REASONING_EFFORT","");vi.stubEnv("EVOLUTION_AI_JUDGE_REASONING_EFFORT","");});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

describe("server-configured paired relative outcome reference",()=>{
 it("is opt-in and explains only public eligible criteria without changing the issued body or oracle",()=>{
  const p=issued(),before=structuredClone(p),legacy=serverAiPairedContract(p).instruction;
  expect(serverAiPairedOutcomeReferenceMode()).toBeUndefined();expect(legacy).not.toContain("public reference anchor");
  vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","zero-v1");
  const c=serverAiPairedContract(p);expect(c.instruction).toContain('ONLY to criterion IDs ["REL"]');
  expect(c.instruction).toContain("not standalone document quality");expect(c.instruction).toContain("sufficient comparable evidence confirms");
  expect(c.instruction).toContain("set safety=REVIEW");expect(c.instruction).toContain("All other absolute and protection criteria retain their unchanged meanings and minima");
  expect(c.instruction).toContain("EVERY issued criterion in EVERY slot");expect(c.instruction).toContain("sufficient does not mean passing or safe");
  expect(p).toEqual(before);expect(c.schema).toEqual(serverAiPairedContract(before).schema);
 });
 it("binds both the active mode and exact instruction/qualification version into the scoring route",async()=>{
  await withExplicitServerAiConnection(connection,async()=>{
   const legacy=await serverAiScoringRouteFingerprint();vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","zero-v1");
   const route=["openai-compatible",connection.baseUrl,connection.model,connection.protocol,connection.responseFormat];
   const expected=createHash("sha256").update(JSON.stringify({route,semanticContextVersion:SERVER_SEMANTIC_CONTEXT_VERSION,measuredReviewVersion:SERVER_MEASURED_REVIEW_VERSION,
    pairedGenerationSchemaVersion:SERVER_PAIRED_GENERATION_SCHEMA_VERSION,pairedInputVersion:SERVER_PAIRED_INPUT_VERSION,
    pairedOutcomeReference:"zero-v1",pairedOutcomeReferenceVersion:SERVER_PAIRED_OUTCOME_REFERENCE_VERSION,pairedCriterionEvidencePolicy:PAIRED_CRITERION_EVIDENCE_POLICY,
    pairedOutputTransport:PAIRED_JSONL_PROTOCOL,pairedOutputGenerationVersion:SERVER_PAIRED_JSONL_GENERATION_VERSION})).digest("hex");
   expect(await serverAiScoringRouteFingerprint()).toBe(expected);expect(expected).not.toBe(legacy);
   vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","");expect(await serverAiScoringRouteFingerprint()).toBe(legacy);
  });
 });
 it.each(["invalid-mode","unissued","invalid-metadata","missing-metadata"])("rejects %s before provider I/O",async kind=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE",kind==="invalid-mode"?"private-invalid":"zero-v1");
  const p=issued();if(kind==="invalid-metadata")p.acceptanceRubric[0]!.judgeType="invented";
  if(kind==="missing-metadata")Reflect.deleteProperty(p.acceptanceRubric[0]!,"category");
  const attempt=Promise.resolve().then(()=>withExplicitServerAiConnection(connection,()=>runServerAi("evaluate-paired",kind==="unissued"?{}:p)));
  await expect(attempt).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
  if(kind==="invalid-mode")expect(()=>serverAiPairedOutcomeReferenceMode()).toThrow("Invalid paired outcome reference configuration");
 });
 it.each([[0,undefined,"REVIEW",true],[40,undefined,"REVIEW",true],[0,"unknown","FAIL",true],[0,undefined,"FAIL",true],[0,"sufficient","FAIL",false]] as const)("retains score %s / relative status %s / safety %s without correction and qualifies normal settlement",async(referenceScore,status,safety,uncertain)=>{
  vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","zero-v1");const x=pairedJudgeFixture();x.project.acceptanceRubric[0]!.judgeType="pairwise";
  const request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)) as {messages:Array<{role:string;content:string}>};
   expect(body.messages[0]!.content).toContain('ONLY to criterion IDs ["GOAL"]');
   const p=JSON.parse(body.messages.find(m=>m.role==="user")!.content) as {requestFingerprint:string};
   return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:reply(p.requestFingerprint,referenceScore,status,safety)}}]}),{status:200});
  });vi.stubGlobal("fetch",fetch);
  const ai=await withExplicitServerAiConnection(connection,()=>runServerPairedEvidenceJudge(request,{invoke:p=>runServerAi("evaluate-paired",p),routeFingerprint:serverAiScoringRouteFingerprint}));
  expect(fetch).toHaveBeenCalledTimes(2);expect(ai.pairedComparison!.receipt.outcomeReferencePolicy).toBe("zero-v1");
  expect(ai.pairedComparison!.receipt.samples.map(s=>s.original.criteria[0]!.score)).toEqual([referenceScore,referenceScore]);
  const settled=settleServerPairedJudgment(x.project,x.project.evalSuite,x.candidateRuns,x.originalRuns,request,ai);
  expect(settled.criterionScores?.[0]).toMatchObject({score:0,pass:false,verificationStatus:uncertain?"unverified":"verified"});
  expect(settled.unverifiedCriterionIds).toEqual(uncertain?["GOAL"]:[]);expect(settled.safety).toBe(safety);
  for(const s of ai.pairedComparison!.receipt.samples)for(const a of [s.original,s.candidate,s.controlOriginal])expect(a.criteria[0]!.evidenceStatus).toBe(status);
 });
 it.each([["unknown","FAIL"],[undefined,"FAIL"],["sufficient","FAIL"],["unknown","REVIEW"]] as const)("retains absolute %s independently from a known relative verdict and global %s, without a retry",async(absoluteStatus,safety)=>{
  vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","zero-v1");const x=pairedJudgeFixture();x.project.acceptanceRubric[0]!.judgeType="pairwise";
  x.project.acceptanceRubric.push({...x.project.acceptanceRubric[0]!,id:"ABS",judgeType:"llm"});x.project.evalSuite[0]!.criterionIds.push("ABS");
  const request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)) as {messages:Array<{role:string;content:string}>};
   const p=JSON.parse(body.messages.find(m=>m.role==="user")!.content) as {requestFingerprint:string};
   return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:reply(p.requestFingerprint,0,"sufficient",safety,{status:absoluteStatus})}}]}));
  });vi.stubGlobal("fetch",fetch);
  const ai=await withExplicitServerAiConnection(connection,()=>runServerPairedEvidenceJudge(request,{invoke:p=>runServerAi("evaluate-paired",p),routeFingerprint:serverAiScoringRouteFingerprint}));
  expect(fetch).toHaveBeenCalledTimes(2);expect(ai.pairedComparison!.receipt.evidenceStatusPolicy).toBe(PAIRED_CRITERION_EVIDENCE_POLICY);
  const settled=settleServerPairedJudgment(x.project,x.project.evalSuite,x.candidateRuns,x.originalRuns,request,ai);
  expect(settled.safety).toBe(safety);expect(settled.criterionScores?.find(c=>c.criterionId==="GOAL")).toMatchObject({score:0,pass:false,verificationStatus:"verified"});
  expect(settled.criterionScores?.find(c=>c.criterionId==="ABS")).toMatchObject({score:0,pass:false,verificationStatus:absoluteStatus==="sufficient"?"verified":"unverified"});
  expect(settled.unverifiedCriterionIds).toEqual(absoluteStatus==="sufficient"?[]:["ABS"]);
 });
 it("leaves unrelated operations on their original instruction even with an invalid paired-only mode",async()=>{
  vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","private-invalid");
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   expect(String(init?.body)).not.toContain("public reference anchor");
   return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(pairedJudgeRawEvaluation(90))}}]}));
  });vi.stubGlobal("fetch",fetch);
  await withExplicitServerAiConnection(connection,()=>runServerAi("evaluate",{}));expect(fetch).toHaveBeenCalledOnce();
 });
 it("stops if the reference policy changes after a response, without a new order or retry",async()=>{
  vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","zero-v1");const x=pairedJudgeFixture();x.project.acceptanceRubric[0]!.judgeType="pairwise";
  const request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body)) as {messages:Array<{role:string;content:string}>};
   const p=JSON.parse(body.messages.find(m=>m.role==="user")!.content) as {requestFingerprint:string};
   vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","");return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:reply(p.requestFingerprint)}}]}));
  });vi.stubGlobal("fetch",fetch);
  await expect(withExplicitServerAiConnection(connection,()=>runServerPairedEvidenceJudge(request,{invoke:p=>runServerAi("evaluate-paired",p),routeFingerprint:serverAiScoringRouteFingerprint}))).rejects.toThrow("Paired response or route binding differs");
  expect(fetch).toHaveBeenCalledOnce();
 });
});
