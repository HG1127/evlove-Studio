import {createHmac,timingSafeEqual} from "node:crypto";
import {createError,defineEventHandler,getHeader,getRouterParam,readRawBody} from "nitro/h3";
import {ConnectorWebhookEnvelopeSchema,ConnectorWebhookReceiptSchema,createEvolutionEvent} from "@evolution/contracts";
import {connectorWebhookSecret} from "../../../../src/services/connector-registry";
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
    await getServerProductionRuntime().events.append(createEvolutionEvent({
      missionId:payload.missionId,
      type:"ActionCompleted",
      source:`connector-webhook:${connectorId}`,
      payload:{
        connectorId,targetId:payload.targetId,event:payload.event,versionRef:payload.versionRef,
        status:payload.status,...payload.payload,
      },
    })).catch(()=>undefined);
  }
  return ConnectorWebhookReceiptSchema.parse({
    accepted:true,connectorId,missionId:payload.missionId,event:payload.event,observedAt:new Date().toISOString(),
  });
});
