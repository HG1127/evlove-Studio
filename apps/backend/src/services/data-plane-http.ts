import {createError} from "nitro/h3";
import {z} from "zod";

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

const TimeoutSchema=z.coerce.number().int().min(100).max(60_000);
function requestTimeoutMs(){
  const parsed=TimeoutSchema.safeParse(process.env.EVOLUTION_DATA_PLANE_TIMEOUT_MS);
  return parsed.success?parsed.data:30_000;
}

/** One request budget includes headers, all read retries and body consumption. */
function requestBudget(service:string,callerSignal?:AbortSignal|null){
  const controller=new AbortController();
  let timedOut=false,closed=false;
  const abort=()=>controller.abort();
  callerSignal?.addEventListener("abort",abort,{once:true});
  if(callerSignal?.aborted)abort();
  const timer=setTimeout(()=>{if(!controller.signal.aborted){timedOut=true;abort();}},requestTimeoutMs());
  timer.unref?.();
  const error=(upstreamStatus?:number)=>safeError({
    service,upstreamStatus,reason:timedOut?"rate-limited-or-timeout":"network-error",
  });
  const close=()=>{
    if(closed)return;closed=true;
    clearTimeout(timer);callerSignal?.removeEventListener("abort",abort);
  };
  const wait=<T>(pending:Promise<T>,upstreamStatus?:number)=>new Promise<T>((resolve,reject)=>{
    let settled=false;
    const finish=(complete:()=>void)=>{
      if(settled)return;settled=true;controller.signal.removeEventListener("abort",onAbort);complete();
    };
    const onAbort=()=>finish(()=>reject(error(upstreamStatus)));
    controller.signal.addEventListener("abort",onAbort,{once:true});
    if(controller.signal.aborted)onAbort();
    // Attach both handlers even after abort so late native rejection is observed.
    pending.then(value=>finish(()=>resolve(value)),()=>finish(()=>reject(error(upstreamStatus))));
  });
  return {signal:controller.signal,wait,error,close,cancel:()=>{abort();close();}};
}
type RequestBudget=ReturnType<typeof requestBudget>;

function boundedResponse(response:Response,budget:RequestBudget){
  if(!response.body){budget.close();return response;}
  const reader=response.body.getReader();
  const body=new ReadableStream<Uint8Array>({
    async pull(controller){
      try{
        const result=await budget.wait(reader.read(),response.status);
        if(result.done){budget.close();controller.close();}
        else controller.enqueue(result.value);
      }catch{
        controller.error(budget.error(response.status));budget.cancel();
        void reader.cancel().catch(()=>undefined);
      }
    },
    cancel(){budget.cancel();void reader.cancel().catch(()=>undefined);},
  });
  const bounded=new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  // Retain native fetch metadata, including clones of the guarded stream.
  const retainMetadata=(target:Response):Response=>{
    const clone=target.clone.bind(target);
    Object.defineProperties(target,{
      url:{value:response.url},redirected:{value:response.redirected},type:{value:response.type},
      clone:{value:()=>retainMetadata(clone())},
    });
    return target;
  };
  return retainMetadata(bounded);
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
  const budget=requestBudget(service,init.signal??request?.signal);
  const scopedInit={...init,signal:budget.signal};
  let handedOff=false;
  try{
    for(let attempt=0;;attempt++){
      if(budget.signal.aborted)throw budget.error();
      let response:Response|undefined;
      try{response=await budget.wait(fetch(input,scopedInit));}catch{
        if(budget.signal.aborted)throw budget.error();
      }
      if(response?.ok){
        const result=boundedResponse(response,budget);handedOff=true;return result;
      }
      let reason:DataPlaneUpstreamReason="network-error";
      if(response){
        let detail="";
        if([401,403,404,409].includes(response.status)){
          void response.body?.cancel().catch(()=>undefined);
        }else{
          try{detail=await budget.wait(response.text(),response.status);}catch{
            if(budget.signal.aborted)throw budget.error(response.status);
          }
        }
        reason=classifyDataPlaneUpstreamFailure(response.status,detail);
      }
      const retryable=reason!=="schema-unavailable"&&(
        !response||[408,425,429,500,502,503,504].includes(response.status)
      );
      const delay=canRetry&&retryable?readRetryDelay(response,attempt):undefined;
      if(delay!==undefined&&await pauseReadRetry(delay,budget.signal))continue;
      if(budget.signal.aborted)throw budget.error(response?.status);
      throw safeError({service,reason,upstreamStatus:response?.status});
    }
  }finally{if(!handedOff)budget.close();}
}
