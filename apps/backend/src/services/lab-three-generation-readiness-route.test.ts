// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createError,mockEvent} from "nitro/h3";
const mocks=vi.hoisted(()=>({authorize:vi.fn(),preflight:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.authorize}));
vi.mock("./lab-three-generation-readiness",()=>({inspectLabThreeGenerationReadiness:mocks.preflight}));
import route from "../../server/api/evolution/lab-three-generation-readiness.get";

const prior=process.env.EVOLUTION_EXPERIMENT_MODE;
const event=()=>mockEvent(new Request("https://studio.example/api/evolution/lab-three-generation-readiness"));
beforeEach(()=>{
  process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
  mocks.authorize.mockReset().mockResolvedValue({role:"admin"});
  mocks.preflight.mockReset().mockResolvedValue({
    mode:"read-only",status:"blocked",blockers:["LAB_EXPERIMENT_NOT_ARMED"],executionAllowed:false,
    modelCallsPerformed:false,providerQuotaChecked:false,
  });
});
afterEach(()=>{
  if(prior===undefined)delete process.env.EVOLUTION_EXPERIMENT_MODE;
  else process.env.EVOLUTION_EXPERIMENT_MODE=prior;
});
describe("P3-T admin-only zero-cost readiness HTTP route",()=>{
  it("requires security.admin before touching the data plane",async()=>{
    mocks.authorize.mockRejectedValueOnce(createError({statusCode:403}));
    await expect(route(event())).rejects.toMatchObject({status:403});
    expect(mocks.preflight).not.toHaveBeenCalled();
  });
  it("rejects non-isolated deployments before inspecting any Lab state",async()=>{
    process.env.EVOLUTION_EXPERIMENT_MODE="production";
    await expect(route(event())).rejects.toMatchObject({status:404});
    expect(mocks.preflight).not.toHaveBeenCalled();
  });
  it("reports blocked readiness without starting or arming an experiment",async()=>{
    const result=await route(event());
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(),"security.admin");
    expect(result).toMatchObject({mode:"read-only",status:"blocked",
      executionAllowed:false,modelCallsPerformed:false});
    expect(mocks.preflight).toHaveBeenCalledOnce();
  });
  it("returns a sanitized failure for unexpected internal data-plane errors",async()=>{
    mocks.preflight.mockRejectedValueOnce(new Error("SECRET_DB_ERROR"));
    const error=await route(event()).catch(e=>e);
    expect(error).toMatchObject({status:503});
    expect(JSON.stringify(error)).not.toContain("SECRET_DB_ERROR");
  });
});
