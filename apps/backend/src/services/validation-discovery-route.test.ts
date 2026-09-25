// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";

const {discover,requirePermission}=vi.hoisted(()=>(
  {discover:vi.fn(),requirePermission:vi.fn()}
));
vi.mock("nitro/h3",()=>(
  {
    defineEventHandler:(handler:unknown)=>handler,
    getQuery:(event:{query?:Record<string,unknown>})=>event.query??{},
    createError:(input:{statusCode:number;statusMessage:string})=>Object.assign(new Error(input.statusMessage),input),
  }
));
vi.mock("./validation-discovery",()=>({discoverValidations:discover}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:requirePermission}));

import handler from "../../server/api/evolution/validation.get";

describe("Validation discovery route",()=>{
  beforeEach(()=>{
    discover.mockReset();requirePermission.mockReset();requirePermission.mockResolvedValue(undefined);
  });

  it("requires read permission and returns a bounded Mission scan",async()=>{
    const page={scanned:0,validations:[]};
    discover.mockResolvedValue(page);
    const event={query:{missionId:"mission-1",artifactId:"artifact-1",afterId:"event-1",limit:"25"}};
    await expect(handler(event as never)).resolves.toEqual(page);
    expect(requirePermission).toHaveBeenCalledWith(event,"data.read");
    expect(discover).toHaveBeenCalledWith({missionId:"mission-1",artifactId:"artifact-1",afterId:"event-1",limit:25});
  });

  it("rejects missing Mission, unsupported filters, and unbounded limits",async()=>{
    await expect(handler({query:{}} as never)).rejects.toMatchObject({statusCode:400});
    await expect(handler({query:{missionId:"mission-1",limit:"51"}} as never)).rejects.toMatchObject({statusCode:400});
    await expect(handler({query:{missionId:"mission-1",status:"passed"}} as never)).rejects.toMatchObject({statusCode:400});
    expect(discover).not.toHaveBeenCalled();
  });

  it("checks permission before reading the Mission scan",async()=>{
    requirePermission.mockRejectedValue(new Error("denied"));
    await expect(handler({query:{missionId:"mission-1"}} as never)).rejects.toThrow("denied");
    expect(discover).not.toHaveBeenCalled();
  });
});
