// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/jobs.get";

const mocks=vi.hoisted(()=>({list:vi.fn(),page:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./data-plane-guard",()=>({requireServerDataPlaneAvailable:vi.fn()}));
vi.mock("./production-runtime",()=>({
  getServerProductionRuntime:()=>({jobs:{list:mocks.list}}),
  listServerJobPage:mocks.page,
}));

function request(query=""){
  return mockEvent(new Request(`https://studio.example.com/api/evolution/jobs${query}`));
}

beforeEach(()=>{
  mocks.list.mockReset().mockResolvedValue([]);
  mocks.page.mockReset().mockResolvedValue({items:[],nextCursor:undefined});
});

describe("Job list Mission scope",()=>{
  it("keeps global and scoped list behavior for valid queries",async()=>{
    expect(await route(request())).toEqual([]);
    expect(mocks.list).toHaveBeenLastCalledWith(undefined);
    await route(request("?missionId=mission-1"));
    expect(mocks.list).toHaveBeenLastCalledWith("mission-1");
    await route(request("?missionId=mission-1&pageLimit=25"));
    expect(mocks.page).toHaveBeenLastCalledWith("mission-1",undefined,25);
  });

  it.each(["?missionId=","?missionId=%20%20","?missionId=one&missionId=two"])(
    "rejects malformed scope %s before any Job read",async(query)=>{
      await expect(route(request(query))).rejects.toMatchObject({statusCode:400});
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.page).not.toHaveBeenCalled();
    },
  );
});
