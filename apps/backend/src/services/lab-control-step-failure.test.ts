// @vitest-environment node
import {describe,expect,it} from "vitest";
import {FatalError} from "workflow";
import {fatalIsolatedLabControlError} from "../../../../workflows/evolution-mission/lab-control-step-failure";

describe("P3-X isolated Lab fail-closed Workflow step retry fencing",()=>{
  it.each([
    "LAB_SUBSCRIPTION_USAGE_UNVERIFIED",
    "LAB_SUBSCRIPTION_BUDGET_REJECTED",
    "LAB_SUBSCRIPTION_DATA_PLANE_NOT_READY",
    "LAB_SUBSCRIPTION_TOKEN_OVERRUN",
    "LAB_BUDGET_ENROLLMENT_FAILED",
    "SERVER_AI_PROVIDER_TIMEOUT",
    "SERVER_AI_PROVIDER_NETWORK_ERROR",
    "AI_USAGE_START_NOT_RECORDED",
  ])("maps permanent/unknown usage %s to Workflow FatalError",code=>{
    const failure=Object.assign(new Error("provider message might contain secret-key-DO-NOT-LEAK"),{code});
    const result=fatalIsolatedLabControlError(failure);
    expect(result).toBeInstanceOf(FatalError);
    expect(result.message).toContain(code);
    expect(result.message).toContain("不会重试");
    expect(result.message).not.toContain("secret-key");
  });

  it("blocks a budget-inactive rejection without exposing raw provider/key details",()=>{
    const error=Object.assign(new Error("隔离实验订阅额度操作未获准：budget-inactive secret-key"),{
      code:"LAB_SUBSCRIPTION_BUDGET_REJECTED",reason:"budget-inactive",
    });
    expect(fatalIsolatedLabControlError(error).message).toContain("LAB_SUBSCRIPTION_BUDGET_REJECTED");
    expect(fatalIsolatedLabControlError(error).message).not.toContain("budget-inactive secret-key");
  });
  it("identifies a trusted nested timeout code and hides raw error context",()=>{
    const nested=Object.assign(new Error("raw upstream context"),{cause:Object.assign(
      new Error("private error"),{code:"SERVER_AI_PROVIDER_TIMEOUT"})});
    const result=fatalIsolatedLabControlError(nested);
    expect(result).toBeInstanceOf(FatalError);
    expect(result.message).toContain("SERVER_AI_PROVIDER_TIMEOUT");
    expect(result.message).not.toContain("private error");
  });
  it("uses an opaque code for unclassified provider errors instead of leaking content",()=>{
    const result=fatalIsolatedLabControlError(new Error("Bearer very-sensitive-api-key"));
    expect(result.message).toContain("LAB_CONTROL_STEP_FAILED");
    expect(result.message).not.toContain("Bearer");
    expect(result).toBeInstanceOf(FatalError);
  });
  it("preserves an existing FatalError identity",()=>{
    const already=new FatalError("Already terminal");
    expect(fatalIsolatedLabControlError(already)).toBe(already);
  });
});
