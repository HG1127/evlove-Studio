// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {mockEvent} from "nitro/h3";
import {acceptedPackageFixture} from "@evolution/testkit";
import {AcceptanceCriterionSchema,EvolveProjectSchema} from "@evolution/contracts";

const mock=vi.hoisted(()=>({create:vi.fn()}));
vi.mock("./security-policy",()=>({requireGovernedEvolutionPermission:vi.fn(async()=>undefined)}));
vi.mock("./data-plane-guard",()=>({requireServerDataPlaneAvailable:vi.fn()}));
vi.mock("./production-runtime",()=>({createServerMissionEnvelope:mock.create}));

import route from "../../server/api/evolution/missions.post";

function project(){
  const base=acceptedPackageFixture().project;
  const criterion=AcceptanceCriterionSchema.parse({
    id:"GOAL",title:"目标文件验证",requirement:"当前文档保留核心证据",source:"user-command",
    weight:100,hardGate:true,judgeType:"llm",minScore:85,
    evidenceExpected:["同一目标文件完整回读"],artifactIds:[base.sourceArtifacts[0]!.id],
  });
  return EvolveProjectSchema.parse({...base,acceptanceRubric:[criterion]});
}
function event(payload:unknown){
  return mockEvent(new Request("http://localhost/api/evolution/missions",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload),
  }));
}

describe("create Mission Artifact binding contract",()=>{
  afterEach(()=>{mock.create.mockReset();});
  it("rejects dangling Rubric Artifact IDs before persisting the Mission",async()=>{
    const p=project();
    p.acceptanceRubric=p.acceptanceRubric.map((c,i)=>({
      ...c,artifactIds:i===0?["stale-ai-artifact"]:[],
    }));
    await expect(route(event(p))).rejects.toMatchObject({status:422,
      data:{code:"MISSION_RUBRIC_TARGET_BINDING"}});
    expect(mock.create).not.toHaveBeenCalled();
  });
  it("accepts real current Target IDs and does not require a bound ID on global rules",async()=>{
    const p=project();
    const target=p.sourceArtifacts.find(x=>x.role==="target")!;
    p.acceptanceRubric=p.acceptanceRubric.map((c,i)=>({
      ...c,artifactIds:i===0?[target.id]:[],
    }));
    mock.create.mockResolvedValue({missionId:p.id,revision:0});
    await expect(route(event(p))).resolves.toMatchObject({missionId:p.id,revision:0});
    expect(mock.create).toHaveBeenCalledTimes(1);
  });
});
