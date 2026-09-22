import {createHash} from "node:crypto";
import {z} from "zod";
import {
  OutcomeMetricDirectionSchema,
  OutcomeMetricKindSchema,
  type EvolveProject,
  type OutcomeArm,
  type OutcomeMetricSampleInput,
  type VercelReleaseObservation,
} from "@evolution/contracts";

const EnvNameSchema=z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(120);
const MetricSchema=z.object({
  metricKey:z.string().min(1).max(120),
  metricKind:OutcomeMetricKindSchema,
  direction:OutcomeMetricDirectionSchema,
  path:z.string().min(1).max(300),
  unit:z.string().max(40).optional(),
  segment:z.string().min(1).max(120).default("all"),
  scale:z.number().finite().default(1),
});
const AuthSchema=z.discriminatedUnion("type",[
  z.object({type:z.literal("bearer"),env:EnvNameSchema}),
  z.object({
    type:z.literal("header"),
    env:EnvNameSchema,
    header:z.string().regex(/^[A-Za-z0-9-]+$/).max(100),
    prefix:z.string().max(100).default(""),
  }),
]);
const SourceSchema=z.object({
  id:z.string().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/),
  urlTemplate:z.string().min(1).max(2000),
  timeoutMs:z.number().int().min(500).max(60_000).default(10_000),
  arms:z.array(z.enum(["stable","candidate"])).min(1).max(2).default(["stable","candidate"]),
  auth:AuthSchema.optional(),
  metrics:z.array(MetricSchema).min(1).max(50),
});
const SourcesSchema=z.array(SourceSchema).min(1).max(20);

export type OutcomeTelemetrySource=z.infer<typeof SourceSchema>;
export type OutcomeTelemetryConfigState={
  configured:boolean;
  ready:boolean;
  sources:OutcomeTelemetrySource[];
  errors:string[];
};
export type OutcomeTelemetryCollection={
  configured:boolean;
  ready:boolean;
  sourceCount:number;
  metricCount:number;
  requestCount:number;
  samples:OutcomeMetricSampleInput[];
  warnings:string[];
};

export type OutcomeTelemetryObservationContext={
  observedAt:string;
  deploymentUrls?:Record<string,string|undefined>;
  trafficPercent?:number;
  rollingReleaseActive?:boolean;
  rollingStageIndex?:number;
};

const ALLOWED_TOKENS=new Set([
  "missionId","candidateId","deploymentId","deploymentUrl","arm","trafficPercent","releaseStatus",
]);

function configError(error:unknown){
  if(error instanceof z.ZodError){
    return error.issues.slice(0,8).map((issue)=>`${issue.path.join(".")||"root"}: ${issue.message}`);
  }
  return [error instanceof Error?error.message:String(error)];
}

function templateTokens(template:string){
  return [...template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match)=>match[1]!);
}

function validateSource(source:OutcomeTelemetrySource){
  const unknown=templateTokens(source.urlTemplate).filter((token)=>!ALLOWED_TOKENS.has(token));
  if(unknown.length)throw new Error("source "+source.id+": unknown URL template token(s): "+unknown.join(", "));
  const tokens=new Set(templateTokens(source.urlTemplate));
  if(source.arms.length>1&&!(["deploymentId","deploymentUrl","arm"] as const).some((token)=>tokens.has(token))){
    throw new Error("source "+source.id+": multi-arm telemetry requires {deploymentId}, {deploymentUrl}, or {arm} to isolate Stable/Candidate");
  }
  const probe=source.urlTemplate.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g,"probe");
  const probeUrl=new URL(probe);
  if(probeUrl.protocol!=="https:"&&probeUrl.protocol!=="http:"){
    throw new Error("source "+source.id+": telemetry URL must use http(s)");
  }
  if(source.auth&&!process.env[source.auth.env]?.trim()){
    throw new Error("source "+source.id+": credential env "+source.auth.env+" is not configured");
  }
  const duplicateMetricKeys=new Set<string>();
  for(const metric of source.metrics){
    const key=metric.metricKey+"|"+metric.segment;
    if(duplicateMetricKeys.has(key))throw new Error("source "+source.id+": duplicate metric/segment "+key);
    duplicateMetricKeys.add(key);
  }
}

export function getOutcomeTelemetryConfigState():OutcomeTelemetryConfigState{
  const raw=process.env.EVOLUTION_OUTCOME_TELEMETRY_JSON?.trim();
  if(!raw)return {configured:false,ready:true,sources:[],errors:[]};
  try{
    const sources=SourcesSchema.parse(JSON.parse(raw));
    for(const source of sources)validateSource(source);
    const ids=new Set<string>();
    for(const source of sources){
      if(ids.has(source.id))throw new Error("duplicate telemetry source id: "+source.id);
      ids.add(source.id);
    }
    return {configured:true,ready:true,sources,errors:[]};
  }catch(error){
    return {configured:true,ready:false,sources:[],errors:configError(error)};
  }
}

export function getOutcomeTelemetryCapabilities(){
  const state=getOutcomeTelemetryConfigState();
  return {
    configured:state.configured,
    ready:state.ready,
    sourceCount:state.sources.length,
    metricCount:state.sources.reduce((sum,source)=>sum+source.metrics.length,0),
    errors:state.errors,
  };
}

function pathValue(input:unknown,path:string):unknown{
  let current:unknown=input;
  for(const part of path.split(".")){
    if(!part)return undefined;
    if(Array.isArray(current)&&/^\d+$/.test(part)){
      current=current[Number(part)];
      continue;
    }
    if(!current||typeof current!=="object")return undefined;
    current=(current as Record<string,unknown>)[part];
  }
  return current;
}

function numericValue(value:unknown){
  if(typeof value==="number")return Number.isFinite(value)?value:undefined;
  if(typeof value==="boolean")return value?1:0;
  if(typeof value==="string"&&value.trim()){
    const parsed=Number(value);
    return Number.isFinite(parsed)?parsed:undefined;
  }
  return undefined;
}

function telemetryId(parts:string[]){
  return "outcome-telemetry-"+createHash("sha256").update(parts.join("|")).digest("hex").slice(0,32);
}

type Target={
  arm:OutcomeArm;
  deploymentId:string;
  deploymentUrl?:string;
};

function observationContext(
  observation:VercelReleaseObservation|OutcomeTelemetryObservationContext,
):OutcomeTelemetryObservationContext{
  if("checkedAt" in observation){
    const deploymentUrls:Record<string,string|undefined>={};
    if(observation.productionDeployment)deploymentUrls[observation.productionDeployment.id]=observation.productionDeployment.url;
    if(observation.boundDeployment)deploymentUrls[observation.boundDeployment.id]=observation.boundDeployment.url;
    return {
      observedAt:observation.checkedAt,
      deploymentUrls,
      trafficPercent:observation.rollingRelease?.currentPercentage,
      rollingReleaseActive:observation.rollingRelease?.active,
      rollingStageIndex:observation.rollingRelease?.currentStageIndex,
    };
  }
  return observation;
}

function telemetryTargets(project:EvolveProject,observation:OutcomeTelemetryObservationContext):Target[]{
  const stableId=project.release.stableDeploymentId;
  const candidateId=project.release.deploymentId;
  if(!stableId&&!candidateId)return[];
  if(stableId&&candidateId&&stableId===candidateId){
    const arm:OutcomeArm=project.release.status==="rolled-back"?"stable":"candidate";
    return [{arm,deploymentId:stableId,deploymentUrl:observation.deploymentUrls?.[stableId]}];
  }
  return [
    ...(stableId?[{arm:"stable" as const,deploymentId:stableId,deploymentUrl:observation.deploymentUrls?.[stableId]}]:[]),
    ...(candidateId?[{arm:"candidate" as const,deploymentId:candidateId,deploymentUrl:observation.deploymentUrls?.[candidateId]}]:[]),
  ];
}

function encodeTemplate(source:OutcomeTelemetrySource,target:Target,project:EvolveProject){
  const values:Record<string,string|undefined>={
    missionId:project.id,
    candidateId:project.release.candidateId,
    deploymentId:target.deploymentId,
    deploymentUrl:target.deploymentUrl,
    arm:target.arm,
    trafficPercent:String(project.release.trafficPercent),
    releaseStatus:project.release.status,
  };
  const rendered=source.urlTemplate.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g,(_all,token:string)=>{
    const value=values[token];
    if(value===undefined)throw new Error("source "+source.id+": token {"+token+"} has no value for "+target.arm);
    return encodeURIComponent(value);
  });
  const url=new URL(rendered);
  if(url.protocol!=="https:"&&url.protocol!=="http:"){
    throw new Error("source "+source.id+": telemetry URL must use http(s)");
  }
  return url.toString();
}

function requestHeaders(source:OutcomeTelemetrySource){
  const headers:Record<string,string>={Accept:"application/json"};
  if(!source.auth)return headers;
  const secret=process.env[source.auth.env]?.trim();
  if(!secret)throw new Error("source "+source.id+": credential env "+source.auth.env+" is not configured");
  if(source.auth.type==="bearer")headers.Authorization="Bearer "+secret;
  else headers[source.auth.header]=source.auth.prefix+secret;
  return headers;
}

function liveOutcomeStage(project:EvolveProject){
  return ["canary-5","canary-20","canary-50","promoted","rolled-back"].includes(project.release.status);
}

async function pullSourceTarget(args:{
  project:EvolveProject;
  observation:OutcomeTelemetryObservationContext;
  source:OutcomeTelemetrySource;
  target:Target;
}){
  const {project,observation,source,target}=args;
  const warnings:string[]=[];
  if(!source.arms.includes(target.arm))return {samples:[] as OutcomeMetricSampleInput[],warnings,requested:false};
  let url:string;
  let headers:Record<string,string>;
  try{
    url=encodeTemplate(source,target,project);
    headers=requestHeaders(source);
  }catch(error){
    return {
      samples:[] as OutcomeMetricSampleInput[],
      warnings:[error instanceof Error?error.message:String(error)],
      requested:false,
    };
  }
  try{
    const response=await fetch(url,{
      method:"GET",
      headers,
      signal:AbortSignal.timeout(source.timeoutMs),
    });
    const text=await response.text();
    if(!response.ok){
      return {
        samples:[] as OutcomeMetricSampleInput[],
        warnings:["source "+source.id+"/"+target.arm+": HTTP "+response.status],
        requested:true,
      };
    }
    let body:unknown;
    try{body=text?JSON.parse(text):{};}
    catch{
      return {
        samples:[] as OutcomeMetricSampleInput[],
        warnings:["source "+source.id+"/"+target.arm+": response is not valid JSON"],
        requested:true,
      };
    }
    const samples:OutcomeMetricSampleInput[]=[];
    for(const metric of source.metrics){
      const raw=pathValue(body,metric.path);
      const value=numericValue(raw);
      if(value===undefined){
        warnings.push("source "+source.id+"/"+target.arm+": metric "+metric.metricKey+"/"+metric.segment+" missing or non-numeric at "+metric.path);
        continue;
      }
      samples.push({
        id:telemetryId([
          project.id,observation.observedAt,source.id,target.arm,target.deploymentId,metric.metricKey,metric.segment,
        ]),
        candidateId:project.release.candidateId,
        deploymentId:target.deploymentId,
        arm:target.arm,
        metricKey:metric.metricKey,
        metricKind:metric.metricKind,
        direction:metric.direction,
        value:value*metric.scale,
        unit:metric.unit,
        segment:metric.segment,
        source:"outcome-telemetry:"+source.id,
        observedAt:observation.observedAt,
        metadata:{
          telemetrySourceId:source.id,
          releaseStatus:project.release.status,
          trafficPercent:observation.trafficPercent??project.release.trafficPercent,
          rollingReleaseActive:observation.rollingReleaseActive??false,
          rollingStageIndex:observation.rollingStageIndex,
          deploymentId:target.deploymentId,
          arm:target.arm,
        },
      });
    }
    return {samples,warnings,requested:true};
  }catch(error){
    return {
      samples:[] as OutcomeMetricSampleInput[],
      warnings:["source "+source.id+"/"+target.arm+": "+(error instanceof Error?error.message:String(error))],
      requested:true,
    };
  }
}

export async function collectConfiguredOutcomeTelemetry(
  project:EvolveProject,
  rawObservation:VercelReleaseObservation|OutcomeTelemetryObservationContext,
):Promise<OutcomeTelemetryCollection>{
  const observation=observationContext(rawObservation);
  const state=getOutcomeTelemetryConfigState();
  const metricCount=state.sources.reduce((sum,source)=>sum+source.metrics.length,0);
  if(!state.ready){
    return {
      configured:state.configured,ready:false,sourceCount:0,metricCount:0,requestCount:0,
      samples:[],warnings:state.errors,
    };
  }
  if(!state.configured||!liveOutcomeStage(project)){
    return {
      configured:state.configured,ready:true,sourceCount:state.sources.length,metricCount,
      requestCount:0,samples:[],warnings:[],
    };
  }
  const targets=telemetryTargets(project,observation);
  const tasks=state.sources.flatMap((source)=>
    targets.map((target)=>pullSourceTarget({project,observation,source,target})),
  );
  const results=await Promise.all(tasks);
  const samples=[...new Map(results.flatMap((item)=>item.samples).map((sample)=>[sample.id!,sample])).values()];
  return {
    configured:true,
    ready:true,
    sourceCount:state.sources.length,
    metricCount,
    requestCount:results.filter((item)=>item.requested).length,
    samples,
    warnings:results.flatMap((item)=>item.warnings),
  };
}
