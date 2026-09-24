// @vitest-environment node
import {describe,expect,it} from "vitest";
import {scheduledReconciliationAuthorized,scheduledReconciliationFailureDiagnostic} from "./scheduled-job-reconciliation";
import {ActiveJobQueryError} from "./production-runtime";

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

  it("logs only classified upstream failure fields",()=>{
    expect(scheduledReconciliationFailureDiagnostic({
      data:{reason:"credential-rejected",upstreamStatus:401,token:"private-token"},
      message:"private database detail",
    })).toEqual({reason:"credential-rejected",upstreamStatus:401});
    expect(scheduledReconciliationFailureDiagnostic({data:{reason:"private-token",upstreamStatus:999}}))
      .toEqual({reason:"unclassified"});
    expect(scheduledReconciliationFailureDiagnostic({data:{reason:"credential-rejected",upstreamStatus:401,
      service:"production-runtime",token:"private-token"}}))
      .toEqual({reason:"credential-rejected",upstreamStatus:401,service:"production-runtime"});
    expect(scheduledReconciliationFailureDiagnostic(new ActiveJobQueryError("campaign",{
      data:{reason:"credential-rejected",upstreamStatus:401,service:"production-runtime",token:"private-token"},
    }))).toEqual({reason:"credential-rejected",upstreamStatus:401,service:"production-runtime",query:"campaign"});
  });
});
