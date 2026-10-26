import {createHash} from "node:crypto";
import {z} from "zod";
import type {EvolveProject,OutcomeArm,OutcomeMetricSampleInput} from "@evolution/contracts";

export type OutcomeTelemetryRecordSource={id:string;sampling:{kind:"aggregate-snapshot"}|{
  kind:"independent-task";recordsPath:string;taskIdPath:string;observedAtPath:string;deploymentIdPath:string};
  metrics:Array<Pick<OutcomeMetricSampleInput,"metricKey"|"metricKind"|"direction"|"unit"|"segment">&{path:string;scale:number}>};
export type OutcomeTelemetryRecordContext={observedAt:string;trafficPercent?:number;rollingReleaseActive?:boolean;rollingStageIndex?:number};

function pathValue(input:unknown,path:string):unknown{
  let current=input;
  for(const part of path.split(".")){
    if(!part||!current||typeof current!=="object"||!Object.hasOwn(current,part))return undefined;
    current=(current as Record<string,unknown>)[part];
  }
  return current;
}
function numericValue(value:unknown){
  if(typeof value==="number")return Number.isFinite(value)?value:undefined;
  if(typeof value==="boolean")return value?1:0;
  if(typeof value==="string"&&value.trim()){const parsed=Number(value);return Number.isFinite(parsed)?parsed:undefined;}
  return undefined;
}
const identity=z.string().trim().min(1).max(200),timestamp=z.iso.datetime({offset:true});
const recordsSchema=z.array(z.record(z.string(),z.unknown())).max(500);
const sampleId=(parts:unknown[])=>"outcome-telemetry-"+createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0,32);

export function deduplicateTelemetrySamples(samples:OutcomeMetricSampleInput[]){
  const unique=new Map<string,OutcomeMetricSampleInput>();
  for(const sample of samples){
    if(!sample.id)throw new Error("Telemetry sample requires an authoritative source identity");
    const previous=unique.get(sample.id);
    if(previous&&JSON.stringify(previous)!==JSON.stringify(sample))throw new Error("Telemetry observation identity conflicts with different content");
    unique.set(sample.id,sample);
  }
  if(unique.size>1000)throw new Error("Telemetry exceeds the complete 1000-sample ingestion boundary; no samples were truncated");
  return [...unique.values()];
}

export function buildTelemetryRecordSamples(args:{body:unknown;source:OutcomeTelemetryRecordSource;target:{arm:OutcomeArm;deploymentId:string};
  project:EvolveProject;observation:OutcomeTelemetryRecordContext}){
  const {source,target,project,observation}=args,sampling=source.sampling;
  const records=sampling.kind==="independent-task"?recordsSchema.parse(pathValue(args.body,sampling.recordsPath)):[args.body];
  const samples:OutcomeMetricSampleInput[]=[],warnings:string[]=[];
  for(const row of records){
    let taskId:string|undefined,observedAt=observation.observedAt;
    if(sampling.kind==="independent-task"){
      taskId=identity.parse(pathValue(row,sampling.taskIdPath));
      observedAt=new Date(timestamp.parse(pathValue(row,sampling.observedAtPath))).toISOString();
      if(pathValue(row,sampling.deploymentIdPath)!==target.deploymentId)throw new Error("Independent task does not match the bound deployment");
    }
    for(const metric of source.metrics){
      const value=numericValue(pathValue(row,metric.path));
      if(value===undefined){warnings.push("source "+source.id+"/"+target.arm+": metric "+metric.metricKey+"/"+metric.segment+" missing or non-numeric at "+metric.path);continue;}
      if(!Number.isFinite(value*metric.scale))throw new Error("Telemetry metric exceeds the finite numeric boundary");
      const task=taskId!==undefined;
      samples.push({id:sampleId(task?[project.id,project.release.candidateId,source.id,target.arm,target.deploymentId,metric.metricKey,metric.segment,"task",taskId]
        :[project.id,observation.observedAt,source.id,target.arm,target.deploymentId,metric.metricKey,metric.segment]),
        candidateId:project.release.candidateId,deploymentId:target.deploymentId,arm:target.arm,metricKey:metric.metricKey,
        metricKind:metric.metricKind,direction:metric.direction,value:value*metric.scale,unit:metric.unit,segment:metric.segment,
        source:"outcome-telemetry:"+source.id,observedAt,
        observation:task?{schemaVersion:"outcome-observation-v1",kind:"independent-task",taskId:taskId!}
          :{schemaVersion:"outcome-observation-v1",kind:"aggregate-snapshot"},
        metadata:task?{telemetrySourceId:source.id,deploymentId:target.deploymentId,arm:target.arm}
          :{telemetrySourceId:source.id,releaseStatus:project.release.status,trafficPercent:observation.trafficPercent??project.release.trafficPercent,
            rollingReleaseActive:observation.rollingReleaseActive??false,rollingStageIndex:observation.rollingStageIndex,deploymentId:target.deploymentId,arm:target.arm},
      });
    }
  }
  return {samples:deduplicateTelemetrySamples(samples),warnings};
}
