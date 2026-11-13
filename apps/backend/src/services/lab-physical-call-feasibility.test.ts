// @vitest-environment node
import {readFileSync} from "node:fs";
import {describe,expect,it,vi} from "vitest";
import {
  LAB_MODEL_CALL_SITES,LAB_PHYSICAL_ATTEMPT_GUARDS,assessLabPhysicalCallFeasibility,
} from "./lab-physical-call-feasibility";

describe("P3-V physical model call scenario audit, zero-provider I/O",()=>{
  it("keeps nominal six-call generation-plus-independent-judge plan at the immutable cap",()=>{
    const result=assessLabPhysicalCallFeasibility();
    expect(result).toMatchObject({
      schemaVersion:"lab-call-feasibility-v1",kind:"unbilled-scenario",
      performedProviderRequests:false,executedMission:false,maxPhysicalCalls:6,
      requestedGenerations:3,independentJudgeChecks:3,
      nominalCoreCalls:6,additionalModelCalls:0,nominalTotalCalls:6,
      remainingCalls:0,nominalOverflowCalls:0,nominalFitsWithinCap:true,
      fullLifecycleProven:false,modelCallsNotStaticallyBound:true,
      recommendation:"CORE_AT_CAP_NO_RETRY_HEADROOM",
    });
  });
  it("detects even one additional physical AI request exceeds the entire 6-call cap",()=>{
    const result=assessLabPhysicalCallFeasibility({
      requestedGenerations:3,independentJudgeChecks:3,additionalModelCalls:1,
    });
    expect(result).toMatchObject({nominalTotalCalls:7,nominalOverflowCalls:1,
      nominalFitsWithinCap:false,remainingCalls:0,
      recommendation:"BLOCK_NOMINAL_OVER_BUDGET",fullLifecycleProven:false,
    });
  });
  it("never treats a one-generation smoke as whole-workflow authorization",()=>{
    const report=assessLabPhysicalCallFeasibility({
      requestedGenerations:1,independentJudgeChecks:1,additionalModelCalls:0,
    });
    expect(report).toMatchObject({
      nominalCoreCalls:2,remainingCalls:4,
      recommendation:"CONDITIONAL_SPARE_CAPACITY_NOT_EXECUTION_APPROVAL",
      fullLifecycleProven:false,performedProviderRequests:false,
    });
  });
  it("rejects negative, unbounded, fractional, NaN and infinite scenario inputs",()=>{
    for(const count of [-1,10_001,1.2,Number.POSITIVE_INFINITY,Number.NaN]){
      expect(()=>assessLabPhysicalCallFeasibility({
        requestedGenerations:3,independentJudgeChecks:3,additionalModelCalls:count,
      })).toThrow(/bounded nonnegative integers/);
    }
  });
  it("has source-verifiable possible AI operations rather than assuming only generation and Judge",()=>{
    expect(LAB_MODEL_CALL_SITES.length).toBeGreaterThanOrEqual(17);
    const stages=new Set(LAB_MODEL_CALL_SITES.map(item=>item.phase));
    expect([...stages]).toEqual(expect.arrayContaining([
      "preparation","planning","baseline","candidate","paired-judge","holdout",
      "independent-final","post-run",
    ]));
    const cached=new Map<string,string>();
    for(const {source,expression,scope} of LAB_MODEL_CALL_SITES){
      if(!cached.has(source))cached.set(source,readFileSync(source,"utf8"));
      expect(cached.get(source),source+" missing "+expression).toContain(expression);
      expect(scope).toBe("conditional");
    }
    expect(LAB_MODEL_CALL_SITES.some(x=>x.operation==="release-review")).toBe(true);
    expect(LAB_MODEL_CALL_SITES.some(x=>x.operation==="evaluate-paired")).toBe(true);
  });
  it("verifies physical retries and correction/fallback sources without executing those paths",()=>{
    for(const {kind,source,expression} of LAB_PHYSICAL_ATTEMPT_GUARDS){
      expect(readFileSync(source,"utf8"),kind+" missing "+expression).toContain(expression);
    }
    const source=readFileSync("apps/backend/src/services/server-ai-usage.ts","utf8");
    expect(source).toContain("reserveLabAiDispatchAttempt({");
    const database=readFileSync("apps/backend/src/services/server-ai-lab-subscription-budget.ts","utf8");
    expect(database).toContain("maxCalls:z.number().int().min(1).max(6)");
    expect(database).toContain('reserve_evolution_lab_subscription_call');
  });
  it("does not silently claim deterministic operational costs or set real model budget",()=>{
    const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    try{
      const result=assessLabPhysicalCallFeasibility();
      expect(JSON.stringify(result)).not.toContain("apiKey");
      expect(result.modelCallsNotStaticallyBound).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    }finally{vi.unstubAllGlobals();}
  });
});
