// @vitest-environment node
import {beforeEach,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import route from "../../server/api/evolution/mission-catalog.get";
const mocks=vi.hoisted(()=>({read:vi.fn(),permission:vi.fn(),guard:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.permission}));
vi.mock("./data-plane-guard",()=>({requireServerDataPlaneAvailable:mocks.guard}));
vi.mock("./production-runtime",()=>({getServerMissionCatalog:mocks.read}));
beforeEach(()=>{vi.resetAllMocks();mocks.read.mockResolvedValue({schemaVersion:"mission-catalog-v1",workspaceId:"w",directoryComplete:true,entries:[]});});
it("authorizes data.read before querying the private directory",async()=>{const event=mockEvent(new Request("https://studio.test/api/evolution/mission-catalog"));await route(event);expect(mocks.permission).toHaveBeenCalledWith(event,"data.read");expect(mocks.permission.mock.invocationCallOrder[0]).toBeLessThan(mocks.guard.mock.invocationCallOrder[0]);expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(mocks.read.mock.invocationCallOrder[0]);expect(event.res.headers.get("cache-control")).toBe("no-store");});
it.each(["permission","guard"] as const)("does not read data when %s rejects",async boundary=>{mocks[boundary].mockImplementation(()=>{throw new Error("denied");});await expect(route(mockEvent(new Request("https://studio.test/api/evolution/mission-catalog")))).rejects.toThrow("denied");expect(mocks.read).not.toHaveBeenCalled();});
