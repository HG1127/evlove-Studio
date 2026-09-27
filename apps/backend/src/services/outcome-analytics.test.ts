// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {OutcomeMetricSample} from "@evolution/contracts";
import {analyzeMissionOutcome} from "./outcome-analytics";

const {readSamples}=vi.hoisted(()=>({readSamples:vi.fn()}));
vi.mock("./outcome-sample-store",()=>({readOutcomeSamples:readSamples,probeOutcomeSampleStore:vi.fn()}));

const originalConfig=process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON;
const originalMinimum=process.env.EVOLUTION_OUTCOME_MIN_SAMPLES_PER_ARM;

function restore(name:string,value:string|undefined){
  if(value===undefined)delete process.env[name];
  else process.env[name]=value;
}

function measuredRows():OutcomeMetricSample[]{
  const base={workspaceId:"w1",missionId:"m1",candidateId:"c1",deploymentId:"deployment-1",
    metricKey:"conversion",metricKind:"business" as const,direction:"higher" as const,
    segment:"all",source:"product",metadata:{},observedAt:"2026-09-21T00:00:00.000Z"};
  return [
    ...Array.from({length:5},(_,i)=>({...base,id:`stable-${i}`,arm:"stable" as const,value:0.5})),
    ...Array.from({length:5},(_,i)=>({...base,id:`candidate-${i}`,arm:"candidate" as const,value:0.6})),
  ];
}

beforeEach(()=>{
  readSamples.mockReset().mockResolvedValue(measuredRows());
  process.env.EVOLUTION_OUTCOME_MIN_SAMPLES_PER_ARM="5";
});

afterEach(()=>{
  restore("EVOLUTION_OUTCOME_TELEMETRY_JSON",originalConfig);
  restore("EVOLUTION_OUTCOME_MIN_SAMPLES_PER_ARM",originalMinimum);
});

describe("Outcome Analytics configured evidence",()=>{
  it("reports a configured metric that produced no samples instead of healthy",async()=>{
    process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON=JSON.stringify([{
      id:"product",urlTemplate:"https://metrics.example.com/{deploymentId}",
      metrics:[
        {metricKey:"conversion",metricKind:"business",direction:"higher",path:"conversion"},
        {metricKey:"safety",metricKind:"safety",direction:"lower",path:"safety"},
      ],
    }]);
    const result=await analyzeMissionOutcome({missionId:"m1",candidateId:"c1"});
    expect(readSamples).toHaveBeenCalledWith({missionId:"m1",candidateId:"c1",limit:20_000,requireComplete:true});
    expect(result.verdict).toBe("insufficient");
    expect(result.message).toContain("safety/all: Stable 0, Candidate 0");
  });

  it("reports invalid telemetry configuration even when stored samples look healthy",async()=>{
    process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON="not json";
    const result=await analyzeMissionOutcome({missionId:"m1",candidateId:"c1"});
    expect(result.verdict).toBe("insufficient");
    expect(result.message).toContain("Telemetry 配置不可用");
  });
});