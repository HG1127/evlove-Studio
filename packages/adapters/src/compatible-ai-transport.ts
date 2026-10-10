const REQUEST_TIMEOUT_CODES=new Set([
  "ETIMEDOUT","ESOCKETTIMEDOUT","UND_ERR_CONNECT_TIMEOUT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT",
]);
const REQUEST_NETWORK_CODES=new Set([
  "ENOTFOUND","EAI_AGAIN","ECONNREFUSED","ECONNRESET","ECONNABORTED","EHOSTUNREACH","ENETUNREACH","EPIPE","UND_ERR_SOCKET",
]);
export type CompatibleAiTransportCode="AI_REQUEST_TIMEOUT"|"AI_REQUEST_NETWORK_ERROR";

function transportCode(error:unknown,signal?:AbortSignal|null):CompatibleAiTransportCode|undefined{
  let current=error;
  for(let depth=0;depth<6&&current&&typeof current==="object";depth+=1){
    const item=current as {name?:string;code?:unknown;cause?:unknown};
    if(item.name==="TimeoutError"||typeof item.code==="string"&&REQUEST_TIMEOUT_CODES.has(item.code)){
      return "AI_REQUEST_TIMEOUT";
    }
    if((item.name==="AbortError"||item.code==="ABORT_ERR")&&signal?.aborted&&signal.reason?.name==="TimeoutError"){
      return "AI_REQUEST_TIMEOUT";
    }
    if(typeof item.code==="string"&&REQUEST_NETWORK_CODES.has(item.code))return "AI_REQUEST_NETWORK_ERROR";
    current=item.cause;
  }
  return undefined;
}

function requestFailure(error:unknown,signal?:AbortSignal|null):unknown{
  const code=transportCode(error,signal);
  if(!code)return error;
  // Never copy provider text, URL, request bodies or credentials into the availability error.
  return Object.assign(new Error(code==="AI_REQUEST_TIMEOUT"
    ?"模型请求超时，未取得完整响应。":"模型接口连接中断，未取得完整响应。"),{code});
}

/** One request, including body read, under the caller's original signal. No retry/fallback. */
export async function requestCompatibleAiJson(url:string,init:RequestInit):Promise<{response:Response;json:unknown}>{
  let response:Response;
  try{response=await fetch(url,init);}
  catch(error){throw requestFailure(error,init.signal);}
  let json:unknown;
  try{json=await response.json();}
  catch(error){
    const failure=requestFailure(error,init.signal);
    if(failure!==error)throw failure;
    // Retain HTTP status handling for an HTML/non-JSON error response. Task schemas still reject it.
    if(error instanceof SyntaxError)json={};
    else throw error;
  }
  return {response,json};
}
