// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/events-evidence-reconcile.post";

const {permission,reconcile}=vi.hoisted(()=>({permission:vi.fn(),reconcile:vi.fn()}));
const originalMode=process.env.EVOLUTION_EXPERIMENT_MODE;
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:permission}));
vi.mock("./event-evidence-reconciliation",()=>({reconcileEventEvidence:reconcile}));

function request(body:unknown){
  return mockEvent(new Request("http://localhost/api/evolution/events-evidence-reconcile",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
  }));
}

afterEach(()=>{
  permission.mockReset();reconcile.mockReset();
  if(originalMode===undefined)delete process.env.EVOLUTION_EXPERIMENT_MODE;
  else process.env.EVOLUTION_EXPERIMENT_MODE=originalMode;
});

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

  it("allows isolated Lab read-only preview without an additional admin permission",async()=>{
    process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
    reconcile.mockResolvedValue({inspected:1,missing:1,repaired:0,results:[]});
    await route(request({missionId:"deleted-mission",repair:false}));
    expect(permission).toHaveBeenCalledExactlyOnceWith(expect.anything(),"mission.execute");
    expect(reconcile).toHaveBeenCalledWith({missionId:"deleted-mission",repair:false,limit:25});
  });
  it("denies signed Lab evidence repair without security.admin before any write",async()=>{
    process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
    permission.mockImplementation(async(_e:unknown,name:string)=>{
      if(name==="security.admin")throw new Error("synthetic admin forbidden");
    });
    await expect(route(request({missionId:"deleted-mission",repair:true})))
      .rejects.toThrow("synthetic admin forbidden");
    expect(permission).toHaveBeenNthCalledWith(1,expect.anything(),"mission.execute");
    expect(permission).toHaveBeenNthCalledWith(2,expect.anything(),"security.admin");
    expect(reconcile).not.toHaveBeenCalled();
  });
  it("allows authorized isolated Lab MissionDeleted mirror repair without a parent Mission",async()=>{
    process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
    reconcile.mockResolvedValue({inspected:1,repaired:1,failed:0,results:[]});
    await route(request({missionId:"deleted-mission",limit:1,repair:true}));
    expect(permission).toHaveBeenCalledTimes(2);
    expect(permission).toHaveBeenNthCalledWith(2,expect.anything(),"security.admin");
    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith({missionId:"deleted-mission",limit:1,repair:true});
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
