import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {assertBodySize,createError,defineEventHandler,getHeader,readRawBody} from "nitro/h3";
import {GitWebhookReceiptSchema} from "@evolution/contracts";
import {getServerGitHubConfig} from "../../../src/server-env";
import {buildGitWebhookEvent,parseGitWebhookContext} from "../../../src/services/git-webhook";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";

function safeEqual(a:string,b:string){
  const left=Buffer.from(a);const right=Buffer.from(b);
  return left.length===right.length&&timingSafeEqual(left,right);
}

const MAX_GIT_WEBHOOK_BYTES=25*1024*1024;

export default defineEventHandler(async(event)=>{
  const config=getServerGitHubConfig();
  if(!config.webhookSecret)throw createError({statusCode:503,statusMessage:"GitHub webhook secret is not configured"});
  if(!config.repoAllowlist.length)throw createError({statusCode:503,statusMessage:"GitHub repository allowlist is not configured"});
  assertBodySize(event,MAX_GIT_WEBHOOK_BYTES);
  const raw=await readRawBody(event,"utf8")??"";
  const signature=getHeader(event,"x-hub-signature-256")??"";
  const expected="sha256="+createHmac("sha256",config.webhookSecret).update(raw).digest("hex");
  if(!safeEqual(signature,expected))throw createError({statusCode:401,statusMessage:"Invalid GitHub webhook signature"});
  const eventName=getHeader(event,"x-github-event")??"unknown";
  let payload:Record<string,unknown>;
  try{payload=JSON.parse(raw||"{}") as Record<string,unknown>;}
  catch{throw createError({statusCode:400,statusMessage:"Invalid GitHub webhook JSON"});}
  let context;
  try{context=parseGitWebhookContext(eventName,payload);}
  catch(error){throw createError({statusCode:400,statusMessage:error instanceof Error?error.message:String(error)});}
  const {branch,missionId,repository}=context;
  if(!config.repoAllowlist.includes(repository.toLowerCase())){
    throw createError({statusCode:403,statusMessage:"Webhook repository is not allowlisted"});
  }
  if(missionId){
    const runtime=getServerProductionRuntime();
    const mission=await runtime.missions.get(missionId);
    if(!mission)throw createError({statusCode:404,statusMessage:"GitHub webhook Mission not found"});
    const deliveryFingerprint=createHash("sha256").update(eventName).update("\0").update(raw).digest("hex");
    let evolutionEvent;
    try{evolutionEvent=buildGitWebhookEvent({mission,context,deliveryFingerprint});}
    catch(error){throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:String(error)});}
    try{await runtime.events.append(evolutionEvent);}
    catch(error){
      throw createError({statusCode:503,statusMessage:"GitHub webhook event persistence failed: "+(error instanceof Error?error.message:String(error))});
    }
  }
  return GitWebhookReceiptSchema.parse({accepted:true,event:eventName,missionId,branch,repository,observedAt:new Date().toISOString()});
});
