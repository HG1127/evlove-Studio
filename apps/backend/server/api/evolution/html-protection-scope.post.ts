import { createError, defineEventHandler, readBody } from "nitro/h3";
import { createEvolutionEvent, HtmlProtectionOperationalConfirmationRequestSchema } from "@evolution/contracts";
import { requireGovernedEvolutionPermission } from "../../../src/services/security-policy";
import { requireReviewedHuman } from "../../../src/services/reviewed-holdout-identity";
import { getServerMissionEnvelope, getServerProductionRuntime, compareAndSwapServerMissionEnvelopeWithEvent } from "../../../src/services/production-runtime";
import { prepareServerHtmlProtectionOperationalConfirmation } from "../../../src/services/server-html-protection-operational-confirmation";
/** No model, generic Mission PUT or service identity can enable the finite-scope policy. */
export default defineEventHandler(async event=>{
  const actor=await requireGovernedEvolutionPermission(event,"mission.write");
  try { requireReviewedHuman(actor); } catch { throw createError({statusCode:403,statusMessage:"需要已认证人工操作员确认保护范围。"}); }
  const parsed=HtmlProtectionOperationalConfirmationRequestSchema.safeParse(await readBody(event));
  if(!parsed.success)throw createError({statusCode:400,statusMessage:"保护范围确认请求不完整。"});
  const request=parsed.data,envelope=await getServerMissionEnvelope(request.missionId);
  if(!envelope)throw createError({statusCode:404,statusMessage:"Mission 不存在。"});
  if(envelope.revision!==request.expectedRevision)throw createError({statusCode:409,statusMessage:"Mission 版本已变化。"});
  try {
    const jobs=await getServerProductionRuntime().jobs.list(request.missionId);
    if(jobs.some(job=>job.type!=="parse"||job.status!=="completed"))throw Error("仅允许从未执行的新 Mission；已有作业及结果必须保留。");
    const prepared=await prepareServerHtmlProtectionOperationalConfirmation({project:envelope.payload,actor,humanReviewNote:request.humanReviewNote});
    const preview={missionId:request.missionId,revision:envelope.revision,policy:prepared.next.htmlProtectionOperationalScope!.policy,
      original:prepared.original,targetContractSha256:prepared.targetContractSha256,universalProtectionProved:false,
      limitations:["仅限已确认的完整 Original 内容、登记控件及状态、全部登记视口和实际图像区域；范围外仍为未验证。"]};
    if(!request.confirm)return {...preview,confirmed:false};
    if(request.targetContractSha256!==prepared.targetContractSha256||JSON.stringify(request.original)!==JSON.stringify(prepared.original))
      throw Error("Target Ready 契约或实际原始文件已变化，请重新确认。");
    const reread=await getServerMissionEnvelope(request.missionId);
    if(!reread||reread.revision!==envelope.revision||JSON.stringify(reread.payload)!==JSON.stringify(envelope.payload))throw Error("确认期间 Mission 发生变化。");
    const at=new Date().toISOString();
    // The atomic Mission/event RPC requires a checkpoint event with matching identity.
    const checkpointId=`operational-scope:${request.missionId}:${envelope.revision}`;
    const change=createEvolutionEvent({id:checkpointId,checkpointId,missionId:request.missionId,
      type:"CheckpointCreated",source:"backend-human-operational-scope",at,
      payload:{action:"confirm-html-protection-operational-scope",policy:preview.policy,original:preview.original,
        targetContractSha256:preview.targetContractSha256,confirmedBy:prepared.next.htmlProtectionOperationalScope!.confirmedBy,
        confirmedAt:prepared.next.htmlProtectionOperationalScope!.confirmedAt,universalProtectionProved:false}});
    const saved=await compareAndSwapServerMissionEnvelopeWithEvent({...envelope,payload:{...prepared.next,updatedAt:at},updatedAt:at},change);
    return {...preview,revision:saved.revision,confirmed:true};
  } catch(error) { throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:"无法确认保护范围。"}); }
});
