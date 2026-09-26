import {createHmac,timingSafeEqual} from "node:crypto";
import {createError,deleteCookie,getCookie,getHeader,getRequestURL,setCookie,type H3Event} from "nitro/h3";
import {EvolutionActorSchema,OperatorSessionStatusSchema,type EvolutionActor} from "@evolution/contracts";
import {z} from "zod";
import {getServerSecurityConfig} from "../server-env";

const COOKIE_NAME="evolution_operator_session";
const SESSION_SECONDS=8*60*60;
const ACCESS_KEY_PATTERN=/^[a-f0-9]{64}$/i;
const SessionPayloadSchema=z.object({
  version:z.literal(1),
  workspaceId:z.string().min(1),
  issuedAt:z.number().int().positive(),
  expiresAt:z.number().int().positive(),
  credentialTag:z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

function sessionConfig(){
  const security=getServerSecurityConfig();
  const accessKey=process.env.EVOLUTION_OPERATOR_ACCESS_KEY?.trim();
  if(!security.identitySecret||!security.workspaceId||!accessKey||!ACCESS_KEY_PATTERN.test(accessKey))return undefined;
  return {secret:security.identitySecret,workspaceId:security.workspaceId,accessKey};
}

function hmac(secret:string,purpose:string,value:string){
  return createHmac("sha256",secret).update(purpose).update("\0").update(value).digest("hex");
}

function equal(left:string,right:string){
  const a=Buffer.from(left),b=Buffer.from(right);
  return a.length===b.length&&timingSafeEqual(a,b);
}

function credentialTag(config:NonNullable<ReturnType<typeof sessionConfig>>){
  return hmac(config.secret,"operator-credential-v1",config.accessKey);
}

export function operatorSessionConfigured(){return Boolean(sessionConfig());}

export function createOperatorSession(accessKey:string,now=Math.floor(Date.now()/1000)){
  const config=sessionConfig();
  if(!config||!ACCESS_KEY_PATTERN.test(accessKey)||!equal(accessKey.toLowerCase(),config.accessKey.toLowerCase()))return undefined;
  const payload=SessionPayloadSchema.parse({
    version:1,workspaceId:config.workspaceId,issuedAt:now,expiresAt:now+SESSION_SECONDS,
    credentialTag:credentialTag(config),
  });
  const encoded=Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {token:`${encoded}.${hmac(config.secret,"operator-session-v1",encoded)}`,expiresAt:payload.expiresAt};
}

export function verifyOperatorSession(token:string|undefined,now=Math.floor(Date.now()/1000)):
  {actor:EvolutionActor;expiresAt:number}|undefined{
  const config=sessionConfig();
  if(!config||!token||token.length>2048)return undefined;
  const [encoded,signature,extra]=token.split(".");
  if(!encoded||!signature||extra||!equal(signature,hmac(config.secret,"operator-session-v1",encoded)))return undefined;
  try{
    const payload=SessionPayloadSchema.parse(JSON.parse(Buffer.from(encoded,"base64url").toString("utf8")));
    if(payload.workspaceId!==config.workspaceId||payload.issuedAt>now+60||payload.expiresAt<=now
      ||payload.expiresAt-payload.issuedAt!==SESSION_SECONDS
      ||!equal(payload.credentialTag,credentialTag(config)))return undefined;
    return {
      actor:EvolutionActorSchema.parse({
        id:"browser-operator",role:"admin",workspaceId:config.workspaceId,
        issuedAt:payload.issuedAt,expiresAt:payload.expiresAt,source:"browser-session",
      }),
      expiresAt:payload.expiresAt,
    };
  }catch{return undefined;}
}

export function readOperatorSession(event:H3Event){
  return verifyOperatorSession(getCookie(event,COOKIE_NAME));
}

export function assertOperatorSameOrigin(event:H3Event){
  const origin=getHeader(event,"origin");
  const fetchSite=getHeader(event,"sec-fetch-site");
  if(origin!==getRequestURL(event).origin||(fetchSite&&fetchSite!=="same-origin")){
    throw createError({statusCode:403,statusMessage:"Operator session requires a same-origin request"});
  }
}

export function setOperatorSessionCookie(event:H3Event,token:string){
  setCookie(event,COOKIE_NAME,token,{
    httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:SESSION_SECONDS,
  });
}

export function clearOperatorSessionCookie(event:H3Event){
  deleteCookie(event,COOKIE_NAME,{path:"/",secure:process.env.NODE_ENV==="production",sameSite:"strict"});
}

export function operatorSessionStatus(event:H3Event){
  const session=readOperatorSession(event);
  return OperatorSessionStatusSchema.parse({
    configured:operatorSessionConfigured(),authenticated:Boolean(session),
    ...(session?{expiresAt:session.expiresAt}:{}),
  });
}
