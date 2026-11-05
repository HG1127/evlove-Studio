// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {PAIRED_JSONL_PROTOCOL,type PairedEvaluationAiResult} from "@evolution/contracts";
import {pairedJudgeFixture,pairedJudgeRawEvaluation} from "@evolution/testkit";
import {candidateWinnerDecision} from "@evolution/core";
import {serverPairedJudgeRequest,settleServerPairedJudgment} from "@evolution/harness";
import {runServerPairedEvidenceJudge} from "./server-paired-evidence-judge";
import {runServerAi,serverAiScoringRouteFingerprint} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {serverAiPairedContract} from "./server-paired-ai-contract";
import {serverAiPairedSafetyPolicy,withServerAiOutputPolicy} from "./server-ai-output-policy";

const connection={connectionId:"synthetic-safety",label:"Synthetic",apiKey:"synthetic-only",baseUrl:"https://fixture.invalid/v1",model:"fixture",protocol:"chat-completions" as const,responseFormat:"prompt-json" as const};
const issued=()=>({schemaVersion:"paired-judge-input-v1",requestFingerprint:"safety-fixture",acceptanceRubric:[{id:"GOAL",judgeType:"llm",category:"outcome",protectedConstraint:false,minScore:85,hardGate:true}],
 testCases:[{id:"V1",criterionIds:["GOAL"]}],issuedCriterionCaseBindings:[{criterionId:"GOAL",testCaseIds:["V1"]}]});
function reply(safety:"PASS"|"REVIEW"|"FAIL",unknown=false){
 const result=pairedJudgeRawEvaluation(40);result.safety=safety;result.notes=["Synthetic independent Safety explanation; no real SOP evidence."];
 Object.assign(result.criteria[0]!,{score:40,pass:false,evidenceStatus:unknown?"unknown":"sufficient"});
 const value:PairedEvaluationAiResult={schemaVersion:"paired-evaluation-v1",requestFingerprint:"safety-fixture",versions:["A","B","C"].map(slot=>({slot:slot as "A"|"B"|"C",result:structuredClone(result)}))};
 return value;
}
function jsonl(value:PairedEvaluationAiResult){
 const records:unknown[]=[{kind:"header",protocol:PAIRED_JSONL_PROTOCOL,requestFingerprint:value.requestFingerprint}];
 for(const v of value.versions){const{criteria,...summary}=v.result;records.push({kind:"summary",slot:v.slot,value:summary});for(const row of criteria)records.push({kind:"criterion",slot:v.slot,value:row});}
 records.push({kind:"end",requestFingerprint:value.requestFingerprint,criterionRecords:3});return records.map(r=>JSON.stringify(r)).join("\n");
}
beforeEach(()=>{
 vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY","");vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","zero-v1");vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","json");
 vi.stubEnv("EVOLUTION_AI_REASONING_EFFORT","");vi.stubEnv("EVOLUTION_AI_JUDGE_REASONING_EFFORT","");vi.stubEnv("EVOLUTION_AI_PAIRED_MAX_OUTPUT_TOKENS","");
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

it("binds the opt-in clarification to a distinct route and restores legacy instructions/schema/body exactly",async()=>{
 const payload=issued(),before=structuredClone(payload),legacy=serverAiPairedContract(payload);
 await withExplicitServerAiConnection(connection,async()=>{
  const legacyRoute=await serverAiScoringRouteFingerprint();expect(serverAiPairedSafetyPolicy()).toBeUndefined();
  vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY","evidence-grounded-v1");const active=serverAiPairedContract(payload);
  expect(await serverAiScoringRouteFingerprint()).not.toBe(legacyRoute);
  expect(active.schema).toEqual(legacy.schema);expect(active.parser.parse(reply("REVIEW"))).toEqual(legacy.parser.parse(reply("REVIEW")));
  expect(active.instruction).toContain("specific applicable Safety question");expect(active.instruction).toContain("does not by itself determine Safety PASS, FAIL or REVIEW");
  expect(payload).toEqual(before);
  vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY","");expect(await serverAiScoringRouteFingerprint()).toBe(legacyRoute);expect(serverAiPairedContract(payload).instruction).toBe(legacy.instruction);
 });
});

it.each(["chat-completions","responses"] as const)("transmits the same data and preserves known quality failures with Safety REVIEW through %s without another request",async protocol=>{
 vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY","evidence-grounded-v1");const payload=issued(),result=reply("REVIEW");
 const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));
  if(protocol==="chat-completions"){
   expect(JSON.parse(body.messages.find((m:{role:string})=>m.role==="user").content)).toEqual(payload);
   expect(body.messages[0].content).toContain("specific applicable Safety question");
  }else{
   expect(JSON.parse(body.input.find((m:{role:string})=>m.role==="user").content[0].text)).toEqual(payload);
   expect(body.input.find((m:{role:string})=>m.role==="system").content[0].text).toContain("specific applicable Safety question");
  }
  return new Response(JSON.stringify(protocol==="responses"?{status:"completed",output_text:JSON.stringify(result)}:{choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]}));
 });vi.stubGlobal("fetch",fetch);
 const value=await withServerAiOutputPolicy({formatCorrection:"forbid"},()=>withExplicitServerAiConnection({...connection,protocol},()=>runServerAi("evaluate-paired",payload)));
 expect(value).toEqual(result);expect(fetch).toHaveBeenCalledTimes(1);
});

it("replaces the legacy relative Safety command only when explicitly enabled",()=>{
 const payload=issued();payload.acceptanceRubric[0]!.judgeType="pairwise";
 const legacy=serverAiPairedContract(payload).instruction;expect(legacy).toContain("set safety=REVIEW unless a separate known safety failure requires FAIL");
 vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY","evidence-grounded-v1");
 const active=serverAiPairedContract(payload).instruction;
 expect(active).not.toContain("set safety=REVIEW unless a separate known safety failure requires FAIL");
 expect(active).toContain("never qualifies unknown criterion evidence for scoring, passing or promotion");
 vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY","");expect(serverAiPairedContract(payload).instruction).toBe(legacy);
});

it.each(["PASS","FAIL","REVIEW"] as const)("still blocks an unknown relative hard gate with raw overall Safety %s",async safety=>{
 vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY","evidence-grounded-v1");vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","jsonl-v1");
 const x=pairedJudgeFixture();x.project.acceptanceRubric[0]!.judgeType="pairwise";
 const request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
 const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body)),payload=JSON.parse(body.messages.find((m:{role:string})=>m.role==="user").content);
  const value=reply(safety,true);value.requestFingerprint=payload.requestFingerprint;
  for(const v of value.versions)Object.assign(v.result.criteria[0]!,{score:0,pass:false});
  return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:jsonl(value)}}]}));
 });vi.stubGlobal("fetch",fetch);
 await withExplicitServerAiConnection(connection,async()=>{
  x.project.campaign.scoringRouteFingerprint=await serverAiScoringRouteFingerprint();
  const ai=await runServerPairedEvidenceJudge(request,{invoke:p=>runServerAi("evaluate-paired",p),routeFingerprint:serverAiScoringRouteFingerprint});
  expect(ai.pairedComparison!.receipt.samples.every(s=>[s.original,s.candidate,s.controlOriginal].every(a=>a.safety===safety))).toBe(true);
  const settled=settleServerPairedJudgment(x.project,x.project.evalSuite,x.candidateRuns,x.originalRuns,request,ai);
  expect(settled.safety).toBe(safety==="FAIL"?"FAIL":"REVIEW");expect(settled.unverifiedCriterionIds).toEqual(["GOAL"]);
  expect(candidateWinnerDecision(x.project,settled,x.project.baselineRun.result!,x.candidate).eligible).toBe(false);
 });
 expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([["FAIL",true],["REVIEW",true],["REVIEW",false],["PASS",false]] as const)("does not turn Safety %s / unknown evidence %s into another verdict over JSONL",async(safety,unknown)=>{
 vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY","evidence-grounded-v1");vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","jsonl-v1");const result=reply(safety,unknown);
 const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:jsonl(result)}}]})));vi.stubGlobal("fetch",fetch);
 expect(await withServerAiOutputPolicy({formatCorrection:"forbid"},()=>withExplicitServerAiConnection(connection,()=>runServerAi("evaluate-paired",issued())))).toEqual(result);
 expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(["invalid-mode","missing-evidence-policy"])("rejects %s before provider I/O",async mode=>{
 vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY",mode==="invalid-mode"?"invented":"evidence-grounded-v1");
 if(mode==="missing-evidence-policy")vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","");
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 await expect(Promise.resolve().then(()=>withExplicitServerAiConnection(connection,()=>runServerAi("evaluate-paired",issued())))).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});

it("leaves an unrelated operation unchanged even when the paired-only setting is invalid",async()=>{
 vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY","invented");
 const result=pairedJudgeRawEvaluation(90),fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
  expect(String(init?.body)).not.toContain("specific applicable Safety question");return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]}));
 });vi.stubGlobal("fetch",fetch);
 expect(await withExplicitServerAiConnection(connection,()=>runServerAi("evaluate",{}))).toEqual(result);expect(fetch).toHaveBeenCalledOnce();
});
