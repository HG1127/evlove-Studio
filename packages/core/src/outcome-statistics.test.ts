import {describe,expect,it} from "vitest";
import type {OutcomeMetricSample} from "@evolution/contracts";
import {analyzeOutcomeSamples} from "./outcome-statistics";

function samples(input:{
  metricKey:string;
  kind:"business"|"latency"|"cost"|"safety";
  direction:"higher"|"lower";
  stable:number[];
  candidate:number[];
  segment?:string;
}):OutcomeMetricSample[]{
  const segment=input.segment??"all";
  const base={workspaceId:"w1",missionId:"m1",candidateId:"c1",metricKey:input.metricKey,metricKind:input.kind,direction:input.direction,segment,source:"test",metadata:{}};
  return [
    ...input.stable.map((value,index)=>({...base,id:`s-${input.metricKey}-${index}`,arm:"stable" as const,value,observedAt:`2026-09-21T00:${String(index).padStart(2,"0")}:00.000Z`})),
    ...input.candidate.map((value,index)=>({...base,id:`c-${input.metricKey}-${index}`,arm:"candidate" as const,value,observedAt:`2026-09-21T01:${String(index).padStart(2,"0")}:00.000Z`})),
  ];
}

describe("outcome statistics",()=>{
  it("keeps small samples explicitly insufficient",()=>{
    const result=analyzeOutcomeSamples({
      missionId:"m1",candidateId:"c1",minimumSamplesPerArm:5,
      samples:samples({metricKey:"latency",kind:"latency",direction:"lower",stable:[100,101],candidate:[90,91]}),
    });
    expect(result.verdict).toBe("insufficient");
    expect(result.metrics[0]?.significance).toBe("insufficient");
    expect(result.metrics[0]?.pValueApprox).toBeUndefined();
  });

  it("detects a significant lower-is-better regression",()=>{
    const stable=Array.from({length:30},(_,i)=>100+(i%3));
    const candidate=Array.from({length:30},(_,i)=>135+(i%3));
    const result=analyzeOutcomeSamples({
      missionId:"m1",candidateId:"c1",minimumSamplesPerArm:30,
      samples:samples({metricKey:"latency_ms",kind:"latency",direction:"lower",stable,candidate}),
    });
    expect(result.verdict).toBe("regression");
    expect(result.metrics[0]?.significance).toBe("significant-regression");
    expect(result.regressions[0]?.kind).toBe("latency");
  });

  it("detects significant business improvement without calling it regression",()=>{
    const stable=Array.from({length:30},(_,i)=>0.50+(i%3)*0.002);
    const candidate=Array.from({length:30},(_,i)=>0.65+(i%3)*0.002);
    const result=analyzeOutcomeSamples({
      missionId:"m1",candidateId:"c1",minimumSamplesPerArm:30,
      samples:samples({metricKey:"conversion",kind:"business",direction:"higher",stable,candidate}),
    });
    expect(result.verdict).toBe("healthy");
    expect(result.metrics[0]?.significance).toBe("significant-improvement");
  });

  it("flags candidate time drift separately from stable comparison",()=>{
    const stable=Array.from({length:40},()=>100);
    const candidate=[...Array.from({length:20},()=>100),...Array.from({length:20},()=>130)];
    const result=analyzeOutcomeSamples({
      missionId:"m1",candidateId:"c1",minimumSamplesPerArm:20,
      samples:samples({metricKey:"cost",kind:"cost",direction:"lower",stable,candidate}),
    });
    expect(result.drift[0]?.status).toBe("drifting");
    expect(result.verdict).toBe("regression");
  });
});
