import {createError} from "nitro/h3";

export type DataPlaneUpstreamReason=
  |"credential-rejected"
  |"schema-unavailable"
  |"rate-limited-or-timeout"
  |"upstream-unavailable"
  |"network-error"
  |"conflict"
  |"request-rejected";

function schemaFailure(status:number,detail:string){
  if(status===404)return true;
  return /(?:PGRST20[245]|42P01|42883|relation\s+.+does not exist|function\s+.+does not exist|schema cache)/i.test(detail);
}

export function classifyDataPlaneUpstreamFailure(status:number,detail=""):DataPlaneUpstreamReason{
  if(status===401||status===403)return "credential-rejected";
  if(schemaFailure(status,detail))return "schema-unavailable";
  if(status===408||status===425||status===429)return "rate-limited-or-timeout";
  if(status>=500)return "upstream-unavailable";
  if(status===409)return "conflict";
  return "request-rejected";
}

function safeError(args:{
  service:string;
  upstreamStatus?:number;
  reason:DataPlaneUpstreamReason;
}){
  const {service,upstreamStatus,reason}=args;
  if(reason==="conflict"){
    return createError({
      statusCode:409,
      statusMessage:"Server Data Plane 写入冲突",
      data:{code:"SERVER_DATA_PLANE_CONFLICT",service,reason,upstreamStatus},
    });
  }
  if(reason==="request-rejected"){
    return createError({
      statusCode:502,
      statusMessage:"Server Data Plane 请求被上游拒绝",
      data:{code:"SERVER_DATA_PLANE_REQUEST_REJECTED",service,reason,upstreamStatus},
    });
  }
  return createError({
    statusCode:503,
    statusMessage:"Server Data Plane 当前不可用",
    data:{code:"SERVER_DATA_PLANE_UNAVAILABLE",service,reason,upstreamStatus},
  });
}

const READ_RETRY_DELAYS_MS=[200,800];
const MAX_READ_RETRY_DELAY_MS=2000;

async function pauseReadRetry(delayMs:number,signal?:AbortSignal|null){
  if(signal?.aborted)return false;
  return new Promise<boolean>((resolve)=>{
    const finish=(retry:boolean)=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);resolve(retry);};
    const abort=()=>finish(false);
    const timer=setTimeout(()=>finish(true),delayMs);
    signal?.addEventListener("abort",abort,{once:true});
  });
}

function readRetryDelay(response:Response|undefined,attempt:number){
  const fallback=READ_RETRY_DELAYS_MS[attempt];
  if(fallback===undefined)return undefined;
  const raw=response?.headers.get("retry-after");
  if(!raw)return fallback;
  const seconds=Number(raw);
  const requested=Number.isFinite(seconds)&&seconds>=0?seconds*1000:Date.parse(raw)-Date.now();
  if(!Number.isFinite(requested))return fallback;
  if(requested>MAX_READ_RETRY_DELAY_MS)return undefined;
  return Math.max(fallback,requested,0);
}

export async function dataPlaneFetch(
  service:string,
  input:string|URL|Request,
  init:RequestInit={},
):Promise<Response>{
  const request=input instanceof Request?input:undefined;
  const method=(init.method??request?.method??"GET").toUpperCase();
  const canRetry=(method==="GET"||method==="HEAD")&&init.body==null&&request?.body==null;
  const signal=init.signal??request?.signal;
  for(let attempt=0;;attempt++){
    if(signal?.aborted)throw safeError({service,reason:"network-error"});
    let response:Response|undefined;
    let reason:DataPlaneUpstreamReason="network-error";
    try{response=await fetch(input,init);}
    catch{reason="network-error";}
    if(response?.ok)return response;
    if(response){
      const detail=await response.text().catch(()=>"");
      reason=classifyDataPlaneUpstreamFailure(response.status,detail);
    }
    const retryable=reason!=="schema-unavailable"&&(
      !response||[408,425,429,500,502,503,504].includes(response.status)
    );
    const delay=canRetry&&retryable?readRetryDelay(response,attempt):undefined;
    if(delay!==undefined&&await pauseReadRetry(delay,signal))continue;
    throw safeError({service,reason,upstreamStatus:response?.status});
  }
}
