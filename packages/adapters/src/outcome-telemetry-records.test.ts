// @vitest-environment node
import {describe,expect,it} from "vitest";
import type {EvolveProject} from "@evolution/contracts";
import {buildTelemetryRecordSamples,deduplicateTelemetrySamples,type OutcomeTelemetryRecordSource} from "./outcome-telemetry-records";

const project={id:"mission",release:{candidateId:"candidate",status:"canary-20",trafficPercent:20}} as EvolveProject;
const source:OutcomeTelemetryRecordSource={id:"tasks",sampling:{kind:"independent-task",recordsPath:"tasks",taskIdPath:"id",observedAtPath:"at",deploymentIdPath:"deployment"},
  metrics:[{metricKey:"elapsed",metricKind:"latency",direction:"lower",path:"value",scale:1,segment:"all",unit:"ms"}]};
const row={id:"task",at:"2026-10-01T00:00:00Z",deployment:"deployment",value:100};
const observe=(body:unknown,config=source)=>buildTelemetryRecordSamples({body,source:config,project,target:{arm:"candidate",deploymentId:"deployment"},observation:{observedAt:"2026-10-01T01:00:00Z"}});

describe("external outcome record boundary",()=>{
  it("labels scalar telemetry as a snapshot and never invents a task identity",()=>{
    const result=observe({value:100},{...source,sampling:{kind:"aggregate-snapshot"}});
    expect(result.samples[0]?.observation).toEqual({schemaVersion:"outcome-observation-v1",kind:"aggregate-snapshot"});
  });
  it("does not turn missing/null metrics into zero",()=>{
    const result=observe({tasks:[{...row,value:null}]});
    expect(result.samples).toEqual([]);expect(result.warnings).toHaveLength(1);
  });
  it("refuses invalid identity, source timestamps and deployment bindings",()=>{
    for(const change of [{id:"   "},{at:"missing"},{deployment:"another"}])expect(()=>observe({tasks:[{...row,...change}]})).toThrow();
  });
  it("refuses finite-value overflow and oversized task batches without truncating",()=>{
    expect(()=>observe({tasks:[{...row,value:1e308}]},{...source,metrics:[{...source.metrics[0]!,scale:1e308}]})).toThrow("finite");
    expect(()=>observe({tasks:Array.from({length:501},(_,i)=>({...row,id:"task-"+i}))})).toThrow();
  });
  it("deduplicates exact observations and refuses changed same-ID content",()=>{
    const result=observe({tasks:[row,row]});expect(result.samples).toHaveLength(1);
    const sample=result.samples[0]!;
    expect(()=>deduplicateTelemetrySamples([sample,{...sample,value:101}])).toThrow("conflicts");
    expect(()=>deduplicateTelemetrySamples(Array.from({length:1001},(_,i)=>({...sample,id:"sample-"+i})))).toThrow("1000");
  });
});
