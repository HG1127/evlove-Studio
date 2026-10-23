import {describe,expect,it} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {assertClientMissionMutationSafe} from "./mission-mutation-policy";
const proof={schemaVersion:"original-artifact-reference-v1",missionId:"m",sourceArtifactId:"s",blobId:"b",sha256:"a".repeat(64),sizeBytes:10};
const project=()=>({baselineRun:{originalReferences:[proof],referenceOnlyCriterionIds:["PROTECT"]},validationRun:{},candidates:[],gates:[],release:{}} as unknown as EvolveProject);
describe("server-owned Original reference facts",()=>{
 it.each(["originalReferences","referenceOnlyCriterionIds"] as const)("refuses minting, changing or removing %s through generic Mission PUT",field=>{
  const current=project(),removed=structuredClone(current);delete removed.baselineRun[field];
  expect(()=>assertClientMissionMutationSafe(current,removed)).toThrow("server-owned");
  expect(()=>assertClientMissionMutationSafe(removed,current)).toThrow("server-owned");
 });
 it("allows ordinary control changes while reference facts stay exact",()=>{
  const current=project(),next=structuredClone(current);next.name="resumed";
  expect(()=>assertClientMissionMutationSafe(current,next)).not.toThrow();
 });
 it("allows a fresh empty Baseline reset without carrying or issuing reference facts",()=>{
  const current=project(),next=structuredClone(current);
  current.baselineRun.id="measured";
  next.baselineRun={id:"fresh",status:"idle",suiteName:"Core",totalCases:0,runs:[]};
  expect(()=>assertClientMissionMutationSafe(current,next)).not.toThrow();
  next.baselineRun.id="measured";
  expect(()=>assertClientMissionMutationSafe(current,next)).toThrow("server-owned");
  next.baselineRun.id="fresh";next.baselineRun.status="completed";
  expect(()=>assertClientMissionMutationSafe(current,next)).toThrow("server-owned");
  next.baselineRun.status="idle";next.baselineRun.startedAt="2026-10-23T00:00:00.000Z";
  expect(()=>assertClientMissionMutationSafe(current,next)).toThrow("server-owned");
 });
});
