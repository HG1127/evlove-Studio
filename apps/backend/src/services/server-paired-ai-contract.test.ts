// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import type {PairedEvaluationAiResult} from "@evolution/contracts";
import {serverPairedJudgeRequest} from "@evolution/harness";
import {pairedJudgeFixture,pairedJudgeRawEvaluation} from "@evolution/testkit";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {runServerPairedEvidenceJudge} from "./server-paired-evidence-judge";

const connection={connectionId:"synthetic",label:"Synthetic",apiKey:"synthetic-key",baseUrl:"https://paired-scope.example.test/v1",model:"synthetic-model",protocol:"chat-completions" as const,responseFormat:"prompt-json" as const};
function fixture(){const x=pairedJudgeFixture();return serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");}
function reply(fingerprint:string,score=95):PairedEvaluationAiResult{
  const reversed=fingerprint.endsWith(":1"),original=pairedJudgeRawEvaluation(90),candidate=pairedJudgeRawEvaluation(score);
  return {schemaVersion:"paired-evaluation-v1",requestFingerprint:fingerprint,versions:[{slot:"A",result:reversed?candidate:original},{slot:"B",result:reversed?original:candidate},{slot:"C",result:structuredClone(original)}]};
}
afterEach(()=>vi.unstubAllGlobals());
async function assess(mode:"first-scope-bad"|"all-scope-bad"|"valid-negative"|"valid-safety-fail"|"valid-conflict"|"bad-echo-once"|"both-orders-scope-bad"){
  const counts=new Map<string,number>(),bodies:string[]=[],claim=vi.fn(async()=>{});
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
    const body=String(init?.body);bodies.push(body);const messages=(JSON.parse(body) as {messages:Array<{role:string;content:string}>}).messages;
    const input=JSON.parse(messages.findLast(m=>m.role==="user")!.content) as {requestFingerprint:string},count=counts.get(input.requestFingerprint)??0;counts.set(input.requestFingerprint,count+1);
    const result=reply(input.requestFingerprint,mode==="valid-negative"?80:mode==="valid-conflict"&&input.requestFingerprint.endsWith(":1")?84:95);
    if(mode==="bad-echo-once"&&bodies.length===1)result.requestFingerprint="not-the-issued-request";
    if(mode==="all-scope-bad"||mode==="first-scope-bad"&&bodies.length===1||mode==="both-orders-scope-bad"&&count===0)
      for(const v of result.versions)v.result.criteria[0]!.testCaseIds=["GOAL"];
    if(mode==="valid-safety-fail")result.versions.find(v=>v.slot===(input.requestFingerprint.endsWith(":1")?"A":"B"))!.result.safety="FAIL";
    return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]}),{status:200});
  });vi.stubGlobal("fetch",fetch);
  const invoke=vi.fn(async payload=>runServerAi("evaluate-paired",payload));
  const result=withExplicitServerAiConnection(connection,()=>runServerPairedEvidenceJudge(fixture(),{invoke,routeFingerprint:async()=>"fixed-model-route",claim}));
  return {result,fetch,invoke,claim,bodies,counts};
}

describe("issued paired scope inside the existing format-correction budget",()=>{
  it("repairs an invalid criterion/case namespace using only the existing one correction, then completes the other order",async()=>{
    const x=await assess("first-scope-bad"),result=await x.result;
    expect(x.fetch).toHaveBeenCalledTimes(3);expect(x.invoke).toHaveBeenCalledTimes(2);expect(x.claim).toHaveBeenCalledOnce();
    expect(result.pairedComparison!.receipt.samples).toHaveLength(2);
    for(const sample of result.pairedComparison!.receipt.samples)for(const arm of [sample.original,sample.candidate,sample.controlOriginal])expect(arm.criteria[0]!.testCaseIds).toEqual(["V1"]);
  });
  it("stops after the one format correction is also invalid, with no second-order call or fallback",async()=>{
    const x=await assess("all-scope-bad");await expect(x.result).rejects.toThrow();
    expect(x.fetch).toHaveBeenCalledTimes(2);expect(x.invoke).toHaveBeenCalledOnce();expect(x.claim).toHaveBeenCalledOnce();
  });
  it("keeps the pre-existing one format correction per order rather than giving either request a third attempt",async()=>{
    const x=await assess("both-orders-scope-bad");await x.result;
    expect(x.fetch).toHaveBeenCalledTimes(4);expect([...x.counts.values()]).toEqual([2,2]);expect(x.claim).toHaveBeenCalledOnce();
  });
  it("uses the same single format correction for a wrong echoed request identity",async()=>{
    const x=await assess("bad-echo-once");await x.result;expect(x.fetch).toHaveBeenCalledTimes(3);expect(x.claim).toHaveBeenCalledOnce();
  });
  it.each(["valid-negative","valid-safety-fail","valid-conflict"] as const)("never retries an admitted %s assessment to improve its verdict",async mode=>{
    const x=await assess(mode),result=await x.result;
    expect(x.fetch).toHaveBeenCalledTimes(2);expect(x.invoke).toHaveBeenCalledTimes(2);expect(x.claim).toHaveBeenCalledOnce();
    if(mode==="valid-negative")expect(result.criteria[0]).toMatchObject({score:80,pass:false});
    else if(mode==="valid-safety-fail")expect(result.safety).toBe("FAIL");
    else expect(result.pairedComparison!.receipt.samples.map(s=>s.candidate.criteria[0]!.score)).toEqual([95,84]);
  });
  it.each(["duplicate-case","wrong-criterion","wrong-case","unknown-version"])("rejects malformed issued %s metadata before provider I/O",async kind=>{
    const payload={schemaVersion:"paired-judge-input-v1",requestFingerprint:"issued",issuedCriterionCaseBindings:[{criterionId:"GOAL",testCaseIds:["V1"]}],acceptanceRubric:[{id:"GOAL"}],testCases:[{id:"V1",criterionIds:["GOAL"]}]};
    if(kind==="duplicate-case")payload.testCases.push({...payload.testCases[0]!});
    if(kind==="wrong-criterion")payload.issuedCriterionCaseBindings[0]!.criterionId="unknown";
    if(kind==="wrong-case")payload.issuedCriterionCaseBindings[0]!.testCaseIds=["GOAL"];
    if(kind==="unknown-version")payload.schemaVersion="unrecognized";
    const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    await expect(withExplicitServerAiConnection(connection,async()=>runServerAi("evaluate-paired",payload))).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
  });
});
