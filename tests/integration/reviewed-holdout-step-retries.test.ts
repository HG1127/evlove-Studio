// @vitest-environment node
import {describe,expect,it} from "vitest";
import {executeReviewedHoldoutStep,acceptReviewedHoldoutStep} from "../../workflows/evolution-reviewed-holdout/steps";

describe("reviewed evaluation SDK retry policy",()=>{
  it("disables automatic retries of real judgments and Gate F writes",()=>{
    expect(executeReviewedHoldoutStep.maxRetries).toBe(0);
    expect(acceptReviewedHoldoutStep.maxRetries).toBe(0);
  });
});
