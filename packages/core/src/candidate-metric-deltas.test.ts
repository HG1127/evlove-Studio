import {describe,expect,it} from "vitest";
import {CandidateSchema} from "@evolution/contracts";
import {candidateMetricDeltas} from "./candidate-metric-deltas";
describe("measured Candidate percentages",()=>{
 it("keeps zero-cost/zero-latency comparisons finite and serializable",()=>{
  const metrics={averageCost:0,averageLatencyMs:0};const deltas=candidateMetricDeltas(metrics,metrics);
  expect(deltas).toEqual({costDelta:0,speedDelta:0,costDeltaKnown:true,speedDeltaKnown:true});
  expect(CandidateSchema.parse({id:"C1",name:"C1",change:"x",...deltas}).costDelta).toBe(0);
  expect(JSON.stringify(deltas)).not.toContain("null");
 });
 it("does not invent a percentage when a zero baseline becomes positive",()=>{
  expect(candidateMetricDeltas({averageCost:0.02,averageLatencyMs:2},{averageCost:0,averageLatencyMs:0}))
   .toEqual({costDelta:0,speedDelta:0,costDeltaKnown:false,speedDeltaKnown:false});
 });
 it("preserves cost increases and speed improvements against the selected comparison",()=>{
  expect(candidateMetricDeltas({averageCost:0.03,averageLatencyMs:800},{averageCost:0.02,averageLatencyMs:1000}))
   .toEqual({costDelta:50,speedDelta:20,costDeltaKnown:true,speedDeltaKnown:true});
 });
 it("rejects missing/invalid denominators and arithmetic overflow as unmeasured",()=>{
  for(const baseline of [undefined,{averageCost:NaN,averageLatencyMs:Infinity},{averageCost:Number.MIN_VALUE,averageLatencyMs:-1}]){
   const result=candidateMetricDeltas({averageCost:Number.MAX_VALUE,averageLatencyMs:1},baseline);
   expect(result).toEqual({costDelta:0,speedDelta:0,costDeltaKnown:false,speedDeltaKnown:false});
  }
 });
});
