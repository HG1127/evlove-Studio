import {describe,it,expect} from "vitest";
import {EvolutionJobSchema,type EvolutionJob} from "@evolution/contracts";
import {missionExecutionStatus} from "./mission-execution-state";
const input={missionId:"C44",updatedAt:"2026-10-30T02:11:11Z",campaignStatus:"running"};
const job=(status:EvolutionJob["status"],extra:Partial<EvolutionJob>={})=>EvolutionJobSchema.parse({
 schemaVersion:"job-v1",id:"control-old",missionId:"C44",type:"campaign",status,label:"Control",
 idempotencyKey:"workflow-control:C44:old",generation:1,attempts:1,priority:70,
 createdAt:"2026-10-30T02:08:04Z",updatedAt:"2026-10-30T02:30:36Z",...extra});
describe("Mission execution evidence",()=>{
 it("never treats a cached running Mission as live execution",()=>{
  expect(missionExecutionStatus(input)).toBe("unverified");
  expect(missionExecutionStatus({...input,interrupted:true})).toBe("interrupted");
  expect(missionExecutionStatus({...input,running:true})).toBe("running");
 });
 it.each(["cancelled","failed","partial","waiting"] as const)("uses a later %s Job over stale Mission/local activity",status=>{
  expect(missionExecutionStatus({...input,running:true,startedAt:"2026-10-30T02:08:21Z",jobs:[job(status)]})).toBe(status);
 });
 it("does not confuse an older failed attempt with an explicitly newer local start",()=>{
  expect(missionExecutionStatus({...input,running:true,startedAt:"2026-11-04T00:00:00Z",jobs:[job("failed")]})).toBe("running");
 });
 it("uses attempt creation order instead of a later cleanup update on an old attempt",()=>{
  const newer=job("running",{id:"control-new",createdAt:"2026-10-30T02:20:00Z",updatedAt:"2026-10-30T02:21:00Z"});
  expect(missionExecutionStatus({...input,jobs:[job("cancelled"),newer]})).toBe("unverified");
 });
 it("fails closed on foreign, unrelated, ambiguous and invalid-time receipts",()=>{
  for(const jobs of [[job("cancelled",{missionId:"other"})],[job("failed",{type:"parse"})],
   [job("cancelled",{idempotencyKey:"unrelated"})],
   [job("cancelled"),job("failed",{id:"another"})],
   [job("cancelled"),job("failed",{id:"offset",createdAt:"2026-10-30T02:08:04+00:00"})]])expect(missionExecutionStatus({...input,jobs})).toBe("unverified");
  expect(missionExecutionStatus({...input,updatedAt:"invalid",jobs:[job("cancelled")]})).toBe("unverified");
 });
 it("a completed control Job is not proof that the Mission goal is complete",()=>{
  expect(missionExecutionStatus({...input,jobs:[job("completed")]})).toBe("stopped");
 });
});
