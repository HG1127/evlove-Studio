// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
import {observeServerAiResponseProvenance} from "./server-ai-response-provenance";
import {serverPairedJudgeRequest} from "@evolution/harness";
import {pairedJudgeFixture,pairedJudgeRawEvaluation} from "@evolution/testkit";
const spy=vi.hoisted(()=>({ai:vi.fn(),route:vi.fn(async()=>"fixed-test-route"),claim:vi.fn(async()=>{}),save:vi.fn(async()=>{})}));
vi.mock("./ai-gateway",()=>({runServerAi:spy.ai,serverAiScoringRouteFingerprint:spy.route}));
vi.mock("./server-paired-judge-claim",()=>({reserveServerPairedJudgeAttempt:spy.claim}));
// This test owns routing only. Durable scope/readback is exercised by the real journal integration tests.
vi.mock("./server-paired-order-journal",()=>({createProductionPairedOrderJournal:()=>({read:async()=>[],save:spy.save})}));
import {runServerEvidenceJudge} from "./server-evidence-judge";
beforeEach(()=>{spy.ai.mockReset();spy.route.mockClear();spy.claim.mockClear();spy.save.mockClear();});
describe("paired judge composition route",()=>{
  it("routes an opted-in payload to two new model contracts and never to the old single-arm invoke",async()=>{
    const x=pairedJudgeFixture(),request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
    spy.ai.mockImplementation(async(operation:string,payload:{requestFingerprint:string})=>{
      expect(operation).toBe("evaluate-paired");const index=spy.ai.mock.calls.length-1,a=pairedJudgeRawEvaluation(90),b=pairedJudgeRawEvaluation(95);
      const result={schemaVersion:"paired-evaluation-v1",requestFingerprint:payload.requestFingerprint,versions:[{slot:"A",result:index===0?a:b},{slot:"B",result:index===0?b:a},{slot:"C",result:structuredClone(a)}]};
      await observeServerAiResponseProvenance({schemaVersion:"ai-usage-request-v1",callId:randomUUID(),scope:{missionId:x.project.id,jobId:"route-fixture",phase:"experiment"},route:{operation:"evaluate-paired",model:"route-fixture",protocol:"chat-completions",routeFingerprint:"f".repeat(64)},attempt:1,granularity:"physical-http-attempt",startedAt:new Date().toISOString()},JSON.stringify({messages:[{role:"user",content:JSON.stringify(payload)}]}),JSON.stringify(result),200);
      return result;
    });
    const oldInvoke=vi.fn(),value=await runServerEvidenceJudge({pairedJudge:request},oldInvoke);
    expect(spy.ai).toHaveBeenCalledTimes(2);expect(spy.claim).toHaveBeenCalledTimes(1);expect(oldInvoke).not.toHaveBeenCalled();expect(value.pairedComparison?.receipt.samples).toHaveLength(2);
    expect(spy.save).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed new requests without silently using the legacy judge",async()=>{
    const oldInvoke=vi.fn();await expect(runServerEvidenceJudge({pairedJudge:{}},oldInvoke)).rejects.toThrow();
    expect(oldInvoke).not.toHaveBeenCalled();expect(spy.ai).not.toHaveBeenCalled();
  });
});
