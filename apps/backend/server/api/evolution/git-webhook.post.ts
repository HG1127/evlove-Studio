import {createHmac,timingSafeEqual} from "node:crypto";
import {createError,defineEventHandler,getHeader,readRawBody} from "nitro/h3";
import {createEvolutionEvent,GitWebhookReceiptSchema} from "@evolution/contracts";
import {getServerGitHubConfig} from "../../../src/server-env";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";

function safeEqual(a:string,b:string){
  const left=Buffer.from(a);const right=Buffer.from(b);
  return left.length===right.length&&timingSafeEqual(left,right);
}

function branchFromPayload(eventName:string,payload:Record<string,unknown>){
  if(eventName==="push"&&typeof payload.ref==="string")return payload.ref.replace(/^refs\/heads\//,"");
  const pr=payload.pull_request as Record<string,unknown>|undefined;
  const head=pr?.head as Record<string,unknown>|undefined;
  if(typeof head?.ref==="string")return head.ref;
  const check=payload.check_run as Record<string,unknown>|undefined;
  const suite=check?.check_suite as Record<string,unknown>|undefined;
  return typeof suite?.head_branch==="string"?suite.head_branch:undefined;
}

function repositoryFromPayload(payload:Record<string,unknown>){
  const repo=payload.repository as Record<string,unknown>|undefined;
  return typeof repo?.full_name==="string"?repo.full_name:undefined;
}

function missionFromBranch(branch?:string){
  if(!branch?.startsWith("evolve/"))return undefined;
  return branch.split("/")[1]||undefined;
}

export default defineEventHandler(async(event)=>{
  const config=getServerGitHubConfig();
  if(!config.webhookSecret)throw createError({statusCode:503,statusMessage:"GitHub webhook secret is not configured"});
  if(!config.repoAllowlist.length)throw createError({statusCode:503,statusMessage:"GitHub repository allowlist is not configured"});
  const raw=await readRawBody(event,"utf8")??"";
  const signature=getHeader(event,"x-hub-signature-256")??"";
  const expected="sha256="+createHmac("sha256",config.webhookSecret).update(raw).digest("hex");
  if(!safeEqual(signature,expected))throw createError({statusCode:401,statusMessage:"Invalid GitHub webhook signature"});
  const eventName=getHeader(event,"x-github-event")??"unknown";
  const payload=JSON.parse(raw||"{}") as Record<string,unknown>;
  const branch=branchFromPayload(eventName,payload);
  const missionId=missionFromBranch(branch);
  const repository=repositoryFromPayload(payload);
  if(!repository)throw createError({statusCode:400,statusMessage:"GitHub webhook payload is missing repository.full_name"});
  if(!config.repoAllowlist.includes(repository.toLowerCase())){
    throw createError({statusCode:403,statusMessage:"Webhook repository is not allowlisted"});
  }
  if(missionId){
    const runtime=getServerProductionRuntime();
    await runtime.events.append(createEvolutionEvent({
      missionId,type:"ActionCompleted",source:"github-webhook",
      payload:{event:eventName,branch,repository},
    })).catch(()=>undefined);
  }
  return GitWebhookReceiptSchema.parse({accepted:true,event:eventName,missionId,branch,repository,observedAt:new Date().toISOString()});
});
