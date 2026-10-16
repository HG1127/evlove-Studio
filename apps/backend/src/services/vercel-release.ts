import {
  VercelDeploymentSummarySchema,
  VercelReleaseActionResponseSchema,
  VercelReleaseCapabilitiesSchema,
  VercelReleaseDeploymentsSchema,
  VercelReleaseHealthSchema,
  VercelReleaseObservationSchema,
  VercelRollingReleaseSummarySchema,
  type VercelDeploymentSummary,
  type VercelReleaseAction,
  type VercelReleaseActionResponse,
  type VercelReleaseCapabilities,
  type VercelReleaseHealth,
  type VercelReleaseObservation,
  type VercelRollingReleaseSummary,
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

function deploymentGitCommitSha(deployment:VercelDeploymentSummary){
  const value=deployment.meta?.githubCommitSha;
  return typeof value==="string"?value.trim():undefined;
}

export type VercelPreviewDiscovery={
  status:"not-found"|"pending"|"ready"|"conflict";
  commitSha:string;
  deployment?:VercelDeploymentSummary;
  matches:VercelDeploymentSummary[];
  message:string;
};

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

async function vercelApi(path:string,init:RequestInit={},beforeDispatch?:()=>Promise<()=>void>){
  const config=requireWriteConfig();
  const url=API+withTeam(path,config.teamId),options={...init,headers:{Authorization:"Bearer "+config.token,"Content-Type":"application/json",...(init.headers??{})}};
  const checkDispatch=await beforeDispatch?.();
  if(JSON.stringify(requireWriteConfig())!==JSON.stringify(config))throw Error("Vercel write configuration changed before dispatch");
  const requestInit={...options,signal:init.signal??AbortSignal.timeout(30_000)};
  checkDispatch?.();
  const response=await fetch(url,requestInit);
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

type RollingConfig={
  enabled:boolean;
  advancementType?:string;
  stages:Array<{targetPercentage:number;duration?:number}>;
};

function record(value:unknown):JsonRecord|undefined{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as JsonRecord:undefined;
}

function deploymentId(value:unknown){
  if(typeof value==="string"&&value.trim())return value.trim();
  const row=record(value);
  const id=row?.id??row?.uid??row?.deploymentId;
  return typeof id==="string"&&id.trim()?id.trim():undefined;
}

function rollingStages(value:unknown){
  if(!Array.isArray(value))return[] as Array<{targetPercentage:number;duration?:number}>;
  return value.flatMap((item)=>{
    const row=record(item);
    const targetPercentage=Number(row?.targetPercentage);
    if(!Number.isFinite(targetPercentage)||targetPercentage<0||targetPercentage>100)return[];
    const duration=Number(row?.duration);
    return [{targetPercentage,duration:Number.isFinite(duration)&&duration>=0?duration:undefined}];
  });
}

function parseRollingConfig(body:JsonRecord):RollingConfig{
  const raw=record(body.rollingRelease);
  if(!raw)return {enabled:false,stages:[]};
  return {
    enabled:raw.enabled===true,
    advancementType:typeof raw.advancementType==="string"?raw.advancementType:undefined,
    stages:rollingStages(raw.stages),
  };
}

async function rollingReleaseConfig(){
  const config=requireWriteConfig();
  return parseRollingConfig(await vercelApi("/v1/projects/"+encodeURIComponent(config.projectId)+"/rolling-release/config"));
}

function rollingConfigReady(config:RollingConfig){
  return config.enabled
    &&config.advancementType==="manual-approval"
    &&config.stages.map((stage)=>stage.targetPercentage).join(",")==="5,20,50,100";
}

function parseRollingState(body:JsonRecord,config:RollingConfig):VercelRollingReleaseSummary{
  const raw=record(body.rollingRelease);
  if(!raw){
    return VercelRollingReleaseSummarySchema.parse({
      active:false,
      enabled:config.enabled,
      advancementType:config.advancementType,
      stages:config.stages,
    });
  }
  const currentStageIndexRaw=Number(raw.currentStageIndex??raw.stageIndex);
  const currentStageIndex=Number.isInteger(currentStageIndexRaw)&&currentStageIndexRaw>=0
    ?currentStageIndexRaw
    :undefined;
  const stageRow=record(raw.currentStage);
  const explicitPercentage=Number(
    stageRow?.targetPercentage
      ??raw.targetPercentage
      ??raw.currentPercentage
      ??raw.percentage,
  );
  const currentPercentage=Number.isFinite(explicitPercentage)
    ?explicitPercentage
    :currentStageIndex!==undefined
      ?config.stages[currentStageIndex]?.targetPercentage
      :undefined;
  return VercelRollingReleaseSummarySchema.parse({
    active:true,
    enabled:config.enabled,
    advancementType:config.advancementType,
    candidateDeploymentId:deploymentId(raw.canaryDeployment)
      ??deploymentId(raw.candidateDeployment)
      ??deploymentId(raw.deployment)
      ??deploymentId(raw.deploymentId),
    stableDeploymentId:deploymentId(raw.currentDeployment)
      ??deploymentId(raw.stableDeployment)
      ??deploymentId(raw.previousDeployment),
    currentStageIndex,
    currentPercentage:Number.isFinite(currentPercentage)?currentPercentage:undefined,
    stages:config.stages,
    status:typeof raw.status==="string"
      ?raw.status
      :typeof raw.state==="string"
        ?raw.state
        :undefined,
  });
}

async function rollingReleaseState(config?:RollingConfig){
  const releaseConfig=config??await rollingReleaseConfig();
  const server=requireWriteConfig();
  const body=await vercelApi("/v1/projects/"+encodeURIComponent(server.projectId)+"/rolling-release");
  return parseRollingState(body,releaseConfig);
}

function progressiveReason(billing:{supported:boolean;reason?:string},config:RollingConfig){
  if(!billing.supported&&!config.enabled)return billing.reason??"rolling_release_unavailable";
  if(!config.enabled)return "rolling_release_not_configured";
  if(config.advancementType!=="manual-approval")return "manual_approval_required";
  if(config.stages.map((stage)=>stage.targetPercentage).join(",")!=="5,20,50,100"){
    return "requires_manual_5_20_50_100_stages";
  }
  return undefined;
}

export async function getVercelReleaseCapabilities():Promise<VercelReleaseCapabilities>{
  const config=getServerVercelReleaseConfig();
  const writeEnabled=Boolean(config.token&&config.projectId);
  const rolling=writeEnabled?await rollingBilling():{supported:false,reason:"credential_required"};
  const rollingConfig=writeEnabled
    ?await rollingReleaseConfig().catch(()=>({enabled:false,stages:[]} as RollingConfig))
    :{enabled:false,stages:[]} as RollingConfig;
  const progressive=writeEnabled&&rollingConfigReady(rollingConfig);
  const mode=progressive?"progressive" as const:"preview-promote" as const;
  return VercelReleaseCapabilitiesSchema.parse({
    provider:"vercel",
    available:Boolean(config.projectId||config.productionUrl),
    readEnabled:Boolean(config.productionUrl),
    writeEnabled,
    credentialStatus:writeEnabled?"ready":"required",
    mode,
    rollingReleaseSupported:rolling.supported||rollingConfig.enabled,
    rollingReleaseConfigured:rollingConfig.enabled,
    rollingReleaseStages:rollingConfig.stages.map((stage)=>stage.targetPercentage),
    rollingReleaseReason:progressive?undefined:progressiveReason(rolling,rollingConfig),
    projectId:config.projectId,
    projectName:config.projectName,
    productionUrl:config.productionUrl,
    actions:writeEnabled
      ?progressive
        ?["shadow","canary-5","canary-20","canary-50","promote","rollback"]
        :["shadow","promote","rollback"]
      :[],
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

export async function findVercelPreviewDeploymentByGitCommit(commitSha:string):Promise<VercelPreviewDiscovery>{
  const exact=commitSha.trim();
  if(!exact)throw new Error("Git commit SHA is required for Vercel Preview discovery");
  const config=requireWriteConfig();
  const body=await vercelApi("/v6/deployments?projectId="+encodeURIComponent(config.projectId)+"&limit=100");
  const rows=Array.isArray(body.deployments)?body.deployments:[];
  const deployments=rows.flatMap((row)=>{
    try{return [deploymentSummary(row as JsonRecord)];}catch{return [];}
  });
  const matches=deployments.filter((deployment)=>
    deployment.target!=="production"
    &&deploymentGitCommitSha(deployment)===exact
  );
  if(matches.length>1){
    return {
      status:"conflict",
      commitSha:exact,
      matches,
      message:`同一 Git commit ${exact} 匹配到 ${matches.length} 个非 Production Vercel Deployments；禁止自动猜测。`,
    };
  }
  const deployment=matches[0];
  if(!deployment){
    return {
      status:"not-found",
      commitSha:exact,
      matches:[],
      message:`尚未发现 Git commit ${exact} 对应的 Vercel Preview Deployment。`,
    };
  }
  const ready=deployment.state==="READY";
  return {
    status:ready?"ready":"pending",
    commitSha:exact,
    deployment,
    matches:[deployment],
    message:ready
      ?`已唯一匹配 Git commit ${exact} 对应的 READY Vercel Preview ${deployment.id}。`
      :`已唯一匹配 Git commit ${exact} 对应的 Vercel Preview ${deployment.id}，当前状态 ${deployment.state}。`,
  };
}

export async function observeVercelReleaseReality(args?:{
  boundDeploymentId?:string;
  gitCommitSha?:string;
  healthPath?:string;
}):Promise<VercelReleaseObservation>{
  const config=getServerVercelReleaseConfig();
  const errors:string[]=[];
  let productionDeployment:VercelDeploymentSummary|undefined;
  let boundDeployment:VercelDeploymentSummary|undefined;
  let rollingRelease:VercelRollingReleaseSummary|undefined;
  try{
    const rollingConfig=await rollingReleaseConfig();
    rollingRelease=await rollingReleaseState(rollingConfig);
  }catch(error){
    errors.push(`rolling-release: ${error instanceof Error?error.message:String(error)}`);
  }
  const stableId=rollingRelease?.active?rollingRelease.stableDeploymentId:undefined;
  let candidateId=args?.boundDeploymentId
    ??(rollingRelease?.active?rollingRelease.candidateDeploymentId:undefined);
  if(!candidateId&&args?.gitCommitSha){
    try{
      const discovery=await findVercelPreviewDeploymentByGitCommit(args.gitCommitSha);
      if(discovery.status==="conflict"){
        errors.push("preview-discovery-conflict: "+discovery.message);
      }else if(discovery.deployment){
        boundDeployment=discovery.deployment;
        candidateId=discovery.deployment.id;
      }
    }catch(error){
      errors.push(`preview-discovery: ${error instanceof Error?error.message:String(error)}`);
    }
  }
  if(stableId){
    try{productionDeployment=await getDeployment(stableId);}
    catch(error){errors.push(`stable-deployment: ${error instanceof Error?error.message:String(error)}`);}
  }else if(config.productionUrl){
    try{productionDeployment=await getDeployment(config.productionUrl);}
    catch(error){errors.push(`production-deployment: ${error instanceof Error?error.message:String(error)}`);}
  }else{
    errors.push("production-deployment: production URL not configured");
  }
  if(candidateId&&!boundDeployment){
    try{boundDeployment=await getDeployment(candidateId);}
    catch(error){errors.push(`bound-deployment: ${error instanceof Error?error.message:String(error)}`);}
  }
  const productionHealth=await checkVercelReleaseHealth({
    url:productionDeployment?.url??config.productionUrl,
    healthPath:args?.healthPath,
  });
  const boundHealth=boundDeployment?.state==="READY"
    ?await checkVercelReleaseHealth({url:boundDeployment.url,healthPath:args?.healthPath})
    :undefined;
  return VercelReleaseObservationSchema.parse({
    provider:"vercel",
    checkedAt:new Date().toISOString(),
    productionDeployment,
    boundDeployment,
    productionHealth,
    boundHealth,
    rollingRelease,
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

function releaseError(message:string,code:string){
  return Object.assign(new Error(message),{code});
}

function assertDeploymentGitCommit(deployment:VercelDeploymentSummary,expectedGitCommitSha:string|undefined){
  const expected=expectedGitCommitSha?.trim();
  if(!expected)return;
  const observed=deploymentGitCommitSha(deployment);
  if(observed!==expected){
    throw releaseError(
      `Vercel Deployment ${deployment.id} 的 githubCommitSha ${observed??"missing"} 与 Mission exact Git commit ${expected} 不一致。`,
      "VERCEL_RELEASE_GIT_COMMIT_MISMATCH",
    );
  }
}

function canaryPercentage(action:VercelReleaseAction){
  if(action==="canary-5")return 5;
  if(action==="canary-20")return 20;
  if(action==="canary-50")return 50;
  return undefined;
}

function priorCanaryPercentage(action:VercelReleaseAction){
  if(action==="canary-20")return 5;
  if(action==="canary-50")return 20;
  return undefined;
}

function assertRollingCandidate(state:VercelRollingReleaseSummary,deploymentId:string){
  if(!state.active)throw releaseError("Vercel Rolling Release 当前没有 active rollout。","VERCEL_ROLLING_RELEASE_NOT_ACTIVE");
  if(!state.candidateDeploymentId){
    throw releaseError("Vercel Rolling Release 未返回 canary deployment identity。","VERCEL_ROLLING_RELEASE_STATE_INCOMPLETE");
  }
  if(state.candidateDeploymentId!==deploymentId){
    throw releaseError(
      `Active Rolling Release candidate ${state.candidateDeploymentId} 与当前绑定 Deployment ${deploymentId} 不一致。`,
      "VERCEL_ROLLING_RELEASE_CANDIDATE_MISMATCH",
    );
  }
}

async function requireProgressiveConfig(){
  const config=await rollingReleaseConfig();
  if(!rollingConfigReady(config)){
    throw releaseError(
      "Vercel Rolling Release 必须启用 manual-approval，并配置 5% → 20% → 50% → 100% 阶段。",
      "VERCEL_ROLLING_RELEASE_NOT_ENABLED",
    );
  }
  return config;
}

export async function executeVercelReleaseAction(args:{
  action:VercelReleaseAction;
  deploymentId?:string;
  stableDeploymentId?:string;
  expectedGitCommitSha?:string;
  healthPath?:string;
  artifactHashes:Array<{sourceArtifactId:string;contentHash:string}>;
},beforeDispatch?:()=>Promise<()=>void>):Promise<VercelReleaseActionResponse>{
  const config=requireWriteConfig();
  const guardDispatch=async()=>{const check=await beforeDispatch?.();if(JSON.stringify(requireWriteConfig())!==JSON.stringify(config))throw Error("Vercel action configuration changed before dispatch");return check??(()=>{});};
  const deploymentId=args.deploymentId;
  if(!deploymentId){
    const label=args.action==="shadow"?"Preview Gate":args.action==="promote"?"Promote":"Rollback";
    throw new Error(label+" 缺少显式绑定的 deploymentId");
  }
  const productionBefore=await currentProductionDeployment();
  const observedAt=()=>new Date().toISOString();
  const rollingConfig=await rollingReleaseConfig().catch(()=>({enabled:false,stages:[]} as RollingConfig));
  const progressiveConfigured=rollingConfigReady(rollingConfig);

  if(args.action==="shadow"){
    const candidate=await getDeployment(deploymentId);
    assertDeploymentGitCommit(candidate,args.expectedGitCommitSha);
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
      provider:"vercel",releaseMode:progressiveConfigured?"progressive":"preview-promote",deploymentUrl:candidate.url,productionUrl:config.productionUrl,
    });
  }

  const targetPercentage=canaryPercentage(args.action);
  if(targetPercentage!==undefined){
    const progressiveConfig=await requireProgressiveConfig();
    const candidate=await getDeployment(deploymentId);
    assertDeploymentGitCommit(candidate,args.expectedGitCommitSha);
    if(candidate.state!=="READY")throw new Error("候选 Deployment 尚未 READY");
    let rolling=await rollingReleaseState(progressiveConfig);
    if(!rolling.active){
      if(args.action!=="canary-5"){
        throw releaseError("Rolling Release 尚未开始，只能从 canary-5 启动。","VERCEL_ROLLING_RELEASE_STAGE_MISMATCH");
      }
      await vercelApi("/v1/projects/"+encodeURIComponent(config.projectId)+"/rolling-release/start",{
        method:"POST",
        body:JSON.stringify({deploymentId:candidate.id}),
      },guardDispatch);
      rolling=await rollingReleaseState(progressiveConfig);
    }else{
      assertRollingCandidate(rolling,candidate.id);
      const prior=priorCanaryPercentage(args.action);
      if(rolling.currentPercentage===targetPercentage){
        // Idempotent replay: external Vercel state is already at the requested stage.
      }else{
        if(prior===undefined||rolling.currentPercentage!==prior||rolling.currentStageIndex===undefined){
          throw releaseError(
            `Rolling Release 当前为 ${rolling.currentPercentage??"unknown"}%，不能执行 ${args.action}。`,
            "VERCEL_ROLLING_RELEASE_STAGE_MISMATCH",
          );
        }
        await vercelApi("/v1/projects/"+encodeURIComponent(config.projectId)+"/rolling-release/approve-stage",{
          method:"POST",
          body:JSON.stringify({deploymentId:candidate.id,currentStageIndex:rolling.currentStageIndex}),
        },guardDispatch);
        rolling=await rollingReleaseState(progressiveConfig);
      }
    }
    assertRollingCandidate(rolling,candidate.id);
    if(rolling.currentPercentage!==targetPercentage){
      throw releaseError(
        `Vercel Rolling Release 未确认 ${targetPercentage}% 阶段，当前为 ${rolling.currentPercentage??"unknown"}%。`,
        "VERCEL_ROLLING_RELEASE_STAGE_MISMATCH",
      );
    }
    const health=await checkVercelReleaseHealth({url:candidate.url,healthPath:args.healthPath});
    return VercelReleaseActionResponseSchema.parse({
      ok:health.ready,
      trafficPercent:targetPercentage,
      note:health.ready
        ?`Vercel Rolling Release 已确认 ${targetPercentage}% Canary，候选 Health 通过。`
        :`Vercel Rolling Release 已到 ${targetPercentage}% Canary，但候选 Health 未通过。`,
      healthy:health.ready,kpis:[],evidenceMode:"live",effectiveAction:args.action,
      observationStatus:health.ready?"healthy":"unhealthy",
      stableDeploymentId:rolling.stableDeploymentId??args.stableDeploymentId??productionBefore?.id,
      deploymentId:candidate.id,
      artifactHashes:args.artifactHashes,
      environment:"production-canary",
      observedAt:observedAt(),
      latencyMs:health.latencyMs,
      sampleSize:health.checks.length,
      windowMinutes:Math.max(0.01,health.latencyMs/60000),
      provider:"vercel",
      releaseMode:"progressive",
      deploymentUrl:candidate.url,
      productionUrl:config.productionUrl,
      rollingRelease:rolling,
    });
  }

  if(args.action==="promote"){
    const candidate=await getDeployment(deploymentId);
    assertDeploymentGitCommit(candidate,args.expectedGitCommitSha);
    if(candidate.state!=="READY")throw new Error("候选 Deployment 尚未 READY");
    let activeRolling=await rollingReleaseState(rollingConfig).catch(()=>undefined);
    if(activeRolling?.active){
      assertRollingCandidate(activeRolling,candidate.id);
      if(activeRolling.currentPercentage!==50){
        throw releaseError(
          `Rolling Release 当前为 ${activeRolling.currentPercentage??"unknown"}%，Promote 前必须完成 50% Canary。`,
          "VERCEL_ROLLING_RELEASE_STAGE_MISMATCH",
        );
      }
      await vercelApi("/v1/projects/"+encodeURIComponent(config.projectId)+"/rolling-release/complete",{
        method:"POST",
        body:JSON.stringify({deploymentId:candidate.id}),
      },guardDispatch);
      activeRolling=await rollingReleaseState(rollingConfig).catch(()=>activeRolling);
    }else if(productionBefore?.id!==candidate.id){
      await vercelApi("/v10/projects/"+encodeURIComponent(config.projectId)+"/promote/"+encodeURIComponent(candidate.id),{method:"POST",body:"{}"},guardDispatch);
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
      provider:"vercel",releaseMode:activeRolling?"progressive":"preview-promote",deploymentUrl:candidate.url,productionUrl:config.productionUrl,
      rollingRelease:activeRolling,
    });
  }

  if(args.action==="rollback"){
    const target=await getDeployment(deploymentId);
    let activeRolling=await rollingReleaseState(rollingConfig).catch(()=>undefined);
    if(activeRolling?.active&&activeRolling.candidateDeploymentId){
      if(activeRolling.stableDeploymentId&&activeRolling.stableDeploymentId!==target.id){
        throw releaseError(
          "Rolling Release stable Deployment 与 Mission rollback target 不一致。",
          "VERCEL_ROLLING_RELEASE_STABLE_MISMATCH",
        );
      }
      await vercelApi("/v1/projects/"+encodeURIComponent(config.projectId)+"/rolling-release/abort",{
        method:"POST",
        body:JSON.stringify({deploymentId:activeRolling.candidateDeploymentId}),
      },guardDispatch);
      activeRolling=await rollingReleaseState(rollingConfig).catch(()=>activeRolling);
    }else if(productionBefore?.id!==target.id){
      await vercelApi("/v1/projects/"+encodeURIComponent(config.projectId)+"/rollback/"+encodeURIComponent(target.id),{method:"POST",body:"{}"},guardDispatch);
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
      provider:"vercel",releaseMode:activeRolling?"progressive":"preview-promote",deploymentUrl:target.url,productionUrl:config.productionUrl,
      rollingRelease:activeRolling,
    });
  }

  throw new Error("Unsupported Vercel release action");
}
