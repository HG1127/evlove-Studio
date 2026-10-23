import {describe,expect,it} from "vitest";
import {CandidateSchema} from "@evolution/contracts";
import {acceptedPackageFixture} from "@evolution/testkit";
import {checkpointCandidateBuild} from "./candidate-build-checkpoint";
const candidate=CandidateSchema.parse({id:"C1",name:"Plan",change:"Clarify",patches:[]});
const project={...acceptedPackageFixture().project,candidates:[candidate]};
describe("Candidate build checkpoint identity",()=>{
  it("preserves the completed build without changing plan or evaluation state",()=>{
    const built={...candidate,artifactBuildStatus:"failed" as const,artifactBuildSummary:"Provider timeout"};
    const next=checkpointCandidateBuild(project,project,built);
    expect(next.candidates[0]?.artifactBuildSummary).toBe("Provider timeout");
    expect(next.experimentRun).toBe(project.experimentRun);
    expect(next.candidates[0]?.patches).toBe(candidate.patches);
  });
  it.each(["version","goal","evolutionCommand"] as const)("refuses a build after %s changes",key=>{
    expect(()=>checkpointCandidateBuild({...project,[key]:"different"},project,candidate)).toThrow("已改变");
  });
  it("does not overwrite a changed Candidate plan",()=>{
    const changed=CandidateSchema.parse({...candidate,patches:[{id:"p",operation:"add",component:"prompt",target:"New",content:"New",rationale:"Changed"}]});
    expect(()=>checkpointCandidateBuild({...project,candidates:[changed]},project,candidate)).toThrow("已改变");
  });
});
