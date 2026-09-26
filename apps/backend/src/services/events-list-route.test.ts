// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/events.get";

const mocks=vi.hoisted(()=>({list:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./data-plane-guard",()=>({requireServerDataPlaneAvailable:vi.fn()}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({events:{list:mocks.list}})}));

function request(query=""){
  return mockEvent(new Request(`https://studio.example.com/api/evolution/events${query}`));
}

beforeEach(()=>mocks.list.mockReset().mockResolvedValue([]));

describe("Event list query boundary",()=>{
  it("keeps the existing bounded default and accepts a scoped limit",async()=>{
    expect(await route(request())).toEqual([]);
    expect(mocks.list).toHaveBeenLastCalledWith(undefined,200);
    expect(await route(request("?missionId=mission-1&limit=1000"))).toEqual([]);
    expect(mocks.list).toHaveBeenLastCalledWith("mission-1",1000);
  });

  it.each([
    "?missionId=",
    "?missionId=%20%20",
    "?limit=0",
    "?limit=-1",
    "?limit=1.5",
    "?limit=NaN",
    "?limit=1001",
    "?limit=1&limit=2",
  ])("rejects malformed query %s without widening the Event read",async(query)=>{
    await expect(route(request(query))).rejects.toMatchObject({statusCode:400});
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
