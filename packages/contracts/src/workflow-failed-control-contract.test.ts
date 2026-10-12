import {describe,expect,it} from "vitest";
import {EvolutionWorkflowStartRequestSchema} from "./workflow-contract";
const request={missionId:"mission",intent:"retry-failed-control",retryOfControlJobId:"old-job",retryOfRunId:"old-run",expectedMissionUpdatedAt:"version",idempotencyKey:"stable-key"};
describe("explicit failed control retry contract",()=>{
 it("adds a bounded explicit retry without changing normal/remeasure requests",()=>{
  expect(EvolutionWorkflowStartRequestSchema.parse(request)).toEqual(request);
  expect(EvolutionWorkflowStartRequestSchema.safeParse({missionId:"mission"}).success).toBe(true);
  expect(EvolutionWorkflowStartRequestSchema.safeParse({missionId:"mission",intent:"remeasure-current-input"}).success).toBe(true);
 });
 it.each(["retryOfControlJobId","retryOfRunId","expectedMissionUpdatedAt","idempotencyKey"])("requires retry identity %s",key=>{
  expect(EvolutionWorkflowStartRequestSchema.safeParse({...request,[key]:undefined}).success).toBe(false);
 });
 it("rejects a scheduled retry or an implicit prior identity",()=>{
  expect(EvolutionWorkflowStartRequestSchema.safeParse({...request,scheduledFor:"later"}).success).toBe(false);
  expect(EvolutionWorkflowStartRequestSchema.safeParse({...request,intent:undefined}).success).toBe(false);
  expect(EvolutionWorkflowStartRequestSchema.safeParse({...request,retryOfRunId:"x".repeat(501)}).success).toBe(false);
 });
});
