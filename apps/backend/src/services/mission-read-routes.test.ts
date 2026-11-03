// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import getRoute from "../../server/api/evolution/missions/[id].get";
import listRoute from "../../server/api/evolution/missions.get";
const mocks=vi.hoisted(()=>({get:vi.fn(),page:vi.fn(),list:vi.fn(),permission:vi.fn(),param:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.permission}));
vi.mock("./data-plane-guard",()=>({requireServerDataPlaneAvailable:vi.fn()}));
vi.mock("./production-runtime",()=>({getServerMissionEnvelope:mocks.get,listServerMissionEnvelopePage:mocks.page,listServerMissionEnvelopes:mocks.list}));
vi.mock("nitro/h3",async original=>({...await original<typeof import("nitro/h3")>(),getRouterParam:mocks.param}));
beforeEach(()=>{vi.resetAllMocks();mocks.param.mockReturnValue("mission/a");mocks.get.mockResolvedValue({missionId:"mission/a",revision:8});mocks.page.mockResolvedValue({items:[{missionId:"mission/a",revision:8}],nextCursor:"mission/a"});mocks.list.mockResolvedValue([{missionId:"mission/a",revision:8}]);});
describe("private Mission streaming routes",()=>{
  it("keeps the existing individual receipt JSON and authorization before streaming",async()=>{
    const event=mockEvent(new Request("https://studio.test/api/evolution/missions/mission%2Fa"));
    const response=await getRoute(event);expect(response).toBeInstanceOf(Response);expect(await response.json()).toEqual({missionId:"mission/a",revision:8});
    expect(mocks.get).toHaveBeenCalledWith("mission/a");expect(mocks.permission).toHaveBeenCalledWith(event,"data.read");
    expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(mocks.get.mock.invocationCallOrder[0]);
  });
  it.each([true,false])("preserves list JSON and cursors (paged=%s)",async paged=>{
    const response=await listRoute(mockEvent(new Request("https://studio.test/api/evolution/missions"+(paged?"?pageLimit=1&cursor=previous":""))));
    expect(await response.json()).toEqual(paged?{items:[{missionId:"mission/a",revision:8}],nextCursor:"mission/a"}:[{missionId:"mission/a",revision:8}]);
    if(paged)expect(mocks.page).toHaveBeenCalledWith("previous",1);else expect(mocks.list).toHaveBeenCalledOnce();
  });
  it("does not stream protected data when access is denied",async()=>{
    mocks.permission.mockRejectedValue(new Error("denied"));
    const event=mockEvent(new Request("https://studio.test/api/evolution/missions"));
    await expect(getRoute(event)).rejects.toThrow("denied");await expect(listRoute(event)).rejects.toThrow("denied");
    expect(mocks.get).not.toHaveBeenCalled();expect(mocks.list).not.toHaveBeenCalled();
  });
  it("preserves not-found status rather than streaming a success",async()=>{
    mocks.get.mockResolvedValue(undefined);
    await expect(getRoute(mockEvent(new Request("https://studio.test/api/evolution/missions/missing")))).rejects.toMatchObject({statusCode:404});
  });
});
