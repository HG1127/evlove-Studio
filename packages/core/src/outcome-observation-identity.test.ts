import {describe,expect,it} from "vitest";
import type {OutcomeMetricSample} from "@evolution/contracts";
import {analyzeOutcomeSamples} from "./outcome-statistics";

function repeatedAggregate():OutcomeMetricSample[]{
  return (["stable","candidate"] as const).flatMap(arm=>Array.from({length:30},(_,index)=>({
    id:`poll-${arm}-${index}`,workspaceId:"workspace",missionId:"mission",candidateId:"candidate",
    deploymentId:arm+"-deployment",arm,metricKey:"acceptance_rate",metricKind:"business" as const,
    direction:"higher" as const,value:arm==="stable"?0.5:0.8,unit:"ratio",segment:"all",
    source:"outcome-telemetry:product",observedAt:new Date(Date.UTC(2026,9,1,0,index)).toISOString(),
    metadata:{telemetrySourceId:"product"},
  })));
}
const independent=()=>repeatedAggregate().map(row=>({...row,observation:{schemaVersion:"outcome-observation-v1" as const,kind:"independent-task" as const,taskId:row.id}}));
const analyze=(samples:OutcomeMetricSample[])=>analyzeOutcomeSamples({missionId:"mission",candidateId:"candidate",samples,minimumSamplesPerArm:30});

describe("independent outcome observation identity",()=>{
  it("does not turn 30 polls of one aggregate into 30 independent tasks per arm",()=>{
    const result=analyzeOutcomeSamples({missionId:"mission",candidateId:"candidate",samples:repeatedAggregate(),minimumSamplesPerArm:30});
    expect(result.verdict).toBe("insufficient");
    expect(result.metrics.some(metric=>metric.significance==="significant-improvement")).toBe(false);
  });
  it("analyzes independently identified tasks while excluding aggregate snapshots",()=>{
    const result=analyze([...independent(),...repeatedAggregate().map(row=>({...row,observation:{schemaVersion:"outcome-observation-v1" as const,kind:"aggregate-snapshot" as const}}))]);
    expect(result).toMatchObject({verdict:"healthy",sampleCount:120,independentSampleCount:60,excludedSampleCount:60,observationConflictCount:0});
    expect(result.metrics[0]).toMatchObject({stable:{count:30},candidate:{count:30},significance:"significant-improvement"});
  });
  it("counts an exact task replay once even when the warehouse ID changes",()=>{
    const rows=independent().map(row=>({...row,observation:{...row.observation,taskId:row.arm+"-task"},observedAt:"2026-10-01T00:00:00Z"}));
    const result=analyze(rows);
    expect(result).toMatchObject({verdict:"insufficient",independentSampleCount:2,excludedSampleCount:58,observationConflictCount:0});
    expect(result.metrics[0]).toMatchObject({stable:{count:1},candidate:{count:1}});
  });
  it("rejects a task replay with changed values rather than selecting the latest result",()=>{
    const rows=independent(),changed={...rows[0]!,id:"new-warehouse-row",value:0.9};
    expect(analyze([...rows,changed])).toMatchObject({verdict:"insufficient",independentSampleCount:59,observationConflictCount:1});
  });
  it("does not treat the same task identity in both arms as independent observations",()=>{
    const rows=independent().map((row,index)=>({...row,observation:{...row.observation,taskId:"task-"+(index%30)}}));
    expect(analyze(rows)).toMatchObject({verdict:"insufficient",independentSampleCount:0,observationConflictCount:30});
  });
  it("does not qualify a task identity hidden in arbitrary metadata",()=>{
    const rows=repeatedAggregate().map(row=>({...row,metadata:{observation:{kind:"independent-task",taskId:row.id}}}));
    expect(analyze(rows)).toMatchObject({verdict:"insufficient",independentSampleCount:0});
  });
  it("excludes records from another Mission and refuses a mixed Workspace cohort",()=>{
    const rows=independent();
    expect(analyze(rows.map(row=>({...row,missionId:"other"})))).toMatchObject({verdict:"insufficient",droppedSampleCount:60});
    rows[0]!.workspaceId="another-workspace";
    expect(analyze(rows)).toMatchObject({verdict:"insufficient",metrics:[]});
  });
});
