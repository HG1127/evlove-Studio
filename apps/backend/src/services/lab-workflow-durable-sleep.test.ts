// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {evolutionMissionWorkflow} from "../../../../workflows/evolution-mission";

const mocks=vi.hoisted(()=>({
  sleep:vi.fn(async(ms:number)=>{void ms;}),
  initialize:vi.fn(async()=>undefined),
  inspect:vi.fn(),
  stop:vi.fn(async()=>({missionId:"mission",controlJobId:"job",status:"blocked" as const,iterations:1,reason:"LAB_EXPERIMENT_DEADLINE_EXPIRED"})),
  plan:vi.fn(async()=>({})),
  execute:vi.fn(async():Promise<
    |{control:"continue";sleepMs:number}
    |{control:"stop";result:{missionId:string;controlJobId:string;status:"completed";iterations:number}}
  >=>({control:"continue",sleepMs:60*60*1000})),
  finalize:vi.fn(async(_input:unknown,result:unknown)=>result),
  unexpected:vi.fn(async()=>({missionId:"mission",controlJobId:"job",status:"failed" as const,iterations:1})),
  loopGuard:vi.fn(),
}));
vi.mock("workflow",()=>({sleep:mocks.sleep}));
vi.mock("../../../../workflows/evolution-mission/steps",()=>({
  initializeWorkflowControlStep:mocks.initialize,
  inspectLabWorkflowDeadlineStep:mocks.inspect,
  stopExpiredLabWorkflowStep:mocks.stop,
  planMissionStep:mocks.plan,
  executeServerControlStep:mocks.execute,
  finalizeWorkflowResultStep:mocks.finalize,
  finalizeUnexpectedWorkflowFailureStep:mocks.unexpected,
  failLoopGuardStep:mocks.loopGuard,
  prepareScheduledTriggerStep:vi.fn(),
  settleScheduledManualRoundStep:vi.fn(),
}));
afterEach(()=>vi.clearAllMocks());
const input={missionId:"mission",controlJobId:"job",requestedAt:"2026-11-12T01:00:00.000Z",
  labExperiment:{schemaVersion:"lab-synthetic-experiment-v2",missionId:"mission",approvedActorId:"admin",
    approvedAt:"2026-11-12T01:00:00.000Z",deadlineAt:"2026-11-12T01:20:00.000Z",
    maxCalls:6,maxTokens:300_000}};
describe("P3-K durable orchestration expiration around sleep",()=>{
  it("sleeps only until deadline, rechecks after wake, and never plans another Job action",async()=>{
    mocks.inspect.mockResolvedValueOnce({kind:"continue",remainingMs:1200000,sleepMs:0})
      .mockResolvedValueOnce({kind:"continue",remainingMs:1200000,sleepMs:0})
      .mockResolvedValueOnce({kind:"continue",remainingMs:1200000,sleepMs:1200000})
      .mockResolvedValueOnce({kind:"stop",reason:"deadline",remainingMs:0,sleepMs:0});
    const result=await evolutionMissionWorkflow(input);
    expect(result).toMatchObject({status:"blocked",reason:"LAB_EXPERIMENT_DEADLINE_EXPIRED"});
    expect(mocks.sleep).toHaveBeenCalledExactlyOnceWith(1200000);
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.plan).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("closes an already-expired Lab Workflow before planning or sleeping",async()=>{
    mocks.inspect.mockResolvedValueOnce({kind:"stop",reason:"deadline",remainingMs:0,sleepMs:0});
    const result=await evolutionMissionWorkflow(input);
    expect(result.status).toBe("blocked");
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.sleep).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
  it("preserves the legacy non-Lab durable sleep unchanged",async()=>{
    mocks.execute.mockResolvedValueOnce({control:"continue",sleepMs:1555})
      .mockResolvedValueOnce({control:"stop",result:{missionId:"mission",controlJobId:"job",status:"completed",iterations:2}});
    const result=await evolutionMissionWorkflow({missionId:"mission",controlJobId:"job",requestedAt:"2026-11-12T01:00:00.000Z"});
    expect(result.status).toBe("completed");
    expect(mocks.sleep).toHaveBeenCalledExactlyOnceWith(1555);
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });
});
