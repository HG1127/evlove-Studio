// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema} from "@evolution/contracts";
import {demoProject} from "../../../../src/features/evolve/data/mock-project";
import {finalizeUnexpectedWorkflowFailureStep} from "../../../../workflows/evolution-mission/steps";

const mocks=vi.hoisted(()=>({
  missionGet:vi.fn(),missionSave:vi.fn(),jobGet:vi.fn(),jobPut:vi.fn(),eventAppend:vi.fn(),
}));
vi.mock("./production-runtime",()=>({
  getServerProductionRuntime:()=>({
    missions:{get:mocks.missionGet,save:mocks.missionSave},
    jobs:{get:mocks.jobGet,put:mocks.jobPut},
    events:{append:mocks.eventAppend},
  }),
}));
const at="2026-10-20T00:00:00.000Z";
const input={missionId:"audit-mission",controlJobId:"audit-control",requestedAt:at};
const job=EvolutionJobSchema.parse({
  schemaVersion:"job-v1",id:input.controlJobId,missionId:input.missionId,
  type:"campaign",status:"running",label:"Audit Control",
  idempotencyKey:"workflow-control:audit",generation:1,attempts:1,priority:70,
  createdAt:at,updatedAt:at,
});
beforeEach(()=>{
  vi.resetAllMocks();
  mocks.jobGet.mockResolvedValue(job);
  mocks.missionGet.mockResolvedValue({
    ...structuredClone(demoProject),id:input.missionId,stage:"diagnosis",
    campaign:{...demoProject.campaign,status:"running",checkpoint:{round:1,completedPhase:"diagnose",at}},
  });
});
describe("Durable Workflow finalizes errors after Step retry exhaustion",()=>{
  it("records a resumable paused Mission and terminal Job without destroying evidence",async()=>{
    const outcome=await finalizeUnexpectedWorkflowFailureStep(input,4);
    expect(outcome).toMatchObject({status:"failed",iterations:4});
    const saved=mocks.missionSave.mock.calls[0]![0];
    expect(saved.stage).toBe("diagnosis");
    expect(saved.sourceArtifacts).toEqual(demoProject.sourceArtifacts);
    expect(saved.campaign).toMatchObject({status:"paused",checkpoint:{round:1,completedPhase:"diagnose",at}});
    expect(saved.campaign.stopReason).toContain("[server-workflow-step-failed]");
    expect(saved.campaign.schedule.enabled).toBe(false);
    expect(mocks.jobPut).toHaveBeenCalledWith(expect.objectContaining({status:"failed",finishedAt:expect.any(String)}));
    expect(mocks.eventAppend).toHaveBeenCalledWith(expect.objectContaining({
      type:"JobFailed",jobId:input.controlJobId,missionId:input.missionId,
    }));
  });
  it("does not leave Control Job running when Mission CAS pause temporarily fails",async()=>{
    mocks.missionSave.mockRejectedValue(new Error("mission CAS conflict"));
    const errorSpy=vi.spyOn(console,"error").mockImplementation(()=>undefined);
    try{
      expect(await finalizeUnexpectedWorkflowFailureStep(input,2)).toMatchObject({status:"failed",iterations:2});
      expect(mocks.jobPut).toHaveBeenCalledWith(expect.objectContaining({status:"failed"}));
    }finally{errorSpy.mockRestore();}
  });
  it.each(["completed","failed","cancelled","partial"] as const)("never overwrites a previously terminal %s Job",async(status)=>{
    mocks.jobGet.mockResolvedValue({...job,status});
    expect(await finalizeUnexpectedWorkflowFailureStep(input,3)).toMatchObject({status:"blocked"});
    expect(mocks.missionSave).not.toHaveBeenCalled();
    expect(mocks.jobPut).not.toHaveBeenCalled();
    expect(mocks.eventAppend).not.toHaveBeenCalled();
  });
});
