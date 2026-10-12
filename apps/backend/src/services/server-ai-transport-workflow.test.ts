// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {EvolutionJobSchema,type EvolveProject} from "@evolution/contracts";
import type {ServerHarnessPlan} from "@evolution/harness";
import {executeServerControlStep} from "../../../../workflows/evolution-mission/steps";
import {withExplicitServerAiConnection} from "./server-ai-connection";
import {resetServerAiRuntimeProbeCache} from "./server-ai-health";

const runtime=vi.hoisted(()=>({get:vi.fn(),save:vi.fn(),jobGet:vi.fn(),put:vi.fn(),append:vi.fn()}));
vi.mock("./production-runtime",()=>({getServerProductionRuntime:()=>({
  missions:{get:runtime.get,save:runtime.save},jobs:{get:runtime.jobGet,put:runtime.put},events:{append:runtime.append},
})}));
const settings={
  connectionId:"transport-workflow",label:"Synthetic workflow",apiKey:"fictional-workflow-key",
  baseUrl:"https://synthetic.example.test/v1",model:"synthetic-workflow-model",
  protocol:"chat-completions" as const,responseFormat:"json-object" as const,
};
const at="2026-10-10T00:00:00.000Z";
const input={missionId:"transport-mission",controlJobId:"transport-control",requestedAt:at};
const plan:ServerHarnessPlan={
  decision:{action:"understand",stage:"target",reason:"Synthetic understand"},
  checkpoint:{id:"server-checkpoint-transport",stage:"target",round:1},policy:{mode:"auto"},sourceRevision:"synthetic-revision",
};
const job=EvolutionJobSchema.parse({
  schemaVersion:"job-v1",id:input.controlJobId,missionId:input.missionId,type:"campaign",status:"running",label:"Synthetic control",
  idempotencyKey:"workflow-control:"+input.controlJobId,generation:1,attempts:1,priority:70,createdAt:at,updatedAt:at,
});
const mission={
  id:input.missionId,stage:"diagnosis",evolutionCommand:"synthetic improve",goal:"synthetic goal",
  sourceArtifacts:[],inputClarifications:[],attentionRequests:[],
  campaign:{status:"running",checkpoint:{round:1,completedPhase:"diagnose",at},currentRound:0},
  candidates:[{id:"unchanged-candidate",artifactSnapshots:[{contentHash:"unchanged-synthetic-hash"}]}],
  baselineRun:{status:"completed",id:"unchanged-baseline"},validationRun:{status:"idle"},updatedAt:at,
} as unknown as EvolveProject;
const understanding={
  intentRestatement:"Synthetic readiness",implicitRequirements:[],assumptions:[],clarifications:[],acceptanceFocus:[],confidence:0.8,
};
beforeEach(()=>{
  vi.resetAllMocks();
  resetServerAiRuntimeProbeCache();
  runtime.get.mockResolvedValue(structuredClone(mission));
  runtime.jobGet.mockResolvedValue(job);
});
afterEach(()=>{vi.unstubAllGlobals();resetServerAiRuntimeProbeCache();});
function faultAfterSuccessfulProbe(failure:unknown){
  const fetchMock=vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(understanding)}}]})))
    .mockRejectedValueOnce(failure);
  vi.stubGlobal("fetch",fetchMock);
  return fetchMock;
}

describe("direct AI transport to durable checkpoint (mock storage, no model service)",()=>{
  it.each([
    new DOMException("private "+settings.apiKey,"TimeoutError"),
    new TypeError("private "+settings.apiKey,{cause:Object.assign(new Error("socket"),{code:"ECONNRESET"})}),
  ])("persists the same checkpoint, artifacts and Baseline on a typed transport outage",async failure=>{
    const fetchMock=faultAfterSuccessfulProbe(failure);
    const before=structuredClone(mission);
    const outcome=await withExplicitServerAiConnection(settings,()=>executeServerControlStep(input,plan,2));
    expect(outcome).toMatchObject({control:"stop",result:{
      status:"waiting-human",iterations:3,checkpointId:plan.checkpoint.id,
    }});
    const saved=runtime.save.mock.calls[0]?.[0];
    expect(saved.stage).toBe(mission.stage);
    expect(saved.candidates).toEqual(mission.candidates);
    expect(saved.baselineRun).toEqual(mission.baselineRun);
    expect(saved.validationRun).toEqual(mission.validationRun);
    expect(saved.campaign).toMatchObject({status:"paused",checkpoint:mission.campaign.checkpoint});
    expect(saved.attentionRequests[0]).toMatchObject({type:"capability",status:"pending"});
    expect(runtime.put).toHaveBeenCalledWith(expect.objectContaining({
      status:"waiting",generation:job.generation,checkpointId:plan.checkpoint.id,
    }));
    expect(JSON.stringify(runtime.save.mock.calls)).not.toContain(settings.apiKey);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mission).toEqual(before);
  });

  it("does not reopen a replaced control Job after the model request times out",async()=>{
    faultAfterSuccessfulProbe(new DOMException("synthetic","TimeoutError"));
    runtime.jobGet.mockResolvedValue({...job,generation:2});
    const outcome=await withExplicitServerAiConnection(settings,()=>executeServerControlStep(input,plan,0));
    expect(outcome).toMatchObject({control:"stop",result:{status:"blocked"}});
    expect(runtime.save).not.toHaveBeenCalled();
    expect(runtime.put).not.toHaveBeenCalled();
    expect(runtime.append).not.toHaveBeenCalled();
  });

  it("does not turn an unknown model exception into a persisted capability wait",async()=>{
    faultAfterSuccessfulProbe(new TypeError("synthetic programming failure"));
    await expect(withExplicitServerAiConnection(settings,()=>executeServerControlStep(input,plan,0)))
      .rejects.toThrow("synthetic programming failure");
    expect(runtime.save).not.toHaveBeenCalled();
    expect(runtime.put).not.toHaveBeenCalled();
  });
});
