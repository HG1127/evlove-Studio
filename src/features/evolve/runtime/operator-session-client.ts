import {OperatorSessionStatusSchema,type OperatorSessionStatus} from "@evolution/contracts";

async function request(method:"GET"|"POST"|"DELETE",accessKey?:string):Promise<OperatorSessionStatus>{
  const response=await fetch("/api/evolution/operator-session",{
    method,credentials:"same-origin",cache:"no-store",
    ...(accessKey?{headers:{"Content-Type":"application/json"},body:JSON.stringify({accessKey})}:{}),
  });
  const body=await response.json().catch(()=>({})) as {statusMessage?:string;message?:string};
  if(!response.ok)throw new Error(body.statusMessage||body.message||`访问会话不可用：HTTP ${response.status}`);
  return OperatorSessionStatusSchema.parse(body);
}

export function getOperatorSession(){return request("GET");}
export function loginOperator(accessKey:string){return request("POST",accessKey);}
export function logoutOperator(){return request("DELETE");}
