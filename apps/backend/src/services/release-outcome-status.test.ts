// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {captureReleaseOutcomeTelemetry,skippedReleaseOutcomeTelemetry} from "./release-outcome-status";

afterEach(()=>vi.restoreAllMocks());

describe("Release Outcome telemetry status",()=>{
  it("reports recorded samples and warning counts",async()=>{
    await expect(captureReleaseOutcomeTelemetry(async()=>({
      recorded:true,inserted:2,reason:"ok",telemetry:{warnings:["source unavailable"]},
    }))).resolves.toEqual({status:"recorded",inserted:2,warningCount:1,reason:undefined});
  });

  it("distinguishes a valid observation without samples from a persistence failure",async()=>{
    expect(skippedReleaseOutcomeTelemetry()).toMatchObject({status:"skipped"});
    await expect(captureReleaseOutcomeTelemetry(async()=>({
      recorded:false,inserted:0,reason:"no-bound-stable-or-candidate-deployment",telemetry:{warnings:[]},
    }))).resolves.toMatchObject({status:"skipped",inserted:0,reason:"No bound Outcome samples were produced"});
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>undefined);
    await expect(captureReleaseOutcomeTelemetry(async()=>{throw new Error("private upstream detail");}))
      .resolves.toMatchObject({status:"failed",inserted:0,reason:expect.stringContaining("retry")});
    expect(warn).toHaveBeenCalledWith(expect.any(String),{errorType:"Error"});
  });
});
