import {describe,expect,it} from "vitest";
import {FailureObservationSourcesSchema} from "./failure-observation-contract";
import {PlanAiResultSchema} from "./ai-schemas";
describe("versioned declared failure sources",()=>{
  it("does not accept model-generated server planning provenance",()=>{
    const parsed=PlanAiResultSchema.parse({candidates:[{id:"candidate",name:"plan",change:"change",planningFailureObservationUse:{forged:true}}],recommendedCandidateIds:["candidate"],summary:"plan",experimentDesign:["compare exact files","retain independent tests"]});
    expect(parsed.candidates[0]).not.toHaveProperty("planningFailureObservationUse");
  });
  it("rejects malformed, duplicate and undeclared raw source fields",()=>{
    const r={schemaVersion:"visible-failure-source-v1",missionId:"source",missionSha256:"a".repeat(64),experimentRunId:"experiment",candidateId:"candidate",round:1};
    for(const invalid of [[r,r],[{...r,missionSha256:"short"}],[{...r,independentFinal:{}}]])expect(()=>FailureObservationSourcesSchema.parse(invalid)).toThrow();
  });
});
