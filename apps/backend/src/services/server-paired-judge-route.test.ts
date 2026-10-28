// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {serverPairedJudgeRequest} from "@evolution/harness";
import {pairedJudgeFixture,pairedJudgeRawEvaluation} from "@evolution/testkit";
const spy=vi.hoisted(()=>({ai:vi.fn(),route:vi.fn(async()=>"fixed-test-route"),claim:vi.fn(async()=>{})}));
vi.mock("./ai-gateway",()=>({runServerAi:spy.ai,serverAiScoringRouteFingerprint:spy.route}));
vi.mock("./server-paired-judge-claim",()=>({reserveServerPairedJudgeAttempt:spy.claim}));
import {runServerEvidenceJudge} from "./server-evidence-judge";
beforeEach(()=>{spy.ai.mockReset();spy.route.mockClear();spy.claim.mockClear();});
describe("paired judge composition route",()=>{
  it("routes an opted-in payload to two new model contracts and never to the old single-arm invoke",async()=>{
    const x=pairedJudgeFixture(),request=serverPairedJudgeRequest(x.project,x.candidate,x.project.evalSuite,x.project.acceptanceRubric,x.candidateRuns,x.originalRuns,"visible");
    spy.ai.mockImplementation(async(operation:string,payload:{requestFingerprint:string})=>{
      expect(operation).toBe("evaluate-paired");const index=spy.ai.mock.calls.length-1,a=pairedJudgeRawEvaluation(90),b=pairedJudgeRawEvaluation(95);
      return {schemaVersion:"paired-evaluation-v1",requestFingerprint:payload.requestFingerprint,versions:[{slot:"A",result:index===0?a:b},{slot:"B",result:index===0?b:a},{slot:"C",result:structuredClone(a)}]};
    });
    const oldInvoke=vi.fn(),value=await runServerEvidenceJudge({pairedJudge:request},oldInvoke);
    expect(spy.ai).toHaveBeenCalledTimes(2);expect(spy.claim).toHaveBeenCalledTimes(1);expect(oldInvoke).not.toHaveBeenCalled();expect(value.pairedComparison?.receipt.samples).toHaveLength(2);
  });
  it("rejects malformed new requests without silently using the legacy judge",async()=>{
    const oldInvoke=vi.fn();await expect(runServerEvidenceJudge({pairedJudge:{}},oldInvoke)).rejects.toThrow();
    expect(oldInvoke).not.toHaveBeenCalled();expect(spy.ai).not.toHaveBeenCalled();
  });
});
