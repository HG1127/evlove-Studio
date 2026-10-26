// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {OutcomeMetricSample} from "@evolution/contracts";
import {analyzeMissionOutcome,outcomeMinimumSamplesPerArm} from "./outcome-analytics";

const {readSamples}=vi.hoisted(()=>({readSamples:vi.fn()}));
vi.mock("./outcome-sample-store",()=>({readOutcomeSamples:readSamples,probeOutcomeSampleStore:vi.fn()}));

const originalConfig=process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON;
const originalMinimum=process.env.EVOLUTION_OUTCOME_MIN_SAMPLES_PER_ARM;

function restore(name:string,value:string|undefined){
  if(value===undefined)delete process.env[name];
  else process.env[name]=value;
}

function measuredRows():OutcomeMetricSample[]{
  const base={workspaceId:"w1",missionId:"m1",candidateId:"c1",
    metricKey:"conversion",metricKind:"business" as const,direction:"higher" as const,
    segment:"all",source:"product",metadata:{},observedAt:"2026-09-21T00:00:00.000Z"};
  return [
    ...Array.from({length:5},(_,i)=>({...base,id:`stable-${i}`,arm:"stable" as const,deploymentId:"deployment-stable",value:0.5,observation:{schemaVersion:"outcome-observation-v1" as const,kind:"independent-task" as const,taskId:`stable-${i}`}})),
    ...Array.from({length:5},(_,i)=>({...base,id:`candidate-${i}`,arm:"candidate" as const,deploymentId:"deployment-candidate",value:0.6,observation:{schemaVersion:"outcome-observation-v1" as const,kind:"independent-task" as const,taskId:`candidate-${i}`}})),
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

describe("Outcome Analytics sample threshold configuration",()=>{
  it("keeps fractional and malformed values within the integer response contract",()=>{
    process.env.EVOLUTION_OUTCOME_MIN_SAMPLES_PER_ARM="7.9";
    expect(outcomeMinimumSamplesPerArm()).toBe(7);
    process.env.EVOLUTION_OUTCOME_MIN_SAMPLES_PER_ARM="Infinity";
    expect(outcomeMinimumSamplesPerArm()).toBe(30);
    process.env.EVOLUTION_OUTCOME_MIN_SAMPLES_PER_ARM="invalid";
    expect(outcomeMinimumSamplesPerArm()).toBe(30);
    process.env.EVOLUTION_OUTCOME_MIN_SAMPLES_PER_ARM="20000";
    expect(outcomeMinimumSamplesPerArm()).toBe(10_000);
  });
});

describe("Outcome Analytics configured evidence",()=>{
  it("does not accept a source name as proof when no telemetry source is configured",async()=>{
    delete process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON;
    readSamples.mockResolvedValue(measuredRows().map(row=>({...row,source:"outcome-telemetry:claimed"})));
    const result=await analyzeMissionOutcome({missionId:"m1",candidateId:"c1",telemetryOnly:true});
    expect(result).toMatchObject({verdict:"insufficient",independentSampleCount:0});
    expect(result.message).toContain("尚未配置");
  });
  it("reports a configured metric that produced no samples instead of healthy",async()=>{
    process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON=JSON.stringify([{
      id:"product",urlTemplate:"https://metrics.example.com/{deploymentId}",
      metrics:[
        {metricKey:"conversion",metricKind:"business",direction:"higher",path:"conversion"},
        {metricKey:"safety",metricKind:"safety",direction:"lower",path:"safety"},
      ],
    }]);
    readSamples.mockResolvedValue(measuredRows().map((row)=>({...row,source:"outcome-telemetry:product"})));
    const result=await analyzeMissionOutcome({missionId:"m1",candidateId:"c1"});
    expect(readSamples).toHaveBeenCalledWith({missionId:"m1",candidateId:"c1",limit:20_000,requireComplete:true});
    expect(result.verdict).toBe("insufficient");
    expect(result.message).toContain("safety/all (outcome-telemetry:product): Stable 0, Candidate 0");
  });

  it("requires samples from the configured source rather than same-named manual rows",async()=>{
    process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON=JSON.stringify([{
      id:"product",urlTemplate:"https://metrics.example.com/{deploymentId}",
      metrics:[{metricKey:"conversion",metricKind:"business",direction:"higher",path:"conversion"}],
    }]);
    const wrongSource=await analyzeMissionOutcome({missionId:"m1",candidateId:"c1"});
    expect(wrongSource.verdict).toBe("insufficient");
    expect(wrongSource.message).toContain("conversion/all (outcome-telemetry:product): Stable 0, Candidate 0");
    readSamples.mockResolvedValue(measuredRows().map((row)=>({...row,source:"outcome-telemetry:product"})));
    const correctSource=await analyzeMissionOutcome({missionId:"m1",candidateId:"c1"});
    expect(correctSource.verdict).toBe("healthy");
  });
  it("reports invalid telemetry configuration even when stored samples look healthy",async()=>{
    process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON="not json";
    const result=await analyzeMissionOutcome({missionId:"m1",candidateId:"c1"});
    expect(result.verdict).toBe("insufficient");
    expect(result.message).toContain("Telemetry 配置不可用");
  });
});
