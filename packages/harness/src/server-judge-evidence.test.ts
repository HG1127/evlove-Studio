import { expect, it } from "vitest";
import type { TargetRunResult } from "@evolution/contracts";
import { serverJudgeEvidence } from "./server-judge-evidence";
const run=(output:string)=>({testCaseId:"static",output,verificationStatus:"verified",trace:[],latencyMs:1,cost:0}) as TargetRunResult;
it("supplies a complete static report larger than the old 6k budget to the independent Judge",()=>{
  const text="COMPLETE HTML STATIC OBSERVATION\n"+"full document section\n".repeat(1000)+"FINAL DEFAULT VALUE";
  const view=serverJudgeEvidence(run(text),"section");
  expect(view.payload.outputChunks).toEqual([text]);expect(view.payload.outputTruncated).toBe(false);expect(view.run.verificationStatus).toBe("verified");
});
it("keeps oversized Judge evidence explicitly partial even if execution was verified",()=>{
  const view=serverJudgeEvidence(run("complete claimed\n".repeat(5000)),"claimed");
  expect(view.payload.outputTruncated).toBe(true);expect(view.payload.outputChunks[0]!.length).toBeLessThanOrEqual(64000);
  expect(view.run.verificationStatus).toBe("partial");expect(view.payload.verificationStatus).toBe("partial");
});
