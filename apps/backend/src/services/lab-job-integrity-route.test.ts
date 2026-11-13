// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createError,mockEvent} from "nitro/h3";
const mocks=vi.hoisted(()=>({authorize:vi.fn(),scan:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.authorize}));
vi.mock("./lab-job-integrity",()=>({inspectLabJobIntegrity:mocks.scan}));
import route from "../../server/api/evolution/lab-job-integrity.get";

const prior=process.env.EVOLUTION_EXPERIMENT_MODE;
const event=()=>mockEvent(new Request("http://localhost/api/evolution/lab-job-integrity"));
beforeEach(()=>{
  process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
  mocks.authorize.mockReset().mockResolvedValue({role:"admin"});
  mocks.scan.mockReset().mockResolvedValue({status:"clear",mode:"read-only",issues:[]});
});
afterEach(()=>{
  if(prior===undefined)delete process.env.EVOLUTION_EXPERIMENT_MODE;
  else process.env.EVOLUTION_EXPERIMENT_MODE=prior;
});
describe("P3-O Lab Job integrity GET API permissions",()=>{
  it("requires security.admin before accessing the data plane",async()=>{
    mocks.authorize.mockRejectedValueOnce(createError({statusCode:403}));
    await expect(route(event())).rejects.toMatchObject({status:403});
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(),"security.admin");
    expect(mocks.scan).not.toHaveBeenCalled();
  });
  it("is unavailable outside the isolated Lab",async()=>{
    delete process.env.EVOLUTION_EXPERIMENT_MODE;
    await expect(route(event())).rejects.toMatchObject({status:404});
    expect(mocks.scan).not.toHaveBeenCalled();
  });
  it("returns only the read-only audit result without changing Job state",async()=>{
    mocks.scan.mockResolvedValueOnce({status:"blocked",mode:"read-only",issues:[
      {jobId:"old",missionId:"missing",reason:"mission-missing"},
    ]});
    const result=await route(event());
    expect(result).toMatchObject({status:"blocked",mode:"read-only",issues:[{reason:"mission-missing"}]});
    expect(mocks.scan).toHaveBeenCalledOnce();
  });
  it("does not leak upstream failure detail on errors",async()=>{
    mocks.scan.mockRejectedValueOnce(new Error("hidden internal DB address"));
    await expect(route(event())).rejects.toMatchObject({status:503});
  });
});
