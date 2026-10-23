// @vitest-environment node
import {describe,expect,it} from "vitest";
import {acceptedPackageFixture} from "@evolution/testkit";
import {parseStoredEvolveProject,parseStoredEvolveProjects} from "./stored-project-metrics";
describe("legacy invalid Candidate percentage recovery",()=>{
 it.each([NaN,Infinity,null])("recovers only derived fields (%s) without modifying evidence or file identities",(invalid)=>{
  const {project}=acceptedPackageFixture();
  const evaluation={...project.validationRun.evaluation!,averageCost:4,averageLatencyMs:10,demoJudged:true};
  project.experimentRun.candidateResults=[{candidateId:project.candidates[0]!.id,evaluation,runs:[],artifactSnapshots:[],experimentStage:"finalist"}];
  project.experimentRun.comparisonBaseline={...project.baselineRun,result:{...evaluation,averageCost:2,averageLatencyMs:20}};
  const raw={...project,candidates:project.candidates.map((candidate,index)=>index===0?{...candidate,costDelta:invalid,speedDelta:invalid}:candidate)};
  const recovered=parseStoredEvolveProject(raw);
  expect(recovered.candidates[0]).toMatchObject({costDelta:100,speedDelta:50,costDeltaKnown:true,speedDeltaKnown:true});
  expect(recovered.sourceArtifacts).toEqual(project.sourceArtifacts);
  expect(recovered.candidates[0]!.artifactSnapshots).toEqual(project.candidates[0]!.artifactSnapshots);
  expect(recovered.experimentRun).toEqual(project.experimentRun);
  expect(recovered.validationRun).toEqual(project.validationRun);
  expect(recovered.searchChampion).toEqual(project.searchChampion);
 });
 it("reads NaN converted to JSON null and keeps unavailable measurements explicit",()=>{
  const {project}=acceptedPackageFixture();project.candidates[0]!.costDelta=NaN;
  const recovered=parseStoredEvolveProjects(JSON.parse(JSON.stringify([project])));
  expect(recovered[0]!.candidates[0]).toMatchObject({costDelta:0,costDeltaKnown:false});
 });
 it("does not repair unrelated malformed data or silently coerce a string delta",()=>{
  const {project}=acceptedPackageFixture();
  expect(()=>parseStoredEvolveProject({...project,candidates:[{...project.candidates[0],costDelta:"wrong"}]})).toThrow();
  expect(()=>parseStoredEvolveProject({...project,id:null,candidates:[{...project.candidates[0],costDelta:NaN}]})).toThrow();
 });
});

it("repairs archived percentages without changing accepted files or review outcomes",()=>{
 const {project}=acceptedPackageFixture();const candidate=project.candidates[0]!;
 const legacy={...project,searchChampion:{...project.searchChampion!,candidate:{...project.searchChampion!.candidate!,costDelta:NaN}},evolutionArchive:[{id:"archive",round:1,kind:"failure",niche:"x",score:92,candidate:{...candidate,speedDelta:null},evaluation:project.validationRun.evaluation!,lineage:[],reason:"archived test",createdAt:project.updatedAt}]};
 const recovered=parseStoredEvolveProject(legacy);
 expect(recovered.searchChampion!.candidate).toMatchObject({costDelta:0,costDeltaKnown:true});
 expect(recovered.evolutionArchive[0]!.candidate).toMatchObject({speedDelta:0,speedDeltaKnown:false});
 expect(recovered.searchChampion!.candidate!.artifactSnapshots).toEqual(project.searchChampion!.candidate!.artifactSnapshots);
 expect(recovered.searchChampion!.validation).toEqual(project.searchChampion!.validation);
 expect(recovered.evolutionArchive[0]!.evaluation).toEqual(project.validationRun.evaluation);
});
