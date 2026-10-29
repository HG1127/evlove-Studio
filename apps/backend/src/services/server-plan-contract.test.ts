// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {CandidateSchema} from "@evolution/contracts";
import {userGoalPlanningScope,userGoalScopeContext} from "@evolution/core";
import {experimentRecoveryFixture} from "@evolution/testkit";
import {serverAiPlanningInstruction} from "./server-plan-contract";
import {runServerAi} from "./ai-gateway";
import {withExplicitServerAiConnection} from "./server-ai-connection";

const connection={connectionId:"synthetic",label:"Synthetic",apiKey:"synthetic-key",baseUrl:"https://planning.example.test/v1",model:"synthetic-model",protocol:"chat-completions" as const,responseFormat:"prompt-json" as const};
function fixture(){
  const {project:p}=experimentRecoveryFixture();p.experimentPolicy.winnerGoalScope="all-user-goals-v1";
  const first=p.acceptanceRubric[0]!;p.acceptanceRubric=[
    {...first,id:"CLOSURE",source:"user-command" as const,protectedConstraint:false,requirement:"Every chapter has connected inputs, outputs and checks"},
    {...first,id:"DETAIL",source:"user-command" as const,protectedConstraint:false,requirement:"Refine configuration across all chapters"},
    {...first,id:"UNDERSTAND",source:"user-command" as const,protectedConstraint:false,requirement:"Explain the whole workflow for beginners"},
  ];
  return {project:{sourceArtifacts:p.sourceArtifacts},selectedProblem:{id:"LOCAL",title:"One local configuration gap"},
    winnerGoalScope:userGoalScopeContext(p),planningGoalScope:userGoalPlanningScope(p)!};
}
const reply={candidates:[CandidateSchema.parse({id:"complete",name:"Complete proposal",change:"Propose source-grounded changes across the full required scope"})],recommendedCandidateIds:["complete"],summary:"Unverified proposal",experimentDesign:["Same full rubric","Same original budget"]};
afterEach(()=>vi.unstubAllGlobals());

describe("complete user-goal planning at the actual provider boundary",()=>{
  it("sends an independent whole-goal population instruction and keeps the selected problem as evidence rather than scope",async()=>{
    const bodies:unknown[]=[],fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      bodies.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify(reply)}}]}),{status:200});
    });vi.stubGlobal("fetch",fetch);
    await withExplicitServerAiConnection(connection,()=>runServerAi("plan",fixture()));
    expect(fetch).toHaveBeenCalledOnce();const wire=JSON.stringify(bodies[0]);
    expect(wire).toContain("Each Candidate must address EVERY required user criterion");
    expect(wire).toContain("Never split mandatory requirements across mutually exclusive Candidates");
    expect(wire).toContain("selected diagnosed problem supplies evidence and priority");
    for(const id of ["CLOSURE","DETAIL","UNDERSTAND","LOCAL"])expect(wire).toContain(id);
    expect(wire).not.toContain("population for the selected diagnosed problem");
  });
  it.each(["missing-goal","wrong-minimum","foreign-target","duplicate-target","unknown-version","missing-winner","null-scope"])("rejects %s without provider I/O or legacy fallback",async kind=>{
    const p=fixture();
    if(kind==="missing-goal")p.planningGoalScope.requiredCriteria.pop();
    if(kind==="wrong-minimum")p.planningGoalScope.requiredCriteria[0]!.minScore--;
    if(kind==="foreign-target")p.planningGoalScope.targetArtifactIds[0]="foreign";
    if(kind==="duplicate-target")p.planningGoalScope.targetArtifactIds.push(p.planningGoalScope.targetArtifactIds[0]!);
    const raw:unknown=kind==="unknown-version"?{...p,planningGoalScope:{...p.planningGoalScope,schemaVersion:"future-unrecognized"}}:
      kind==="missing-winner"?{...p,winnerGoalScope:undefined}:kind==="null-scope"?{...p,planningGoalScope:null}:p;
    const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    await expect(withExplicitServerAiConnection(connection,async()=>runServerAi("plan",raw))).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves an unversioned legacy input without inventing complete-goal coverage",()=>{
    const p=fixture(),legacy={...p,planningGoalScope:undefined};delete (legacy as Partial<typeof legacy>).planningGoalScope;
    expect(serverAiPlanningInstruction(legacy)).toContain("population for the selected diagnosed problem");
    expect(p.planningGoalScope.schemaVersion).toBe("user-goal-planning-scope-v1");
  });
});
