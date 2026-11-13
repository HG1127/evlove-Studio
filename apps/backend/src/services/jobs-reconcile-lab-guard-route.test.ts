// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createError,mockEvent} from "nitro/h3";
const mocks=vi.hoisted(()=>({permission:vi.fn(),guard:vi.fn(),reconcile:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:mocks.permission}));
vi.mock("./lab-reconciliation-preflight",()=>({assertLabReconciliationReady:mocks.guard}));
vi.mock("./job-reconciliation",()=>({reconcileWorkflowJobs:mocks.reconcile}));
import endpoint from "../../server/api/evolution/jobs/reconcile.post";

const original=process.env.EVOLUTION_EXPERIMENT_MODE;
function event(repair:boolean,body?:Record<string,unknown>){
  return mockEvent(new Request("http://localhost/api/evolution/jobs/reconcile",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body??{repair,limit:10,minAgeSeconds:900}),
  }));
}
beforeEach(()=>{
  process.env.EVOLUTION_EXPERIMENT_MODE="isolated";
  mocks.permission.mockReset().mockResolvedValue({id:"admin-fixture",role:"admin"});
  mocks.guard.mockReset().mockResolvedValue(undefined);
  mocks.reconcile.mockReset().mockResolvedValue({repaired:0,orphaned:0});
});
afterEach(()=>{
  if(original===undefined)delete process.env.EVOLUTION_EXPERIMENT_MODE;
  else process.env.EVOLUTION_EXPERIMENT_MODE=original;
});
describe("P3-R direct Job repair requires Lab integrity and admin approval",()=>{
  it("permits read-only inspection without the mutating Lab guard",async()=>{
    await endpoint(event(false));
    expect(mocks.permission).toHaveBeenCalledExactlyOnceWith(expect.anything(),"mission.execute");
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.reconcile).toHaveBeenCalledWith({repair:false,limit:10,minAgeSeconds:900});
  });
  it("checks admin and Lab integrity before the first repair",async()=>{
    await endpoint(event(true));
    expect(mocks.permission).toHaveBeenCalledTimes(2);
    expect(mocks.permission).toHaveBeenNthCalledWith(1,expect.anything(),"mission.execute");
    expect(mocks.permission).toHaveBeenNthCalledWith(2,expect.anything(),"security.admin");
    expect(mocks.guard).toHaveBeenCalledOnce();
    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(vi.mocked(mocks.guard).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(mocks.reconcile).mock.invocationCallOrder[0]!);
  });
  it("denies missing admin permission before inventory or repairs",async()=>{
    mocks.permission.mockImplementation(async(_event:unknown,permission:string)=>{
      if(permission==="security.admin")throw createError({statusCode:403});
    });
    await expect(endpoint(event(true))).rejects.toMatchObject({status:403});
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("refuses blocked/unknown Lab inventories without repairing anything",async()=>{
    mocks.guard.mockRejectedValueOnce(new Error("synthetic isolated Mission orphan"));
    await expect(endpoint(event(true))).rejects.toMatchObject({status:503});
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("keeps non-Lab repair semantics unchanged",async()=>{
    process.env.EVOLUTION_EXPERIMENT_MODE="standard";
    await endpoint(event(true));
    expect(mocks.permission).toHaveBeenCalledOnce();
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.reconcile).toHaveBeenCalledOnce();
  });
  it("rejects invalid payloads before repair",async()=>{
    await expect(endpoint(event(true,{repair:true,limit:1000}))).rejects.toMatchObject({status:400});
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
