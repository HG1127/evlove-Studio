import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {createError,defineEventHandler,getHeader,getRouterParam,readRawBody} from "nitro/h3";
import {ConnectorWebhookEnvelopeSchema,ConnectorWebhookReceiptSchema} from "@evolution/contracts";
import {connectorWebhookSecret} from "../../../../src/services/connector-registry";
import {buildConnectorWebhookEvent} from "../../../../src/services/connector-webhook";
import {getServerProductionRuntime} from "../../../../src/services/production-runtime";

function safeEqual(left:string,right:string){
  const a=Buffer.from(left,"utf8"),b=Buffer.from(right,"utf8");
  return a.length===b.length&&timingSafeEqual(a,b);
}

export default defineEventHandler(async(event)=>{
  const connectorId=getRouterParam(event,"id");
  if(!connectorId)throw createError({statusCode:400,statusMessage:"Connector id is required"});
  let secret:string;
  try{secret=await connectorWebhookSecret(connectorId);}
  catch(error){throw createError({statusCode:503,statusMessage:error instanceof Error?error.message:String(error)});}
  const raw=await readRawBody(event,"utf8")??"";
  const signature=getHeader(event,"x-evolution-connector-signature")??"";
  const expected="sha256="+createHmac("sha256",secret).update(raw).digest("hex");
  if(!safeEqual(signature,expected))throw createError({statusCode:401,statusMessage:"Invalid connector webhook signature"});
  let parsed:unknown;
  try{parsed=JSON.parse(raw||"{}");}catch{throw createError({statusCode:400,statusMessage:"Invalid connector webhook JSON"});}
  const payload=ConnectorWebhookEnvelopeSchema.parse(parsed);
  if(payload.missionId){
    const runtime=getServerProductionRuntime();
    const mission=await runtime.missions.get(payload.missionId);
    if(!mission)throw createError({statusCode:404,statusMessage:"Connector webhook Mission not found"});
    let evolutionEvent;
    try{
      const deliveryFingerprint=createHash("sha256")
        .update(connectorId)
        .update("\0")
        .update(raw)
        .digest("hex");
      evolutionEvent=buildConnectorWebhookEvent({mission,connectorId,payload,deliveryFingerprint});
    }catch(error){
      throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:String(error)});
    }
    try{
      await runtime.events.append(evolutionEvent);
    }catch(error){
      throw createError({statusCode:503,statusMessage:`Connector webhook event persistence failed: ${error instanceof Error?error.message:String(error)}`});
    }
  }
  return ConnectorWebhookReceiptSchema.parse({
    accepted:true,connectorId,missionId:payload.missionId,event:payload.event,observedAt:new Date().toISOString(),
  });
});
