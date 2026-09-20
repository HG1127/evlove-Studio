import {
  VercelDeploymentSummarySchema,
  VercelReleaseActionResponseSchema,
  VercelReleaseCapabilitiesSchema,
  VercelReleaseDeploymentsSchema,
  VercelReleaseHealthSchema,
  VercelReleaseObservationSchema,
  type VercelDeploymentSummary,
  type VercelReleaseAction,
  type VercelReleaseActionResponse,
  type VercelReleaseCapabilities,
  type VercelReleaseHealth,
  type VercelReleaseObservation,
} from "@evolution/contracts";
import { getServerVercelReleaseConfig } from "../server-env";

type JsonRecord=Record<string,unknown>;
const API="https://api.vercel.com";
const DEFAULT_HEALTH_PATH="/";

function normalizedPath(path:string|undefined){
  const value=(path||DEFAULT_HEALTH_PATH).trim();
  return value.startsWith("/")?value:"/"+value;
}

function normalizedDeploymentUrl(value:unknown){
  if(typeof value!=="string"||!value.trim())return undefined;
  const trimmed=value.trim();
  return /^https?:\/\//i.test(trimmed)?trimmed:"https://"+trimmed;
}

function deploymentSummary(input:JsonRecord):VercelDeploymentSummary{
  const url=normalizedDeploymentUrl(input.url);
  if(!url)throw new Error("Vercel deployment 缺少 URL");
  return VercelDeploymentSummarySchema.parse({
    id:String(input.uid??input.id??""),
    url,
    state:String(input.readyState??input.state??"UNKNOWN"),
    target:typeof input.target==="string"?input.target:undefined,
    createdAt:typeof input.createdAt==="number"?input.createdAt:undefined,
    meta:input.meta&&typeof input.meta==="object"?input.meta:undefined,
  });
}

function requireWriteConfig(){
  const config=getServerVercelReleaseConfig();
  if(!config.token||!config.projectId){
    const error=Object.assign(new Error("Vercel Release 写操作尚未授权：需要 VERCEL_RELEASE_TOKEN + VERCEL_PROJECT_ID"),{code:"VERCEL_RELEASE_CREDENTIAL_REQUIRED"});
    throw error;
  }
  return config as Required<Pick<typeof config,"token"|"projectId">>&typeof config;
}

function withTeam(path:string,teamId?:string){
  if(!teamId)return path;
  return path+(path.includes("?")?"&":"?")+"teamId="+encodeURIComponent(teamId);
}

async function vercelApi(path:string,init:RequestInit={}){
  const config=requireWriteConfig();
  const response=await fetch(API+withTeam(path,config.teamId),{
    ...init,
    headers:{
      Authorization:"Bearer "+config.token,
      "Content-Type":"application/json",
      ...(init.headers??{}),
    },
    signal:init.signal??AbortSignal.timeout(30_000),
  });
  const text=await response.text();
  const body=text?JSON.parse(text):{};
  if(!response.ok){
    const detail=String((body as {error?:{message?:string;code?:string}}).error?.message??text).slice(0,500);
    throw Object.assign(new Error("Vercel API HTTP "+response.status+": "+detail),{httpStatus:response.status,body});
  }
  return body as JsonRecord;
}

async function rollingBilling(){
  try{
    const config=requireWriteConfig();
    const body=await vercelApi("/v1/projects/"+encodeURIComponent(config.projectId)+"/rolling-release/billing");
    const availableSlots=Number(body.availableSlots??0);
    return {
      supported:availableSlots>0,
      reason:availableSlots>0?undefined:String(body.reason??body.message??"not_enabled"),
    };
  }catch(error){
    if((error as {code?:string}).code==="VERCEL_RELEASE_CREDENTIAL_REQUIRED")return{supported:false,reason:"credential_required"};
    return{supported:false,reason:"unavailable"};
  }
}

export async function getVercelReleaseCapabilities():Promise<VercelReleaseCapabilities>{
  const config=getServerVercelReleaseConfig();
  const writeEnabled=Boolean(config.token&&config.projectId);
  const rolling=writeEnabled?await rollingBilling():{supported:false,reason:"credential_required"};
  // V1 deliberately stays on preview→promote even if a paid project supports rolling release.
  // This avoids pretending 5/20/50 traffic splitting is implemented before the adapter has stage telemetry.
  const mode="preview-promote" as const;
  return VercelReleaseCapabilitiesSchema.parse({
    provider:"vercel",
    available:Boolean(config.projectId||config.productionUrl),
    readEnabled:Boolean(config.productionUrl),
    writeEnabled,
    credentialStatus:writeEnabled?"ready":"required",
    mode,
    rollingReleaseSupported:rolling.supported,
    rollingReleaseReason:rolling.reason,
    projectId:config.projectId,
    projectName:config.projectName,
    productionUrl:config.productionUrl,
    actions:writeEnabled?["shadow","promote","rollback"]:[],
  });
}

async function probe(url:string,path:string){
  const started=Date.now();
  let last:{path:string;ok:boolean;status?:number;latencyMs:number;error?:string}={
    path:normalizedPath(path),ok:false,latencyMs:0,error:"health probe not started",
  };
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(new URL(normalizedPath(path),url),{
        method:"GET",
        redirect:"follow",
        signal:AbortSignal.timeout(20_000),
        headers:{"User-Agent":"Evolution-Release-Health/1.0"},
      });
      last={path:normalizedPath(path),ok:response.ok,status:response.status,latencyMs:Date.now()-started};
      if(response.ok||response.status<500&&response.status!==429)return last;
    }catch(error){
      last={path:normalizedPath(path),ok:false,latencyMs:Date.now()-started,error:error instanceof Error?error.message:String(error)};
    }
    if(attempt<2)await new Promise((resolve)=>setTimeout(resolve,400*(attempt+1)));
  }
  return last;
}

export async function checkVercelReleaseHealth(args?:{url?:string;healthPath?:string}):Promise<VercelReleaseHealth>{
  const config=getServerVercelReleaseConfig();
  const url=args?.url??config.productionUrl;
  const started=Date.now();
  if(!url){
    return VercelReleaseHealthSchema.parse({
      ready:false,checkedAt:new Date().toISOString(),latencyMs:0,checks:[],
      message:"未配置 Vercel Production URL",
    });
  }
  const check=await probe(url,args?.healthPath??DEFAULT_HEALTH_PATH);
  return VercelReleaseHealthSchema.parse({
    ready:check.ok,url,checkedAt:new Date().toISOString(),latencyMs:Date.now()-started,
    checks:[check],
    message:check.ok?"Production Health Gate 已通过":"Production Health Gate 未通过",
  });
}

async function getDeployment(idOrUrl:string){
  const key=idOrUrl.replace(/^https?:\/\//i,"").replace(/\/$/,"");
  return deploymentSummary(await vercelApi("/v13/deployments/"+encodeURIComponent(key)));
}

async function currentProductionDeployment(){
  const config=requireWriteConfig();
  if(!config.productionUrl)return undefined;
  try{return await getDeployment(config.productionUrl);}
  catch{return undefined;}
}

export async function observeVercelReleaseReality(args?:{
  boundDeploymentId?:string;
  healthPath?:string;
}):Promise<VercelReleaseObservation>{
  const config=getServerVercelReleaseConfig();
  const errors:string[]=[];
  let productionDeployment:VercelDeploymentSummary|undefined;
  let boundDeployment:VercelDeploymentSummary|undefined;
  if(config.productionUrl){
    try{productionDeployment=await getDeployment(config.productionUrl);}
    catch(error){errors.push(`production-deployment: ${error instanceof Error?error.message:String(error)}`);}
  }else{
    errors.push("production-deployment: production URL not configured");
  }
  if(args?.boundDeploymentId){
    try{boundDeployment=await getDeployment(args.boundDeploymentId);}
    catch(error){errors.push(`bound-deployment: ${error instanceof Error?error.message:String(error)}`);}
  }
  const productionHealth=await checkVercelReleaseHealth({url:config.productionUrl,healthPath:args?.healthPath});
  const boundHealth=boundDeployment
    ?await checkVercelReleaseHealth({url:boundDeployment.url,healthPath:args?.healthPath})
    :undefined;
  return VercelReleaseObservationSchema.parse({
    provider:"vercel",
    checkedAt:new Date().toISOString(),
    productionDeployment,
    boundDeployment,
    productionHealth,
    boundHealth,
    errors,
  });
}

export async function listVercelReleaseDeployments(){
  const config=getServerVercelReleaseConfig();
  if(!config.token||!config.projectId){
    return VercelReleaseDeploymentsSchema.parse({
      available:false,deployments:[],message:"需要 VERCEL_RELEASE_TOKEN 才能读取候选 Deployment",
    });
  }
  const body=await vercelApi("/v7/deployments?projectId="+encodeURIComponent(config.projectId)+"&limit=20");
  const rows=Array.isArray(body.deployments)?body.deployments:[];
  const deployments=rows.flatMap((row)=>{
    try{return [deploymentSummary(row as JsonRecord)];}catch{return [];}
  });
  return VercelReleaseDeploymentsSchema.parse({
    available:true,deployments,message:"已读取最近 Vercel Deployments",
  });
}

async function waitForProduction(expectedDeploymentId:string){
  const config=requireWriteConfig();
  if(!config.productionUrl)return undefined;
  for(let attempt=0;attempt<12;attempt++){
    const deployment=await currentProductionDeployment();
    if(deployment?.id===expectedDeploymentId)return deployment;
    await new Promise((resolve)=>setTimeout(resolve,1500));
  }
  return currentProductionDeployment();
}

export async function executeVercelReleaseAction(args:{
  action:VercelReleaseAction;
  deploymentId?:string;
  stableDeploymentId?:string;
  healthPath?:string;
  artifactHashes:Array<{sourceArtifactId:string;contentHash:string}>;
}):Promise<VercelReleaseActionResponse>{
  const config=requireWriteConfig();
  if(["canary-5","canary-20","canary-50"].includes(args.action)){
    throw Object.assign(new Error("当前 Vercel Release Provider 使用 Preview → Promote；5/20/50 Rolling Release 未启用。"),{code:"VERCEL_ROLLING_RELEASE_NOT_ENABLED"});
  }
  const deploymentId=args.deploymentId;
  if(!deploymentId){
    const label=args.action==="shadow"?"Preview Gate":args.action==="promote"?"Promote":"Rollback";
    throw new Error(label+" 缺少显式绑定的 deploymentId");
  }
  const productionBefore=await currentProductionDeployment();
  const observedAt=()=>new Date().toISOString();

  if(args.action==="shadow"){
    const candidate=await getDeployment(deploymentId);
    if(candidate.state!=="READY")throw new Error("候选 Deployment 尚未 READY");
    if(candidate.target==="production")throw new Error("Preview Gate 不能绑定当前 Production Deployment");
    const health=await checkVercelReleaseHealth({url:candidate.url,healthPath:args.healthPath});
    return VercelReleaseActionResponseSchema.parse({
      ok:health.ready,trafficPercent:0,
      note:health.ready?"Preview Deployment 已通过 Health Gate；尚未切换 Production 流量。":"Preview Deployment Health Gate 未通过。",
      healthy:health.ready,kpis:[],evidenceMode:"live",effectiveAction:"shadow",
      observationStatus:health.ready?"healthy":"unhealthy",
      stableDeploymentId:productionBefore?.id,deploymentId:candidate.id,
      artifactHashes:args.artifactHashes,environment:"preview",observedAt:observedAt(),
      latencyMs:health.latencyMs,sampleSize:health.checks.length,windowMinutes:Math.max(0.01,health.latencyMs/60000),
      provider:"vercel",releaseMode:"preview-promote",deploymentUrl:candidate.url,productionUrl:config.productionUrl,
    });
  }

  if(args.action==="promote"){
    const candidate=await getDeployment(deploymentId);
    if(candidate.state!=="READY")throw new Error("候选 Deployment 尚未 READY");
    if(productionBefore?.id!==candidate.id){
      await vercelApi("/v10/projects/"+encodeURIComponent(config.projectId)+"/promote/"+encodeURIComponent(candidate.id),{method:"POST",body:"{}"});
    }
    const productionAfter=productionBefore?.id===candidate.id?productionBefore:await waitForProduction(candidate.id);
    const health=await checkVercelReleaseHealth({url:config.productionUrl??candidate.url,healthPath:args.healthPath});
    const points=health.checks.length;
    return VercelReleaseActionResponseSchema.parse({
      ok:Boolean(productionAfter?.id===candidate.id&&health.ready),trafficPercent:100,
      note:productionAfter?.id===candidate.id&&health.ready?"Vercel Production 已切换到候选 Deployment，Health Gate 通过。":"Promote 已发起，但 Production 指向或 Health Gate 尚未确认。",
      healthy:health.ready,kpis:[],evidenceMode:"live",effectiveAction:"promote",
      observationStatus:health.ready?"healthy":"unhealthy",
      stableDeploymentId:args.stableDeploymentId??(productionBefore?.id===candidate.id?undefined:productionBefore?.id),deploymentId:candidate.id,
      artifactHashes:args.artifactHashes,environment:"production",observedAt:observedAt(),
      latencyMs:health.latencyMs,sampleSize:points,windowMinutes:Math.max(0.01,health.latencyMs/60000),
      provider:"vercel",releaseMode:"preview-promote",deploymentUrl:candidate.url,productionUrl:config.productionUrl,
    });
  }

  if(args.action==="rollback"){
    const target=await getDeployment(deploymentId);
    if(productionBefore?.id!==target.id){
      await vercelApi("/v1/projects/"+encodeURIComponent(config.projectId)+"/rollback/"+encodeURIComponent(target.id),{method:"POST",body:"{}"});
    }
    const productionAfter=productionBefore?.id===target.id?productionBefore:await waitForProduction(target.id);
    const health=await checkVercelReleaseHealth({url:config.productionUrl??target.url,healthPath:args.healthPath});
    return VercelReleaseActionResponseSchema.parse({
      ok:Boolean(productionAfter?.id===target.id&&health.ready),trafficPercent:0,
      note:productionAfter?.id===target.id&&health.ready?"Production 已回滚到稳定 Deployment，Health Gate 通过。":"Rollback 已发起，但 Production 指向或 Health Gate 尚未确认。",
      healthy:health.ready,kpis:[],evidenceMode:"live",effectiveAction:"rollback",
      observationStatus:health.ready?"healthy":"unhealthy",
      stableDeploymentId:target.id,deploymentId:target.id,
      environment:"production",observedAt:observedAt(),
      latencyMs:health.latencyMs,sampleSize:health.checks.length,windowMinutes:Math.max(0.01,health.latencyMs/60000),
      provider:"vercel",releaseMode:"preview-promote",deploymentUrl:target.url,productionUrl:config.productionUrl,
    });
  }

  throw new Error("Unsupported Vercel release action");
}
