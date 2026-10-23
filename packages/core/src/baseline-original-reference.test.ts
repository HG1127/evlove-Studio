import {describe,expect,it} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {originalBaselineReferenceCriteria} from "./baseline-original-reference";
const proof={schemaVersion:"original-artifact-reference-v1",missionId:"mission",sourceArtifactId:"source",blobId:"original",sha256:"a".repeat(64),sizeBytes:100};
function project(){return {id:"mission",stage:"baseline",campaign:{currentRound:0},candidates:[],
 sourceArtifacts:[{id:"source",role:"target",inputMode:"upload",storageRef:"original",size:100}],
 acceptanceRubric:[{id:"PROTECT",hardGate:true,protectedConstraint:true,source:"protected-item",judgeType:"pairwise",artifactIds:["source"]},
 {id:"CONTENT",hardGate:true,protectedConstraint:false,source:"user-command",judgeType:"llm",artifactIds:["source"]}]} as unknown as EvolveProject;}
describe("initial Original reference eligibility",()=>{
 it("defers only future preservation comparison after the actual Original bytes are bound",()=>{
  const p=project();expect(originalBaselineReferenceCriteria(p,[proof])).toEqual(["PROTECT"]);
  expect(p.acceptanceRubric[0]!.hardGate).toBe(true);
 });
 it.each([{missionId:"other"},{blobId:"other"},{sourceArtifactId:"other"},{sizeBytes:101},{sha256:"invalid"}])("refuses mismatched proof %j",change=>{
  expect(originalBaselineReferenceCriteria(project(),[{...proof,...change}])).toEqual([]);
 });
 it("requires exactly one valid proof per scoped Target",()=>{
  expect(originalBaselineReferenceCriteria(project(),[])).toEqual([]);
  expect(originalBaselineReferenceCriteria(project(),[proof,proof])).toEqual([]);
  const p=project();p.sourceArtifacts.push({...p.sourceArtifacts[0]!,id:"second"});p.acceptanceRubric[0]!.artifactIds=[];
  expect(originalBaselineReferenceCriteria(p,[proof])).toEqual([]);
 });
 it("locks a single-file preservation comparison without deferring user quality or multi-artifact consistency",()=>{
  const p=project();p.acceptanceRubric.push({id:"CROSS",hardGate:true,protectedConstraint:false,source:"source-understanding",
   judgeType:"pairwise",validationMethod:"cross-artifact",artifactIds:["source"]} as EvolveProject["acceptanceRubric"][number]);
  expect(originalBaselineReferenceCriteria(p,[proof])).toEqual(["PROTECT","CROSS"]);
  p.sourceArtifacts.push({...p.sourceArtifacts[0]!,id:"reference",role:"reference"} as EvolveProject["sourceArtifacts"][number]);
  expect(originalBaselineReferenceCriteria(p,[proof])).toEqual(["PROTECT"]);
 });
 it("does not apply after a Candidate exists, to a later round, or to an accepted Champion",()=>{
  const p=project();p.candidates=[{id:"C1"}] as EvolveProject["candidates"];
  expect(originalBaselineReferenceCriteria(p,[proof])).toEqual([]);
  p.candidates=[];p.campaign.currentRound=1;expect(originalBaselineReferenceCriteria(p,[proof])).toEqual([]);
  p.campaign.currentRound=0;p.searchChampion={id:"S1"} as EvolveProject["searchChampion"];
  expect(originalBaselineReferenceCriteria(p,[proof])).toEqual([]);
 });
});
