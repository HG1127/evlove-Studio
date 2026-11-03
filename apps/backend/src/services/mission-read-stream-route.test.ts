// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/missions/[id]/read.get";
const mocks=vi.hoisted(()=>({read:vi.fn(),permission:vi.fn(),guard:vi.fn(),param:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.permission}));
vi.mock("./data-plane-guard",()=>({requireServerDataPlaneAvailable:mocks.guard}));
vi.mock("./production-runtime",()=>({getServerMissionEnvelope:mocks.read}));
vi.mock("nitro/h3",async original=>({...await original<typeof import("nitro/h3")>(),getRouterParam:mocks.param}));
beforeEach(()=>{vi.resetAllMocks();mocks.param.mockReturnValue("mission/a");mocks.read.mockResolvedValue(undefined);});
describe("private bounded Mission read route",()=>{
  it("authorizes before streaming and passes cancellation to the exact identity read",async()=>{
    const event=mockEvent(new Request("https://studio.test/api/evolution/missions/mission%2Fa/read"));const response=await route(event);
    expect(mocks.permission).toHaveBeenCalledWith(event,"data.read");expect(mocks.read).toHaveBeenCalledWith("mission/a",expect.any(AbortSignal));
    expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(mocks.guard.mock.invocationCallOrder[0]);expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[0]);
    expect(await response.text()).toContain('"code":"MISSION_NOT_FOUND"');
  });
  it.each(["permission","guard"] as const)("does not emit pending success when %s denies access",async boundary=>{
    mocks[boundary].mockImplementation(()=>{throw new Error("denied");});await expect(route(mockEvent(new Request("https://studio.test/api/evolution/missions/mission%2Fa/read")))).rejects.toThrow("denied");expect(mocks.read).not.toHaveBeenCalled();
  });
});
