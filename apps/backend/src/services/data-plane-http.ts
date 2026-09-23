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

export async function dataPlaneFetch(
  service:string,
  input:string|URL|Request,
  init:RequestInit={},
):Promise<Response>{
  let response:Response;
  try{
    response=await fetch(input,init);
  }catch{
    throw safeError({service,reason:"network-error"});
  }
  if(response.ok)return response;

  const detail=await response.text().catch(()=>"");
  throw safeError({
    service,
    upstreamStatus:response.status,
    reason:classifyDataPlaneUpstreamFailure(response.status,detail),
  });
}
