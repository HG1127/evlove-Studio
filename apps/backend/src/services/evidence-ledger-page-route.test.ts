// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/evidence-ledger.get";

const {permission,list}=vi.hoisted(()=>({permission:vi.fn(),list:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:permission}));
vi.mock("./evidence-ledger",()=>({listEvidenceLedger:list}));

function event(query=""){
  return mockEvent(new Request("http://localhost/api/evolution/evidence-ledger?"+(query||"missionId=mission-1")));
}

describe("Evidence Ledger page route",()=>{
  beforeEach(()=>{
    permission.mockReset().mockResolvedValue(undefined);
    list.mockReset().mockResolvedValue([{id:"evidence-1",sequence:1}]);
  });

  it("keeps the legacy response and accepts an explicit sequence cursor",async()=>{
    await expect(route(event())).resolves.toEqual({missionId:"mission-1",
      entries:[{id:"evidence-1",sequence:1}]});
    expect(list).toHaveBeenLastCalledWith("mission-1",500,0);
    await route(event("missionId=mission-1&limit=25&afterSequence=3"));
    expect(list).toHaveBeenLastCalledWith("mission-1",25,3);
    expect(permission).toHaveBeenCalledWith(expect.anything(),"data.read");
  });

  it("rejects malformed cursors before reading the Ledger",async()=>{
    for(const cursor of ["-1","1.5","Infinity","9007199254740992"]){
      await expect(route(event("missionId=mission-1&afterSequence="+cursor))).rejects.toMatchObject({status:400});
    }
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects malformed limits rather than silently changing the page size",async()=>{
    for(const limit of ["","0","-1","1.5","NaN","Infinity","2001","9007199254740992"]){
      await expect(route(event("missionId=mission-1&limit="+limit))).rejects.toMatchObject({status:400});
    }
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects ambiguous or empty Mission scope before reading the Ledger",async()=>{
    for(const query of ["missionId=","missionId=%20%20","missionId=mission-1&missionId=mission-2"]){
      await expect(route(event(query))).rejects.toMatchObject({status:400});
    }
    expect(list).not.toHaveBeenCalled();
  });
});
