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

/** AI generation requests contain no executable tools; retry one connection failure within the original deadline. */
export async function fetchAiProvider(url:string,init:RequestInit):Promise<Response>{
  for(let attempt=0;;attempt++){
    try{return await fetch(url,init);}
    catch(error){
      if(attempt!==0||init.signal?.aborted||aiProviderTransportFailure(error)!=="provider-network-error")throw error;
    }
  }
}
