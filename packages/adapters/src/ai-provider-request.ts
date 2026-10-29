import {z} from "zod";

const NETWORK_CODES=new Set(["ECONNRESET","ECONNREFUSED","ENOTFOUND","EAI_AGAIN","EHOSTUNREACH","ENETUNREACH","UND_ERR_SOCKET"]);
const TIMEOUT_CODES=new Set(["ETIMEDOUT","UND_ERR_CONNECT_TIMEOUT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT"]);

export function aiProviderTransportFailure(error:unknown):"provider-network-error"|"provider-timeout"|undefined{
  let current=error;
  let networkFailure=false;
  for(let depth=0;depth<6&&current&&typeof current==="object";depth++){
    const detail=current as {code?:string;name?:string;message?:string;cause?:unknown};
    if(detail.name==="TimeoutError"||TIMEOUT_CODES.has(detail.code??"")||detail.code==="SERVER_AI_PROVIDER_TIMEOUT")return "provider-timeout";
    if(NETWORK_CODES.has(detail.code??"")||detail.code==="SERVER_AI_PROVIDER_NETWORK_ERROR"
      ||(detail.name==="TypeError"&&/fetch failed|failed to fetch|networkerror/i.test(detail.message??"")))networkFailure=true;
    current=detail.cause;
  }
  return networkFailure?"provider-network-error":undefined;
}

/** Retry one connection failure or explicit capacity rejection within the original deadline. */
export type AiProviderAttemptObserver={
  beforeAttempt(attempt:number):Promise<void>;
  failedAttempt(attempt:number,reason:ReturnType<typeof aiProviderTransportFailure>):Promise<void>;
  retryableResponse?(attempt:number,response:Response,raw:unknown):Promise<void>;
};
const capacityError=z.object({error:z.object({message:z.string().min(1).max(2000)}).passthrough()}).passthrough();
const capacityMessage=/(?:selected\s+)?model\s+is\s+at\s+capacity\b/i;
async function capacityRejection(response:Response){
  if(![429,503,529].includes(response.status))return undefined;
  let text:string;try{text=await response.clone().text();}catch{return undefined;}
  if(text.length>16384)return undefined;
  let raw:unknown;try{raw=JSON.parse(text);}catch{return text.length<=2000&&/^\s*(?:selected\s+)?model\s+is\s+at\s+capacity\b/i.test(text)?text:undefined;}
  const parsed=capacityError.safeParse(raw);if(!parsed.success)return undefined;
  if(Array.isArray(parsed.data.choices)&&parsed.data.choices.length||Array.isArray(parsed.data.output)&&parsed.data.output.length||typeof parsed.data.output_text==="string"&&parsed.data.output_text.trim())return undefined;
  return capacityMessage.test(parsed.data.error.message)?raw:undefined;
}
function reconnectDelay(signal?:AbortSignal|null){
  return new Promise<void>((resolve,reject)=>{
    if(signal?.aborted){reject(signal.reason);return;}
    const done=()=>{signal?.removeEventListener("abort",abort);resolve();};
    const timer=setTimeout(done,250),abort=()=>{clearTimeout(timer);signal?.removeEventListener("abort",abort);reject(signal?.reason);};
    signal?.addEventListener("abort",abort,{once:true});
  });
}
export async function fetchAiProvider(url:string,init:RequestInit,observer?:AiProviderAttemptObserver):Promise<Response>{
  for(let attempt=0;;attempt++){
    await observer?.beforeAttempt(attempt+1);
    let response:Response;
    try{response=await fetch(url,init);}
    catch(error){
      await observer?.failedAttempt(attempt+1,aiProviderTransportFailure(error));
      if(attempt!==0||init.signal?.aborted||aiProviderTransportFailure(error)!=="provider-network-error")throw error;
      continue;
    }
    const rejected=attempt===0&&!init.signal?.aborted?await capacityRejection(response):undefined;
    if(rejected){await observer?.retryableResponse?.(attempt+1,response,rejected);await reconnectDelay(init.signal);continue;}
    return response;
  }
}
