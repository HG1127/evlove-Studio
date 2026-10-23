import {describe,expect,it} from "vitest";
import type {TargetRunResult} from "@evolution/contracts";
import {EvaluationResultSchema} from "@evolution/contracts";
import {measuredDocumentObservations,SERVER_MEASURED_REVIEW_VERSION} from "./server-measured-review-evidence";

function observed(id:string,body:string):TargetRunResult {
  return {testCaseId:id,output:`CURRENT CANDIDATE SNAPSHOT EVIDENCE\n\nCase ${id}\n\ncomplete text projection: ${body}`,
    verificationStatus:"verified",cost:0,latencyMs:0,
    trace:[{id:`candidate-semantic-snapshot-${id}`,stage:"semantic-evidence",status:"pass",summary:"measured document"}]};
}
describe("existing measured document review",()=>{
  it("retains a complete expanded observation beyond the old excerpt budget",()=>{
    const run=observed("LARGE","配置说明".repeat(11000)+"TAIL_EXPANDED_CONFIGURATION");
    const result=measuredDocumentObservations([run]);
    expect(result.observations[0]?.output).toBe(run.output);
    expect(result.omittedTestCaseIds).toEqual([]);
  });
  it("retains the complete measured body beyond the compact excerpt and deduplicates case wrappers",()=>{
    const body="document content ".repeat(1000)+"TAIL-ONLY-REQUIREMENT";
    const result=measuredDocumentObservations([observed("A",body),observed("B",body)]);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]!.output).toBe(observed("A",body).output);
    expect(result.observations[0]!.output).toContain("TAIL-ONLY-REQUIREMENT");
    expect(result.omittedTestCaseIds).toEqual([]);
  });
  it("does not promote partial, errored or execution-model-only claims to full document observations",()=>{
    const run=observed("A","body");
    expect(measuredDocumentObservations([
      {...run,verificationStatus:"partial"},{...run,error:"failed"},{...run,trace:[]},
      {...run,trace:[{...run.trace[0]!,id:"other-case",status:"pass"}]},
    ]).observations).toEqual([]);
  });
  it("records budget omissions without cutting a complete observation into alleged full evidence",()=>{
    const result=measuredDocumentObservations([observed("A","body".repeat(100))],100);
    expect(result.observations).toEqual([]);expect(result.omittedTestCaseIds).toEqual(["A"]);
  });
  it("accepts an existing hash-bound current document read with its original exclusions",()=>{
    const run:TargetRunResult={testCaseId:"A",verificationStatus:"verified",cost:0,latencyMs:0,artifactHash:"a".repeat(64),
      output:"COMPLETE CURRENT DOCUMENT TEXT OBSERVATION\ntext only; runtime excluded",
      trace:[{id:"current-document-text-A",stage:"current-document-text-evidence",status:"pass",summary:"read"}]};
    expect(measuredDocumentObservations([run]).observations[0]).toEqual({testCaseId:"A",artifactHash:run.artifactHash,output:run.output});
  });
  it("persists the review policy marker while retaining legacy evaluation compatibility",()=>{
    const legacy={accuracy:0,evidence:0,riskCoverage:0,completeness:0,safety:"REVIEW",averageCost:0,averageLatencyMs:0};
    expect(EvaluationResultSchema.parse(legacy).measuredReviewVersion).toBeUndefined();
    expect(EvaluationResultSchema.parse({...legacy,measuredReviewVersion:SERVER_MEASURED_REVIEW_VERSION}).measuredReviewVersion).toBe(SERVER_MEASURED_REVIEW_VERSION);
  });
});
