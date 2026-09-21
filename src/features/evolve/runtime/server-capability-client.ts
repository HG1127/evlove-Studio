import {
  OrganizationCapabilityHealthSchema,
  OrganizationCapabilitySearchRequestSchema,
  OrganizationCapabilitySearchResponseSchema,
  OrganizationCapabilitySyncResponseSchema,
  type OrganizationCapabilitySearchRequest,
} from "@evolution/contracts";

async function apiJson(path:string,init?:RequestInit){
  const response=await fetch(path,init);
  const body=await response.json().catch(()=>({}));
  if(!response.ok){
    const message=String((body as {statusMessage?:string;message?:string}).statusMessage
      ??(body as {message?:string}).message
      ??`Capability API HTTP ${response.status}`);
    throw new Error(message);
  }
  return body;
}

export async function getServerOrganizationCapabilityHealth(){
  return OrganizationCapabilityHealthSchema.parse(await apiJson("/api/evolution/learning-capabilities-health"));
}

export async function searchServerOrganizationCapabilities(input:OrganizationCapabilitySearchRequest){
  const parsed=OrganizationCapabilitySearchRequestSchema.parse(input);
  const query=new URLSearchParams({q:parsed.q,limit:String(parsed.limit),reusableOnly:String(parsed.reusableOnly)});
  if(parsed.statuses?.length)query.set("statuses",parsed.statuses.join(","));
  return OrganizationCapabilitySearchResponseSchema.parse(await apiJson("/api/evolution/learning-capabilities?"+query.toString()));
}

export async function syncServerMissionCapabilities(missionId:string){
  return OrganizationCapabilitySyncResponseSchema.parse(await apiJson("/api/evolution/learning-capabilities-sync",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({missionId}),
  }));
}
