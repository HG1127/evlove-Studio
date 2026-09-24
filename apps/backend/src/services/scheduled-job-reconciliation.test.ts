// @vitest-environment node
import {describe,expect,it} from "vitest";
import {scheduledReconciliationAuthorized} from "./scheduled-job-reconciliation";

describe("scheduled Job reconciliation authorization",()=>{
  const secret="a-long-cron-secret";

  it("requires the configured bearer secret",()=>{
    expect(scheduledReconciliationAuthorized(`Bearer ${secret}`,secret)).toBe(true);
    expect(scheduledReconciliationAuthorized(`Bearer ${secret}x`,secret)).toBe(false);
    expect(scheduledReconciliationAuthorized(secret,secret)).toBe(false);
    expect(scheduledReconciliationAuthorized(undefined,secret)).toBe(false);
  });

  it("fails closed when the secret is missing or too short",()=>{
    expect(scheduledReconciliationAuthorized("Bearer abc",undefined)).toBe(false);
    expect(scheduledReconciliationAuthorized("Bearer abc","abc")).toBe(false);
  });
});
