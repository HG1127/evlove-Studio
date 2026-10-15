import {ReviewedHoldoutPreviewSchema,ReviewedHoldoutRequestSchema,EvolutionWorkflowStartResponseSchema,type ReviewedHoldoutRequest} from "@evolution/contracts";

async function json(url:string,init?:RequestInit){
  const response=await fetch(url,init),data=await response.json();
  if(!response.ok)throw new Error(data.statusMessage||data.error||"人工复核请求失败。");
  return data;
}
export async function previewReviewedHoldout(missionId:string){
  const preview=ReviewedHoldoutPreviewSchema.parse(await json("/api/evolution/reviewed-holdout?missionId="+encodeURIComponent(missionId)));
  if(preview.binding.missionId!==missionId)throw new Error("复核预览不属于当前项目。");
  return preview;
}
export async function startReviewedHoldout(raw:ReviewedHoldoutRequest){
  const request=ReviewedHoldoutRequestSchema.parse(raw);
  const receipt=EvolutionWorkflowStartResponseSchema.parse(await json("/api/evolution/reviewed-holdout",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request),
  }));
  if(receipt.missionId!==request.binding.missionId)throw new Error("人工复核回执不属于当前项目。");
  return receipt;
}
