// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evolutionMissionWorkflow } from "../../../../workflows/evolution-mission";
const m=vi.hoisted(()=>({execute:vi.fn(),plan:vi.fn(),initialize:vi.fn(),trigger:vi.fn(),settle:vi.fn(),finalize:vi.fn(),guard:vi.fn(),sleep:vi.fn()}));
vi.mock("workflow",()=>({sleep:m.sleep}));
vi.mock("../../../../workflows/evolution-mission/steps",()=>({executeServerControlStep:m.execute,planMissionStep:m.plan,
  initializeWorkflowControlStep:m.initialize,prepareScheduledTriggerStep:m.trigger,settleScheduledManualRoundStep:m.settle,
  finalizeWorkflowResultStep:m.finalize,failLoopGuardStep:m.guard}));
const input={missionId:"synthetic-mission",controlJobId:"synthetic-job",requestedAt:"2026-10-14T05:00:00.000Z"};
const carrier={schemaVersion:"synthetic-private-carrier"}, result={...input,status:"waiting-action",iterations:3,reason:"synthetic stop"};
beforeEach(()=>{vi.resetAllMocks();m.plan.mockResolvedValue({decision:{action:"run-campaign"}});m.settle.mockResolvedValue({settled:false});});
describe("SDK workflow owns diagnostic continuation lifecycle",()=>{
  it("ignores a public carrier, carries only SDK Step output and clears absent output",async()=>{
    m.execute.mockResolvedValueOnce({control:"continue",diagnosticContinuation:carrier})
      .mockResolvedValueOnce({control:"continue"}).mockResolvedValueOnce({control:"stop",result});
    expect(await evolutionMissionWorkflow({...input,diagnosticContinuation:{forged:true}})).toEqual(result);
    expect(m.execute.mock.calls.map(call=>call[3])).toEqual([undefined,carrier,undefined]);
    expect(m.initialize).toHaveBeenCalledExactlyOnceWith(input);
    expect(m.execute.mock.calls.every(call=>!('diagnosticContinuation' in call[0]))).toBe(true);
  });
  it("starts a rearmed scheduled cycle without the previous cycle's carrier",async()=>{
    m.trigger.mockResolvedValue({control:"run",targetRound:1});
    m.execute.mockResolvedValueOnce({control:"continue",diagnosticContinuation:carrier}).mockResolvedValueOnce({control:"stop",result});
    m.settle.mockResolvedValueOnce({settled:true,nextScheduledFor:"2026-10-14T06:00:00.000Z",sleepMs:1});
    await evolutionMissionWorkflow({...input,scheduledFor:input.requestedAt});
    expect(m.execute.mock.calls.map(call=>call[3])).toEqual([undefined,undefined]);
    expect(m.sleep).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("does not pass a carrier from one workflow invocation into a new Run",async()=>{
    m.execute.mockResolvedValueOnce({control:"continue",diagnosticContinuation:carrier}).mockResolvedValueOnce({control:"stop",result})
      .mockResolvedValueOnce({control:"stop",result});
    await evolutionMissionWorkflow(input);await evolutionMissionWorkflow({...input,controlJobId:"new-job"});
    expect(m.execute.mock.calls.map(call=>call[3])).toEqual([undefined,carrier,undefined]);
  });
  it("carries Experiment output only through SDK steps, ignoring public input and clearing absent output",async()=>{
    const experiment={schemaVersion:"synthetic-private-experiment"};
    m.execute.mockResolvedValueOnce({control:"continue",experimentContinuation:experiment})
      .mockResolvedValueOnce({control:"continue"}).mockResolvedValueOnce({control:"stop",result});
    await evolutionMissionWorkflow({...input,experimentContinuation:{forged:true}});
    expect(m.execute.mock.calls.map(call=>call[4])).toEqual([undefined,experiment,undefined]);
    expect(m.execute.mock.calls.every(call=>!("experimentContinuation" in call[0]))).toBe(true);
  });
  it("clears the private Experiment carrier across separate Runs and scheduled cycles",async()=>{
    const experiment={schemaVersion:"synthetic-private-experiment"};
    m.trigger.mockResolvedValue({control:"run",targetRound:1});
    m.execute.mockResolvedValueOnce({control:"continue",experimentContinuation:experiment}).mockResolvedValueOnce({control:"continue"})
      .mockResolvedValueOnce({control:"stop",result}).mockResolvedValueOnce({control:"stop",result});
    m.settle.mockResolvedValueOnce({settled:true,nextScheduledFor:"2026-10-14T06:00:00.000Z",sleepMs:1});
    await evolutionMissionWorkflow({...input,scheduledFor:input.requestedAt});await evolutionMissionWorkflow({...input,controlJobId:"other"});
    expect(m.execute.mock.calls.map(call=>call[4])).toEqual([undefined,experiment,undefined,undefined]);
  });
  it("keeps the 32 control-phase budget while allowing separately bounded experiment operations",async()=>{
    const experiment={schemaVersion:"synthetic-private-experiment"};let calls=0;
    m.execute.mockImplementation(async()=>{calls++;return calls===51?{control:"stop",result}
      :calls%3?{control:"continue",experimentContinuation:experiment}:{control:"continue"};});
    expect(await evolutionMissionWorkflow(input)).toEqual(result);expect(m.execute).toHaveBeenCalledTimes(51);expect(m.guard).not.toHaveBeenCalled();
    expect(m.execute.mock.calls.map(c=>c[2])).toEqual(Array.from({length:51},(_,i)=>i));
  });
  it("stops a non-progressing private Experiment after 24 operations",async()=>{
    m.execute.mockResolvedValue({control:"continue",experimentContinuation:{schemaVersion:"synthetic-loop"}});
    m.guard.mockResolvedValue(result);m.finalize.mockImplementation(async(_input,output)=>output);
    expect(await evolutionMissionWorkflow(input)).toEqual(result);expect(m.execute).toHaveBeenCalledTimes(24);
    expect(m.guard).toHaveBeenCalledExactlyOnceWith(input,24);
  });
  it("retains the original 32-phase guard when no experiment continuation is emitted",async()=>{
    m.execute.mockResolvedValue({control:"continue"});m.guard.mockResolvedValue(result);m.finalize.mockImplementation(async(_input,output)=>output);
    await evolutionMissionWorkflow(input);expect(m.execute).toHaveBeenCalledTimes(32);expect(m.guard).toHaveBeenCalledExactlyOnceWith(input,32);
  });
});
