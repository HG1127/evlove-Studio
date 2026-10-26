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
    ...input.stable.map((value,index)=>({...base,id:`s-${input.metricKey}-${index}`,arm:"stable" as const,deploymentId:"stable-deployment",value,observedAt:`2026-09-21T00:${String(index).padStart(2,"0")}:00.000Z`,observation:{schemaVersion:"outcome-observation-v1" as const,kind:"independent-task" as const,taskId:`stable-${index}`}})),
    ...input.candidate.map((value,index)=>({...base,id:`c-${input.metricKey}-${index}`,arm:"candidate" as const,deploymentId:"candidate-deployment",value,observedAt:`2026-09-21T01:${String(index).padStart(2,"0")}:00.000Z`,observation:{schemaVersion:"outcome-observation-v1" as const,kind:"independent-task" as const,taskId:`candidate-${index}`}})),
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

  it("does not report healthy while another observed metric lacks paired evidence",()=>{
    const stable=Array.from({length:30},(_,i)=>0.5+(i%3)*0.001);
    const candidate=Array.from({length:30},(_,i)=>0.6+(i%3)*0.001);
    const rows=[
      ...samples({metricKey:"conversion",kind:"business",direction:"higher",stable,candidate}),
      ...samples({metricKey:"safety",kind:"safety",direction:"lower",stable:[0,0],candidate:[0,0]}),
    ];
    const result=analyzeOutcomeSamples({missionId:"m1",candidateId:"c1",minimumSamplesPerArm:30,samples:rows});
    expect(result.metrics.find((metric)=>metric.metricKey==="conversion")?.evidenceStatus).toBe("estimated");
    expect(result.metrics.find((metric)=>metric.metricKey==="safety")?.evidenceStatus).toBe("insufficient");
    expect(result.verdict).toBe("insufficient");
  });

  it("requires configured metrics even when a scope produced no rows at all",()=>{
    const values=Array.from({length:30},(_,i)=>0.5+(i%3)*0.001);
    const result=analyzeOutcomeSamples({
      missionId:"m1",candidateId:"c1",minimumSamplesPerArm:30,
      samples:samples({metricKey:"conversion",kind:"business",direction:"higher",stable:values,candidate:values}),
      requiredMetricScopes:[{metricKey:"conversion",segment:"all"},{metricKey:"safety",segment:"all"}],
    });
    expect(result.metrics).toHaveLength(1);
    expect(result.verdict).toBe("insufficient");
    expect(result.message).toContain("safety/all: Stable 0, Candidate 0");
  });

  it("does not count manual samples as evidence from a configured telemetry source",()=>{
    const values=Array.from({length:30},()=>1);
    const result=analyzeOutcomeSamples({
      missionId:"m1",candidateId:"c1",minimumSamplesPerArm:30,
      samples:samples({metricKey:"conversion",kind:"business",direction:"higher",stable:values,candidate:values}),
      requiredMetricScopes:[{metricKey:"conversion",segment:"all",source:"outcome-telemetry:product"}],
    });
    expect(result.metrics[0]?.evidenceStatus).toBe("estimated");
    expect(result.verdict).toBe("insufficient");
    expect(result.message).toContain("conversion/all (outcome-telemetry:product): Stable 0, Candidate 0");
  });
  it("does not claim healthy when telemetry configuration is invalid",()=>{
    const values=Array.from({length:30},()=>1);
    const result=analyzeOutcomeSamples({
      missionId:"m1",candidateId:"c1",minimumSamplesPerArm:30,
      samples:samples({metricKey:"conversion",kind:"business",direction:"higher",stable:values,candidate:values}),
      telemetryConfigurationError:"source credential missing",
    });
    expect(result.verdict).toBe("insufficient");
    expect(result.message).toContain("source credential missing");
  });
  it("retains a measured regression even when another metric is incomplete",()=>{
    const stable=Array.from({length:30},(_,i)=>100+(i%3));
    const candidate=Array.from({length:30},(_,i)=>135+(i%3));
    const rows=[
      ...samples({metricKey:"latency",kind:"latency",direction:"lower",stable,candidate}),
      ...samples({metricKey:"safety",kind:"safety",direction:"lower",stable:[0],candidate:[0]}),
    ];
    const result=analyzeOutcomeSamples({missionId:"m1",candidateId:"c1",minimumSamplesPerArm:30,samples:rows});
    expect(result.verdict).toBe("regression");
    expect(result.regressions.map((item)=>item.metricKey)).toContain("latency");
  });

  it("does not call the whole metric healthy when a segment has no stable samples",()=>{
    const stable=Array.from({length:30},()=>100);
    const candidate=Array.from({length:30},()=>100);
    const rows=[
      ...samples({metricKey:"latency",kind:"latency",direction:"lower",stable,candidate}),
      ...samples({metricKey:"latency",kind:"latency",direction:"lower",stable:[],candidate:[90],segment:"vip"}).map((row)=>({...row,id:row.id+"-vip"})),
    ];
    const result=analyzeOutcomeSamples({missionId:"m1",candidateId:"c1",minimumSamplesPerArm:30,samples:rows});
    expect(result.metrics.find((metric)=>metric.segment==="all")?.evidenceStatus).toBe("estimated");
    expect(result.metrics.find((metric)=>metric.segment==="vip")?.evidenceStatus).toBe("insufficient");
    expect(result.verdict).toBe("insufficient");
    expect(result.message).toContain("latency/vip: Stable 0, Candidate 1");
  });
  it("does not invent an all-segment result when only a cohort was reported",()=>{
    const rows=samples({metricKey:"latency",kind:"latency",direction:"lower",stable:[100,101,99,100,101],candidate:[90,91,89,90,91],segment:"vip"});
    const result=analyzeOutcomeSamples({missionId:"m1",candidateId:"c1",minimumSamplesPerArm:5,samples:rows});
    expect(result.metrics.map((metric)=>metric.segment)).toEqual(["vip"]);
    expect(result.metrics[0]?.stable.count).toBe(5);
    expect(result.metrics[0]?.candidate.count).toBe(5);
  });

  it("does not double-count a cohort that is also represented by an all-segment sample",()=>{
    const all=samples({metricKey:"latency",kind:"latency",direction:"lower",stable:[100,101,99,100,101],candidate:[100,101,99,100,101]});
    const vip=samples({metricKey:"latency",kind:"latency",direction:"lower",stable:[80,81,79,80,81],candidate:[80,81,79,80,81],segment:"vip"})
      .map((row)=>({...row,id:row.id+"-vip"}));
    const result=analyzeOutcomeSamples({missionId:"m1",candidateId:"c1",minimumSamplesPerArm:5,samples:[...all,...vip]});
    expect(result.sampleCount).toBe(20);
    expect(result.metrics).toHaveLength(2);
    expect(result.metrics.find((metric)=>metric.segment==="all")?.stable.count).toBe(5);
    expect(result.metrics.find((metric)=>metric.segment==="all")?.candidate.count).toBe(5);
    expect(result.metrics.find((metric)=>metric.segment==="vip")?.stable.count).toBe(5);
    expect(result.metrics.find((metric)=>metric.segment==="vip")?.candidate.count).toBe(5);
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

  it("keeps missing metric evidence insufficient even when another metric drifts",()=>{
    const stable=Array.from({length:40},()=>100);
    const candidate=[...Array.from({length:20},()=>100),...Array.from({length:20},()=>130)];
    const result=analyzeOutcomeSamples({
      missionId:"m1",candidateId:"c1",minimumSamplesPerArm:20,
      samples:samples({metricKey:"conversion",kind:"business",direction:"higher",stable,candidate}),
      requiredMetricScopes:[{metricKey:"conversion",segment:"all"},{metricKey:"safety",segment:"all"}],
    });
    expect(result.drift[0]?.status).toBe("drifting");
    expect(result.regressions).toEqual([]);
    expect(result.verdict).toBe("insufficient");
    expect(result.message).toContain("safety/all: Stable 0, Candidate 0");
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

  it("filters future/invalid timestamps and cross-Candidate samples before statistics",()=>{
    const rows=samples({
      metricKey:"conversion",kind:"business",direction:"higher",
      stable:[0.2,0.2,0.2,0.2,0.2],
      candidate:[0.25,0.25,0.25,0.25,0.25],
    });
    rows.push({
      ...rows[0]!,
      id:"future-regression",
      candidateId:"c1",
      arm:"candidate",
      value:0,
      observedAt:"2026-09-21T02:10:01.000Z",
    });
    rows.push({
      ...rows[0]!,
      id:"other-candidate",
      candidateId:"c2",
      arm:"candidate",
      value:0,
      observedAt:"2026-09-21T01:10:00.000Z",
    });
    rows.push({...rows[0]!,id:"bad-time",observedAt:"not-a-date"});
    const result=analyzeOutcomeSamples({
      missionId:"m1",candidateId:"c1",minimumSamplesPerArm:5,
      checkedAt:"2026-09-21T02:08:00.000Z",
      samples:rows,
    });
    expect(result.sampleCount).toBe(10);
    expect(result.verdict).toBe("healthy");
    expect(result.message).toContain("已忽略 3 个");
  });

  it("refuses implicit cross-Candidate aggregation when candidateId is omitted",()=>{
    const rows=samples({
      metricKey:"latency",kind:"latency",direction:"lower",
      stable:[100],candidate:[90],
    });
    rows.push({...rows[0]!,id:"other",candidateId:"c2"});
    expect(()=>analyzeOutcomeSamples({
      missionId:"m1",minimumSamplesPerArm:1,samples:rows,
      checkedAt:"2026-09-22T00:00:00.000Z",
    })).toThrow(/candidateId is required/);
  });

  it("requires one distinct Deployment per arm before producing Outcome statistics",()=>{
    const values=Array.from({length:5},(_,i)=>0.5+i*0.01);
    const rows=samples({metricKey:"conversion",kind:"business",direction:"higher",stable:values,candidate:values});
    for(const sample of rows)sample.deploymentId=sample.arm==="stable"?"stable-1":"candidate-1";
    const input={missionId:"m1",candidateId:"c1",minimumSamplesPerArm:5,samples:rows};
    expect(analyzeOutcomeSamples(input).verdict).toBe("healthy");
    rows[rows.length-1]!.deploymentId="candidate-2";
    const mixed=analyzeOutcomeSamples(input);
    expect(mixed.verdict).toBe("insufficient");
    expect(mixed.metrics).toEqual([]);
    expect(mixed.message).toContain("多个 Deployment");
    rows[rows.length-1]!.deploymentId="candidate-1";
    rows[0]!.deploymentId=undefined;
    expect(analyzeOutcomeSamples(input).verdict).toBe("insufficient");
    rows[0]!.deploymentId="candidate-1";
    for(const sample of rows)sample.deploymentId="candidate-1";
    const same=analyzeOutcomeSamples(input);
    expect(same.verdict).toBe("insufficient");
    expect(same.message).toContain("同一个 Deployment");
  });
  it("refuses Stable/Candidate comparisons when a metric contract changes across stored samples",()=>{
    const rows=samples({
      metricKey:"latency",kind:"latency",direction:"lower",
      stable:[100,101,99,100,101],
      candidate:[90,91,89,90,91],
    });
    rows[rows.length-1]={...rows[rows.length-1]!,unit:"seconds"};
    rows[0]={...rows[0]!,unit:"ms"};
    expect(()=>analyzeOutcomeSamples({
      missionId:"m1",candidateId:"c1",minimumSamplesPerArm:5,
      checkedAt:"2026-09-22T00:00:00.000Z",
      samples:rows,
    })).toThrow(/inconsistent kind\/direction\/unit\/source/);
  });
});
