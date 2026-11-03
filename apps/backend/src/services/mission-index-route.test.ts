// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/mission-index.get";
const mocks=vi.hoisted(()=>({read:vi.fn(),permission:vi.fn(),guard:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.permission}));
vi.mock("./data-plane-guard",()=>({requireServerDataPlaneAvailable:mocks.guard}));
vi.mock("./production-runtime",()=>({getServerMissionIndex:mocks.read}));
beforeEach(()=>{vi.resetAllMocks();mocks.read.mockResolvedValue({schemaVersion:"mission-index-v1",workspaceId:"workspace",complete:true,items:[]});});
describe("Mission index route",()=>{
  it("authorizes private data before reading and forbids response caching",async()=>{
    const event=mockEvent(new Request("https://studio.test/api/evolution/mission-index"));
    expect(await route(event)).toMatchObject({complete:true});
    expect(mocks.permission).toHaveBeenCalledWith(event,"data.read");
    expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(mocks.guard.mock.invocationCallOrder[0]);
    expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[0]);
    expect(event.res.headers.get("cache-control")).toBe("no-store");
  });
  it.each(["permission","guard"] as const)("does not query when %s denies access",async boundary=>{
    mocks[boundary].mockImplementation(()=>{throw new Error("denied");});
    await expect(route(mockEvent(new Request("https://studio.test/api/evolution/mission-index")))).rejects.toThrow("denied");
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
