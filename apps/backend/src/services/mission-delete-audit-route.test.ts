// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {createError,mockEvent} from "nitro/h3";

const mocks=vi.hoisted(()=>({authorize:vi.fn(),deleteMission:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.authorize}));
vi.mock("./production-runtime",()=>({
  deleteServerMissionIfRevision:mocks.deleteMission,
  MissionHasActiveJobsError:class MissionHasActiveJobsError extends Error{
    readonly code="MISSION_HAS_ACTIVE_JOBS";
    constructor(readonly missionId:string,readonly activeJobCount:number){
      super("Active child Jobs block Mission deletion");
    }
  },
  MissionRevisionConflictError:class MissionRevisionConflictError extends Error{
    readonly code="MISSION_REVISION_CONFLICT";
    readonly expectedRevision:number;
    readonly currentRevision:number;
    constructor(readonly missionId:string,expectedRevision:number,currentRevision:number){
      super("Revision conflict");
      this.expectedRevision=expectedRevision;this.currentRevision=currentRevision;
    }
  },
}));
import route from "../../server/api/evolution/missions/[id].delete";
import {MissionHasActiveJobsError,MissionRevisionConflictError} from "./production-runtime";

function event(revision="3"){
  const e=mockEvent(new Request("http://localhost/api/evolution/missions/lab-mission",{
    method:"DELETE",headers:revision===undefined?{}:{"if-match":revision},
  }));
  e.context.params={id:"lab-mission"};
  return e;
}
beforeEach(()=>{
  mocks.authorize.mockReset().mockResolvedValue({id:"operator-fixture",role:"operator"});
  mocks.deleteMission.mockReset().mockResolvedValue(undefined);
});
describe("P3-P audited Mission deletion admission",()=>{
  it("propagates the authenticated operator and the exact If-Match revision to the audited RPC",async()=>{
    const result=await route(event('"3"'));
    expect(result).toMatchObject({ok:true,missionId:"lab-mission"});
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(),"mission.write");
    expect(mocks.deleteMission).toHaveBeenCalledExactlyOnceWith("lab-mission",3,{
      id:"operator-fixture",role:"operator",
    });
  });
  it("blocks unauthorized requests before any Mission delete attempt",async()=>{
    mocks.authorize.mockRejectedValueOnce(createError({statusCode:403}));
    await expect(route(event())).rejects.toMatchObject({status:403});
    expect(mocks.deleteMission).not.toHaveBeenCalled();
  });
  it("requires an explicit valid Mission revision before deletion",async()=>{
    await expect(route(event(""))).rejects.toMatchObject({status:428});
    await expect(route(event("not-a-number"))).rejects.toMatchObject({status:400});
    await expect(route(event("-1"))).rejects.toMatchObject({status:400});
    expect(mocks.deleteMission).not.toHaveBeenCalled();
  });
  it("surfaces active Job conflicts as a non-destructive HTTP 409 with count",async()=>{
    mocks.deleteMission.mockRejectedValueOnce(new MissionHasActiveJobsError("lab-mission",2));
    await expect(route(event())).rejects.toMatchObject({
      status:409,data:{code:"MISSION_HAS_ACTIVE_JOBS",missionId:"lab-mission",activeJobCount:2},
    });
  });
  it("retains revision conflict semantics",async()=>{
    mocks.deleteMission.mockRejectedValueOnce(new MissionRevisionConflictError("lab-mission",3,4));
    await expect(route(event())).rejects.toMatchObject({
      status:409,data:{code:"MISSION_REVISION_CONFLICT",expectedRevision:3,currentRevision:4},
    });
  });
});
