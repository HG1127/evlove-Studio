// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {PAIRED_SOURCE_QUOTATION_POLICY,PairedOrderObservationSchema,type PairedEvaluationAiResult,type PairedOrderObservation} from "@evolution/contracts";
import {fastHash} from "@evolution/core";
import {serverPairedJudgeRequest,pairedQuotationDocuments} from "@evolution/harness";
import {pairedJudgeFixture,pairedJudgeRawEvaluation} from "@evolution/testkit";
import {runServerPairedEvidenceJudge} from "./server-paired-evidence-judge";
import {serverAiPairedSourceQuotationPolicy} from "./server-ai-output-policy";
import {observeServerAiResponseProvenance} from "./server-ai-response-provenance";
import {serverPairedJsonlOutput} from "./server-paired-jsonl-output";
import {serverAiPairedContract} from "./server-paired-ai-contract";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";

beforeEach(()=>{
 vi.stubEnv("EVOLUTION_AI_PAIRED_OUTCOME_REFERENCE","zero-v1");vi.stubEnv("EVOLUTION_AI_PAIRED_SAFETY_POLICY","evidence-grounded-v1");
 vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","jsonl-v1");vi.stubEnv("EVOLUTION_AI_PAIRED_SOURCE_QUOTATIONS",PAIRED_SOURCE_QUOTATION_POLICY);
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
function setup(change?:(response:PairedEvaluationAiResult)=>void){
 const x=pairedJudgeFixture(),request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
 const binding=request.context.bindings[0]!;
 for(const [arm,text,sha256] of [["original","Original measured body",binding.originalSha256],["candidate","Updated measured body",binding.candidateSha256]] as const){
  request.versions[arm].documents={observations:[{output:"wrapper\n"+text+"\nfacts not body",quotationSource:{sourceArtifactId:binding.sourceArtifactId,sha256,start:8,length:text.length,complete:true}}]};
 }
 const {inputFingerprint:_,...context}=request.context;void _;request.context.inputFingerprint=fastHash({...request,context});
 const saved:PairedOrderObservation[]=[],claim=vi.fn(async()=>{});
 const invoke=vi.fn(async(raw:unknown):Promise<PairedEvaluationAiResult>=>{
  const input=raw as {requestFingerprint:string;versions:Array<{slot:"A"|"B"|"C";observations:{documents:unknown}}>};
  const response:PairedEvaluationAiResult={schemaVersion:"paired-evaluation-v1",requestFingerprint:input.requestFingerprint,versions:input.versions.map(version=>{
   const documents=pairedQuotationDocuments(version.observations.documents,[{sourceArtifactId:binding.sourceArtifactId,sha256:(version.observations.documents as {observations:Array<{quotationSource:{sha256:string}}>}).observations[0]!.quotationSource.sha256}]);
   const doc=documents[0]!,result=pairedJudgeRawEvaluation(doc.sha256===binding.originalSha256?90:97);
   result.notes=[doc.text];result.sourceQuotations=[{noteIndex:0,sourceArtifactId:doc.sourceArtifactId,sha256:doc.sha256,relation:"present",quote:doc.text}];
   return {slot:version.slot,result};
  })};change?.(response);
  await observeServerAiResponseProvenance({schemaVersion:"ai-usage-request-v1",callId:randomUUID(),
   scope:{missionId:request.context.missionId,jobId:"synthetic-job",phase:"experiment"},
   route:{operation:"evaluate-paired",model:"synthetic",protocol:"chat-completions",routeFingerprint:"f".repeat(64)},attempt:1,granularity:"physical-http-attempt",startedAt:new Date().toISOString()},JSON.stringify({messages:[{role:"user",content:JSON.stringify(input)}]}),JSON.stringify(response),200);
  return response;
 });
 const ports={invoke,claim,routeFingerprint:async()=>"fixed-model-route",journal:{read:async()=>saved,save:async(o:PairedOrderObservation)=>{saved.push(PairedOrderObservationSchema.parse(o));}}};
 return {request,ports,saved,binding};
}
describe("prospective source quotation enforcement",()=>{
 it("retains both raw typed claims, binds swapped slots and marks the new runtime receipt",async()=>{
  const x=setup(),value=await runServerPairedEvidenceJudge(x.request,x.ports);
  expect(value.pairedComparison!.receipt.sourceQuotationPolicy).toBe(PAIRED_SOURCE_QUOTATION_POLICY);
  expect(x.ports.invoke).toHaveBeenCalledTimes(2);expect(x.saved).toHaveLength(2);
  expect(x.saved[0]!.response.versions[1]!.result.sourceQuotations![0]!.sha256).toBe(x.binding.candidateSha256);
  expect(x.saved[1]!.response.versions[0]!.result.sourceQuotations![0]!.sha256).toBe(x.binding.candidateSha256);
  expect(value.sourceQuotations!.map(q=>q.noteIndex)).toEqual([0,1]);
  expect(await runServerPairedEvidenceJudge(x.request,x.ports)).toEqual(value);expect(x.ports.invoke).toHaveBeenCalledTimes(2);
 });
 it("journals an adverse cross-slot quotation before stopping, without changing Safety or retrying",async()=>{
  const x=setup(response=>{
   const result=response.versions.find(v=>v.slot==="B")!.result;
   result.safety="REVIEW";result.notes=["Original measured body"];result.sourceQuotations![0]!.quote="Original measured body";
  });
  await expect(runServerPairedEvidenceJudge(x.request,x.ports)).rejects.toMatchObject({code:"AI_SOURCE_QUOTATION_UNSUPPORTED",issues:expect.arrayContaining([{slot:"B",code:"unsupported-present",noteIndex:0}])});
  expect(x.saved).toHaveLength(1);expect(x.saved[0]!.response.versions[1]!.result).toMatchObject({safety:"REVIEW",notes:["Original measured body"]});
  await expect(runServerPairedEvidenceJudge(x.request,x.ports)).rejects.toThrow();expect(x.ports.invoke).toHaveBeenCalledOnce();expect(x.ports.claim).toHaveBeenCalledOnce();
 });
 it.each(["missing","uncovered","decorative"])("retains and stops %s support without a second call",async kind=>{
  const x=setup(response=>{const result=response.versions[1]!.result;if(kind==="missing")delete result.sourceQuotations;else if(kind==="uncovered")result.sourceQuotations=[];else result.notes=["Unrelated source assertion"];
  });
  await expect(runServerPairedEvidenceJudge(x.request,x.ports)).rejects.toMatchObject({code:"AI_SOURCE_QUOTATION_UNSUPPORTED"});
  expect(x.saved).toHaveLength(1);expect(x.ports.invoke).toHaveBeenCalledOnce();
 });
 it.each(["FAIL","REVIEW"] as const)("never overrides a supported %s verdict",async safety=>{
  const x=setup(response=>{for(const v of response.versions)v.result.safety=safety;});
  const result=await runServerPairedEvidenceJudge(x.request,x.ports);expect(result.safety).toBe(safety);expect(x.ports.invoke).toHaveBeenCalledTimes(2);
 });
 it("rejects incomplete source projection before claiming or invoking any model",async()=>{
  const x=setup();x.request.versions.candidate.documents={observations:[]};const {inputFingerprint:_,...context}=x.request.context;void _;x.request.context.inputFingerprint=fastHash({...x.request,context});
  await expect(runServerPairedEvidenceJudge(x.request,x.ports)).rejects.toThrow("unavailable");expect(x.ports.invoke).not.toHaveBeenCalled();expect(x.ports.claim).not.toHaveBeenCalled();
 });
 it("requires explicit policies and leaves legacy archived response fields absent",()=>{
  vi.stubEnv("EVOLUTION_AI_PAIRED_SOURCE_QUOTATIONS","");expect(serverAiPairedSourceQuotationPolicy()).toBeUndefined();
  expect(pairedJudgeRawEvaluation(90)).not.toHaveProperty("sourceQuotations");
  vi.stubEnv("EVOLUTION_AI_PAIRED_SOURCE_QUOTATIONS","unknown");expect(()=>serverAiPairedSourceQuotationPolicy()).toThrow("Invalid");
  vi.stubEnv("EVOLUTION_AI_PAIRED_SOURCE_QUOTATIONS",PAIRED_SOURCE_QUOTATION_POLICY);vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","json");expect(()=>serverAiPairedSourceQuotationPolicy()).toThrow("require");
 });
 it("generates the new JSONL summary field, preserves it through both parsers and refuses format correction",async()=>{
  const x=setup();const raw=await runServerPairedEvidenceJudge(x.request,x.ports);expect(raw.sourceQuotations).toBeDefined();
  const payload=x.ports.invoke.mock.calls[0]![0],contract=serverAiPairedContract(payload),output=serverPairedJsonlOutput(payload,contract.parser,contract.instruction);
  expect(output.system).toContain('"sourceQuotations"');
  const value=x.saved[0]!.response,records=[{kind:"header",protocol:"paired-evaluation-jsonl-v1",requestFingerprint:value.requestFingerprint},
   ...value.versions.flatMap(v=>{const {criteria,...summary}=v.result;return [{kind:"summary",slot:v.slot,value:summary},...criteria.map(row=>({kind:"criterion",slot:v.slot,value:row}))];}),
   {kind:"end",requestFingerprint:value.requestFingerprint,criterionRecords:3}];
  const wire=records.map(r=>JSON.stringify(r)).join("\n");expect(output.parse(wire)).toEqual(value);
  const fetch=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"malformed"}}]}),{status:200}));vi.stubGlobal("fetch",fetch);
  await expect(withExplicitServerAiConnection({connectionId:"synthetic",label:"Synthetic",apiKey:"synthetic-key",baseUrl:"https://quotes.example.test/v1",model:"synthetic",protocol:"chat-completions",responseFormat:"prompt-json"},()=>runServerAi("evaluate-paired",payload))).rejects.toThrow();
  expect(fetch).toHaveBeenCalledOnce();
 });
});
