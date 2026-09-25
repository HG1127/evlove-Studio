// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/events-evidence-reconcile.post";

const {permission,reconcile}=vi.hoisted(()=>({permission:vi.fn(),reconcile:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:permission}));
vi.mock("./event-evidence-reconciliation",()=>({reconcileEventEvidence:reconcile}));

function request(body:unknown){
  return mockEvent(new Request("http://localhost/api/evolution/events-evidence-reconcile",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
  }));
}

afterEach(()=>{permission.mockReset();reconcile.mockReset();});

describe("Event Evidence reconciliation route",()=>{
  it("requires governed execution permission before scanning",async()=>{
    permission.mockRejectedValue(new Error("unauthorized"));
    await expect(route(request({repair:false}))).rejects.toThrow("unauthorized");
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("rejects an unbounded request",async()=>{
    await expect(route(request({limit:51,repair:true}))).rejects.toMatchObject({statusCode:400});
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("passes bounded preview defaults and a repair request to the service",async()=>{
    reconcile.mockResolvedValue({inspected:0,results:[]});
    await route(request({}));
    expect(permission).toHaveBeenCalledWith(expect.anything(),"mission.execute");
    expect(reconcile).toHaveBeenCalledWith({limit:25,repair:false});
    await route(request({missionId:"mission-1",afterId:"evt-0",limit:2,repair:true}));
    expect(reconcile).toHaveBeenLastCalledWith({
      missionId:"mission-1",afterId:"evt-0",limit:2,repair:true,
    });
  });
});
