// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {assertLabReconciliationReady,LabReconciliationBlockedError} from "./lab-reconciliation-preflight";

const previous=process.env.EVOLUTION_EXPERIMENT_MODE;
beforeEach(()=>{process.env.EVOLUTION_EXPERIMENT_MODE="isolated";});
afterEach(()=>{
  if(previous===undefined)delete process.env.EVOLUTION_EXPERIMENT_MODE;
  else process.env.EVOLUTION_EXPERIMENT_MODE=previous;
});
describe("P3-R fail-closed isolation reconciliation preflight",()=>{
  it("accepts only an explicitly clear full Lab inventory",async()=>{
    const inspect=vi.fn(async()=>({status:"clear" as const}));
    await expect(assertLabReconciliationReady(inspect)).resolves.toBeUndefined();
    expect(inspect).toHaveBeenCalledOnce();
  });
  it.each(["blocked","unknown"] as const)("refuses %s inventories before any Job mutation",async status=>{
    const inspect=vi.fn(async()=>({status}));
    await expect(assertLabReconciliationReady(inspect)).rejects.toMatchObject({
      code:"LAB_RECONCILIATION_BLOCKED",state:status,
    } satisfies Partial<LabReconciliationBlockedError>);
    expect(inspect).toHaveBeenCalledOnce();
  });
  it("propagates a missing/unavailable data-plane probe instead of claiming safety",async()=>{
    const inspect=vi.fn(async():Promise<{status:"clear"}>=>{
      throw new Error("Synthetic upstream unavailable");
    });
    await expect(assertLabReconciliationReady(inspect))
      .rejects.toThrow("Synthetic upstream unavailable");
  });
  it("does not change normal non-Lab reconciliation",async()=>{
    process.env.EVOLUTION_EXPERIMENT_MODE="standard";
    const inspect=vi.fn(async()=>({status:"blocked" as const}));
    await expect(assertLabReconciliationReady(inspect)).resolves.toBeUndefined();
    expect(inspect).not.toHaveBeenCalled();
  });
});
