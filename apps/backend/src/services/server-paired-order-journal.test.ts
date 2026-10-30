// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {observeServerAiResponseProvenance} from "./server-ai-response-provenance";
import {withServerAiUsageScope,serverAiUsageRoute} from "./server-ai-usage";
import {withExplicitServerAiConnection,resolveServerAiConfig} from "./server-ai-connection";
import {serverAiConfigForOperation} from "./server-ai-role-config";
import {runServerAi} from "./ai-gateway";
afterEach(()=>vi.unstubAllGlobals());
import type {EvolutionEvent,PairedEvaluationAiResult,PairedOrderJournalPort,PairedOrderObservation,AiUsageRoute} from "@evolution/contracts";
import {fastHash} from "@evolution/core";
import {serverPairedJudgeRequest,settleServerPairedJudgment} from "@evolution/harness";
import {pairedJudgeFixture,pairedJudgeRawEvaluation} from "@evolution/testkit";
import {runServerPairedEvidenceJudge} from "./server-paired-evidence-judge";
import {claimPairedJudgeAttempt} from "./server-paired-judge-claim";
import {createServerPairedOrderJournal} from "./server-paired-order-journal";
function fixture(){
 const x=pairedJudgeFixture(),request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
 const events=new Map<string,EvolutionEvent>(),scope={missionId:x.project.id,jobId:"same-control-job",phase:"experiment"};
 const physicalRoute={operation:"evaluate-paired" as const,model:"fixture-model",protocol:"chat-completions" as const,routeFingerprint:"f".repeat(64)};
 const storage={scope,physicalRoutes:async():Promise<AiUsageRoute[]>=>[physicalRoute],list:vi.fn(async()=>[...events.values()]),append:vi.fn(async(e:EvolutionEvent)=>{if(!events.has(e.id))events.set(e.id,structuredClone(e));}),now:()=>x.at,nonce:()=>"one-original-claim"};
 const record=async(input:unknown,response:PairedEvaluationAiResult)=>{
  await observeServerAiResponseProvenance({schemaVersion:"ai-usage-request-v1",callId:randomUUID(),scope,route:physicalRoute,attempt:1,granularity:"physical-http-attempt",startedAt:new Date().toISOString()},JSON.stringify({messages:[{role:"user",content:JSON.stringify(input)}]}),JSON.stringify(response),200);
  return response;
 };
 const invoke=vi.fn(async(raw:unknown):Promise<PairedEvaluationAiResult>=>{
  expect([...events.values()].filter(e=>e.source==="server-paired-evidence-judge")).toHaveLength(1);
  const p=raw as {requestFingerprint:string},order=Number(p.requestFingerprint.slice(-1));
  const original=pairedJudgeRawEvaluation(90),candidate=pairedJudgeRawEvaluation(80);
  candidate.safety="FAIL";
  return record(raw,{schemaVersion:"paired-evaluation-v1",requestFingerprint:p.requestFingerprint,
   versions:[{slot:"A",result:order===0?original:candidate},{slot:"B",result:order===0?candidate:original},{slot:"C",result:structuredClone(original)}]});
 });
 const claim=vi.fn(async()=>claimPairedJudgeAttempt(request,storage));
 const make=(journal:PairedOrderJournalPort=createServerPairedOrderJournal(storage))=>({invoke,claim,journal,routeFingerprint:async()=>"fixed-model-route"});
 return {...x,request,events,storage,invoke,claim,make,record};
}
describe("durable per-order recovery under the original occupied claim",()=>{
 it("joins real gateway request/response-text observations to persisted orders and replays without a third HTTP call",async()=>{
  const x=fixture(),fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
   const input=JSON.parse(JSON.parse(String(init?.body)).messages[1].content),order=Number(input.requestFingerprint.slice(-1)),a=pairedJudgeRawEvaluation(90),b=pairedJudgeRawEvaluation(80);
   b.safety="FAIL";const value={schemaVersion:"paired-evaluation-v1",requestFingerprint:input.requestFingerprint,versions:[{slot:"A",result:order===0?a:b},{slot:"B",result:order===0?b:a},{slot:"C",result:structuredClone(a)}]};
   return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]}));
  });vi.stubGlobal("fetch",fetch);
  await withServerAiUsageScope(x.storage.scope,()=>withExplicitServerAiConnection({connectionId:"fixture",label:"Fixture",baseUrl:"https://provider.test/v1",apiKey:"fixture-private-key",model:"fixture-model",protocol:"chat-completions",responseFormat:"prompt-json"},async()=>{
   const config=await resolveServerAiConfig();if(!config)throw Error("Fixture config absent");
   x.storage.physicalRoutes=async()=>[serverAiUsageRoute(serverAiConfigForOperation(config,"evaluate-paired"),"chat-completions","evaluate-paired")];
   const ports={...x.make(),invoke:(payload:unknown)=>runServerAi("evaluate-paired",payload)};
   const first=await runServerPairedEvidenceJudge(x.request,ports),second=await runServerPairedEvidenceJudge(x.request,{...ports,journal:createServerPairedOrderJournal(x.storage)});
   expect(second).toEqual(first);expect(fetch).toHaveBeenCalledTimes(2);
   const saved=await createServerPairedOrderJournal(x.storage).read(x.request,"fixed-model-route") as PairedOrderObservation[];
   expect(saved).toHaveLength(2);expect(saved.map(o=>o.responseProvenance[0]!.pairedRequestFingerprint).sort()).toEqual([x.request.context.inputFingerprint+":0",x.request.context.inputFingerprint+":1"]);
   expect(JSON.stringify(saved)).not.toContain("fixture-private-key");
  }),async()=>{});
 });
 it("blocks missing or foreign physical provenance before any replay",async()=>{
  for(const mode of ["missing","model","job","order","legacy"]){
   const x=fixture();await runServerPairedEvidenceJudge(x.request,x.make());
   const row=[...x.events.values()].find(e=>e.source==="server-paired-order-journal")!,o=row.payload.observation as PairedOrderObservation;
   if(mode==="missing")o.responseProvenance=[];
   if(mode==="model")o.responseProvenance[0]!.request.route.model="foreign-model";
   if(mode==="job")o.responseProvenance[0]!.request.scope.jobId="foreign-job";
   if(mode==="order")o.responseProvenance[0]!.pairedRequestFingerprint="foreign-order";
   if(mode==="legacy")row.payload.measurementKind="paired-order-observation-v1";
   await expect(runServerPairedEvidenceJudge(x.request,x.make())).rejects.toThrow();expect(x.invoke).toHaveBeenCalledTimes(2);
  }
 });
 it("rejects using one physical call identity for both orders",async()=>{
  const x=fixture();await runServerPairedEvidenceJudge(x.request,x.make());
  const rows=[...x.events.values()].filter(e=>e.source==="server-paired-order-journal").map(e=>e.payload.observation as PairedOrderObservation);
  rows[1]!.responseProvenance[0]!.request.callId=rows[0]!.responseProvenance[0]!.request.callId;
  await expect(runServerPairedEvidenceJudge(x.request,x.make())).rejects.toThrow("physical response cannot");expect(x.invoke).toHaveBeenCalledTimes(2);
 });
 it("reconstructs a completed negative assessment after Mission persistence is lost, with zero repeat calls",async()=>{
  const x=fixture(),first=await runServerPairedEvidenceJudge(x.request,x.make()),before=JSON.stringify([...x.events.values()]);
  expect(x.invoke).toHaveBeenCalledTimes(2);expect(first.safety).toBe("FAIL");expect(x.events.size).toBe(3);
  const recovered=await runServerPairedEvidenceJudge(x.request,x.make());
  expect(recovered).toEqual(first);expect(x.invoke).toHaveBeenCalledTimes(2);expect(x.claim).toHaveBeenCalledTimes(1);
  expect(JSON.stringify([...x.events.values()])).toBe(before);
 });
 it("preserves first order on a crash immediately after its save, blocking unknown remaining outcome",async()=>{
  const x=fixture(),actual=createServerPairedOrderJournal(x.storage);
  const journal={read:actual.read,save:async(o:PairedOrderObservation)=>{await actual.save(o);throw Error("crash after order0 save");}};
  await expect(runServerPairedEvidenceJudge(x.request,x.make(journal))).rejects.toThrow("crash after");
  expect(x.invoke).toHaveBeenCalledTimes(1);expect(x.events.size).toBe(2);
  await expect(runServerPairedEvidenceJudge(x.request,x.make())).rejects.toThrow("Partial paired observation preserved");
  expect(x.invoke).toHaveBeenCalledTimes(1);expect(x.claim).toHaveBeenCalledTimes(1);
 });
 it("blocks replay when the second response returned but its durable result is unknown",async()=>{
  const x=fixture(),actual=createServerPairedOrderJournal(x.storage);
  const journal={read:actual.read,save:async(o:PairedOrderObservation)=>{if(o.order===1)throw Error("order1 persistence unknown");await actual.save(o);}};
  await expect(runServerPairedEvidenceJudge(x.request,x.make(journal))).rejects.toThrow("persistence unknown");
  expect(x.invoke).toHaveBeenCalledTimes(2);
  await expect(runServerPairedEvidenceJudge(x.request,x.make())).rejects.toThrow("remaining attempt outcome unconfirmed");
  expect(x.invoke).toHaveBeenCalledTimes(2);expect(x.events.size).toBe(2);
 });
 it("recovers when the second append committed but its acknowledgement was lost",async()=>{
  const x=fixture(),actual=createServerPairedOrderJournal(x.storage);
  const journal={read:actual.read,save:async(o:PairedOrderObservation)=>{await actual.save(o);if(o.order===1)throw Error("lost acknowledgement");}};
  await expect(runServerPairedEvidenceJudge(x.request,x.make(journal))).rejects.toThrow("lost acknowledgement");
  const recovered=await runServerPairedEvidenceJudge(x.request,x.make());
  expect(x.invoke).toHaveBeenCalledTimes(2);expect(recovered.safety).toBe("FAIL");expect(x.events.size).toBe(3);
 });
 it("does not give a legacy occupied claim with no saved response a new budget",async()=>{
  const x=fixture();await x.claim();
  await expect(runServerPairedEvidenceJudge(x.request,x.make())).rejects.toMatchObject({code:"PAIRED_JUDGE_ATTEMPT_NOT_OWNED"});
  expect(x.invoke).not.toHaveBeenCalled();expect(x.events.size).toBe(1);
 });
 it("rejects stored wrong route/paper/file/hash or invalid schema before another model call",async()=>{
  for(const mode of ["route","paper","file","hash","schema"]){
   const x=fixture();await runServerPairedEvidenceJudge(x.request,x.make());
   const stored=await createServerPairedOrderJournal(x.storage).read(x.request,"fixed-model-route") as PairedOrderObservation[];
   if(mode==="route")stored[0]!.scoringRouteFingerprint="foreign-model";
   if(mode==="paper")stored[0]!.context.suiteFingerprint="foreign-paper";
   if(mode==="file")stored[0]!.context.bindings[0]!.candidateSha256="f".repeat(64);
   if(mode==="hash")stored[0]!.resultSha256="f".repeat(64);
   if(mode==="schema")stored[0]!.response.versions.pop();
   const journal={read:async()=>stored,save:vi.fn()};
   await expect(runServerPairedEvidenceJudge(x.request,x.make(journal))).rejects.toThrow();
   expect(x.invoke).toHaveBeenCalledTimes(2);expect(journal.save).not.toHaveBeenCalled();
  }
 });
 it("accepts canonical JSONB key reordering without changing stored results",async()=>{
  const x=fixture();const first=await runServerPairedEvidenceJudge(x.request,x.make());
  function reverse(v:unknown):unknown{return Array.isArray(v)?v.map(reverse):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).reverse().map(([k,v])=>[k,reverse(v)])):v;}
  x.storage.list.mockImplementation(async()=>[...x.events.values()].map(e=>reverse(e) as EvolutionEvent));
  expect(await runServerPairedEvidenceJudge(x.request,x.make())).toEqual(first);expect(x.invoke).toHaveBeenCalledTimes(2);
 });
 it("does not reinterpret a preserved conflicting pair as verified or improve its score",async()=>{
  const x=fixture();
  x.invoke.mockImplementation(async raw=>{
   const p=raw as {requestFingerprint:string},order=Number(p.requestFingerprint.slice(-1));
   const a=pairedJudgeRawEvaluation(90),b=pairedJudgeRawEvaluation(order===0?95:89);
   return x.record(raw,{schemaVersion:"paired-evaluation-v1",requestFingerprint:p.requestFingerprint,versions:[{slot:"A",result:order===0?a:b},{slot:"B",result:order===0?b:a},{slot:"C",result:structuredClone(a)}]});
  });
  const first=await runServerPairedEvidenceJudge(x.request,x.make()),again=await runServerPairedEvidenceJudge(x.request,x.make());
  expect(again).toEqual(first);const settled=settleServerPairedJudgment(x.project,x.project.evalSuite,x.candidateRuns,x.originalRuns,x.request,again);
  expect(settled.criterionScores![0]!.verificationStatus).toBe("unverified");expect(settled.safety).toBe("REVIEW");
  expect(x.invoke).toHaveBeenCalledTimes(2);
 });
 it("holds a changed request, different Job, malformed Event or incomplete canonical lookup",async()=>{
  for(const mode of ["input","job","event","lookup"]){
   const x=fixture();await runServerPairedEvidenceJudge(x.request,x.make());
   let request=x.request;
   if(mode==="input"){request=structuredClone(request);request.goal+=" new";const {inputFingerprint:_,...context}=request.context;void _;request.context.inputFingerprint=fastHash({...request,context});}
   if(mode==="job")x.storage.scope.jobId="different-job";
   if(mode==="event")for(const event of x.events.values())if(event.source==="server-paired-order-journal")event.source="untrusted-origin";
   if(mode==="lookup")x.storage.list.mockResolvedValue(Array(1000).fill([...x.events.values()][0]));
   await expect(runServerPairedEvidenceJudge(request,x.make())).rejects.toThrow();expect(x.invoke).toHaveBeenCalledTimes(2);
  }
 });
});
