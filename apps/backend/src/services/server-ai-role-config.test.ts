// @vitest-environment node
import {createHash} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {AiOperation,AiUsageLedgerRecord} from "@evolution/contracts";
import {serverPairedJudgeRequest} from "@evolution/harness";
import {pairedJudgeFixture,pairedJudgeRawEvaluation} from "@evolution/testkit";
import {getServerAiConfig} from "../server-env";
import {runServerAi,serverAiScoringRouteFingerprint} from "./ai-gateway";
import {resolveServerAiConfig,withExplicitServerAiConnection} from "./server-ai-connection";
import {withServerAiUsageScope} from "./server-ai-usage";
import {runServerPairedEvidenceJudge} from "./server-paired-evidence-judge";

const baseKey="EVOLUTION_AI_REASONING_EFFORT",judgeKey="EVOLUTION_AI_JUDGE_REASONING_EFFORT";
const keys=[baseKey,judgeKey,"EVOLUTION_AI_API_KEY","EVOLUTION_AI_MODEL","EVOLUTION_AI_BASE_URL","OPENAI_API_KEY","OPENAI_MODEL","VERCEL","VERCEL_ENV","VERCEL_OIDC_TOKEN","EVOLUTION_AI_GATEWAY_ENABLED"];
const previous=new Map<string,string|undefined>();
const input={connectionId:"role-test",label:"Test",apiKey:"synthetic-private-key",model:"test-model",baseUrl:"https://provider.test/v1",protocol:"chat-completions" as const,responseFormat:"prompt-json" as const};
const judged:AiOperation[]=["evaluate","evaluate-paired","evaluate-population","artifact-acceptance","release-review","visual-judge"];
const generated:AiOperation[]=["plan","build-candidate","diagnose","copilot"];
beforeEach(()=>{for(const k of keys){previous.set(k,process.env[k]);delete process.env[k];}});
afterEach(()=>{for(const k of keys){const value=previous.get(k);if(value===undefined)delete process.env[k];else process.env[k]=value;}vi.unstubAllGlobals();});

describe("pinned evaluator reasoning configuration",()=>{
  it.each(["chat-completions","responses"] as const)("keeps generation medium and judging high in one pinned %s connection",async protocol=>{
    process.env[baseKey]="medium";process.env[judgeKey]="high";
    const payload={evidence:"UNCHANGED_INPUT"},before=JSON.stringify(payload);let expected:AiOperation="plan";
    const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body)),effort=judged.includes(expected)?"high":"medium";
      expect(protocol==="responses"?body.reasoning:body.reasoning_effort).toEqual(protocol==="responses"?{effort}:effort);
      expect(JSON.parse(protocol==="responses"?body.input[1].content[0].text:body.messages[1].content)).toEqual(payload);
      throw Object.assign(Error("WIRE_CAPTURE_ONLY"),{code:"WIRE_CAPTURE_ONLY"});
    });vi.stubGlobal("fetch",fetch);
    await withExplicitServerAiConnection({...input,protocol},async()=>{
      process.env[baseKey]="low";process.env[judgeKey]="max";
      for(const operation of [...generated,...judged]){
        expected=operation;await expect(runServerAi(operation,payload)).rejects.toThrow("WIRE_CAPTURE_ONLY");
        expect(await resolveServerAiConfig()).toMatchObject({reasoningEffort:"medium",judgeReasoningEffort:"high"});
      }
    });
    expect(fetch).toHaveBeenCalledTimes(10);expect(JSON.stringify(payload)).toBe(before);
  });
  it("preserves omitted reasoning fields when neither setting is configured",async()=>{
    const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));expect(body).not.toHaveProperty("reasoning_effort");expect(body).not.toHaveProperty("reasoning");
      throw Object.assign(Error("WIRE_CAPTURE_ONLY"),{code:"WIRE_CAPTURE_ONLY"});
    });vi.stubGlobal("fetch",fetch);
    await expect(withExplicitServerAiConnection(input,()=>runServerAi("evaluate",{}))).rejects.toThrow("WIRE_CAPTURE_ONLY");expect(fetch).toHaveBeenCalledOnce();
  });
  it("binds scoring identity to effective evaluator effort rather than the generator's override source",async()=>{
    const fingerprint=()=>withExplicitServerAiConnection(input,()=>serverAiScoringRouteFingerprint());
    process.env[baseKey]="medium";const medium=await fingerprint();
    process.env[judgeKey]="high";const high=await fingerprint();expect(high).not.toBe(medium);
    process.env[baseKey]="max";expect(await fingerprint()).toBe(high);
    process.env[judgeKey]="xhigh";expect(await fingerprint()).not.toBe(high);
    delete process.env[judgeKey];process.env[baseKey]="medium";expect(await fingerprint()).toBe(medium);
  });
  it("validates environment-only overrides and rejects invalid values and unsupported Gateway use before provider I/O",async()=>{
    const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    process.env.EVOLUTION_AI_API_KEY=input.apiKey;process.env.EVOLUTION_AI_MODEL=input.model;process.env[baseKey]="medium";process.env[judgeKey]="high";
    expect(getServerAiConfig()).toMatchObject({reasoningEffort:"medium",judgeReasoningEffort:"high"});
    process.env[judgeKey]="automatic";expect(()=>getServerAiConfig()).toThrow();
    await expect(Promise.resolve().then(()=>withExplicitServerAiConnection(input,()=>runServerAi("evaluate",{})))).rejects.toThrow();
    delete process.env.EVOLUTION_AI_API_KEY;delete process.env.EVOLUTION_AI_MODEL;delete process.env[baseKey];process.env[judgeKey]="high";process.env.VERCEL="1";process.env.EVOLUTION_AI_GATEWAY_ENABLED="true";
    expect(()=>getServerAiConfig()).toThrow(/仅适用于直接模型连接/);expect(fetch).not.toHaveBeenCalled();
  });
  it("records the effective wire effort in the physical usage identity while leaving the pinned generator configuration unchanged",async()=>{
    process.env[baseKey]="medium";process.env[judgeKey]="high";const records:AiUsageLedgerRecord[]=[];
    const result={scores:{usability:90,aesthetics:90,responsiveness:90,interaction:90},summary:"Observed",findings:["observed layout"]};
    vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{
      expect(JSON.parse(String(init?.body)).reasoning_effort).toBe("high");
      return new Response(JSON.stringify({id:"synthetic-reply",usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30},choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]}));
    }));
    await withServerAiUsageScope({missionId:"mission",jobId:"job",phase:"experiment"},()=>withExplicitServerAiConnection(input,async()=>{
      expect(await runServerAi("visual-judge",{})).toEqual(result);expect(await resolveServerAiConfig()).toMatchObject({reasoningEffort:"medium",judgeReasoningEffort:"high"});
    }),async record=>{records.push(record);});
    const starts=records.filter(r=>r.kind==="request-start");expect(starts).toHaveLength(1);
    const expected=createHash("sha256").update(JSON.stringify(["openai-compatible",input.baseUrl,input.model,"chat-completions",{reasoningEffort:"high"}])).digest("hex");
    expect(starts[0]!.request.route.routeFingerprint).toBe(expected);expect(records).toHaveLength(2);expect(JSON.stringify(records)).not.toContain(input.apiKey);
  });
  it("binds both real paired-protocol orders to the same evaluator effort and one durable attempt claim",async()=>{
    process.env[baseKey]="medium";process.env[judgeKey]="high";const fixture=pairedJudgeFixture(),claim=vi.fn(async()=>{});
    const request=serverPairedJudgeRequest(fixture.project,fixture.candidate,fixture.project.evalSuite,fixture.project.acceptanceRubric,fixture.candidateRuns,fixture.originalRuns,"visible");
    const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));expect(body.reasoning_effort).toBe("high");
      const issued=JSON.parse(body.messages[1].content),reversed=issued.requestFingerprint.endsWith(":1"),original=pairedJudgeRawEvaluation(90),candidate=pairedJudgeRawEvaluation(95);
      return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({schemaVersion:"paired-evaluation-v1",requestFingerprint:issued.requestFingerprint,versions:[{slot:"A",result:reversed?candidate:original},{slot:"B",result:reversed?original:candidate},{slot:"C",result:structuredClone(original)}]})}}]}));
    });vi.stubGlobal("fetch",fetch);
    await withExplicitServerAiConnection(input,async()=>{
      const result=await runServerPairedEvidenceJudge(request,{invoke:payload=>runServerAi("evaluate-paired",payload),routeFingerprint:serverAiScoringRouteFingerprint,claim});
      expect(result.pairedComparison!.receipt.scoringRouteFingerprint).toBe(await serverAiScoringRouteFingerprint());
      expect(result.pairedComparison!.receipt.samples.map(s=>s.order)).toEqual(["original-first","candidate-first"]);
    });expect(fetch).toHaveBeenCalledTimes(2);expect(claim).toHaveBeenCalledOnce();
  });
});
