import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {z} from "zod";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {requireReviewedHuman} from "../../../src/services/reviewed-holdout-identity";
import {previewReviewedHoldout} from "../../../src/services/reviewed-holdout-admission";
import {previewReviewedInvalidRecovery} from "../../../src/services/reviewed-holdout-invalid-recovery";

export default defineEventHandler(async(event)=>{
  const actor=await requireGovernedEvolutionPermission(event,"mission.execute");
  try{requireReviewedHuman(actor);}catch{throw createError({statusCode:403,statusMessage:"需要人工操作员身份。"});}
  const query=z.object({missionId:z.string().min(1).max(200),recoverInvalidOutput:z.literal("true").optional()}).safeParse(getQuery(event));
  if(!query.success)throw createError({statusCode:400,statusMessage:"Mission ID 无效。"});
  const project=await getServerProductionRuntime().missions.get(query.data.missionId);
  if(!project)throw createError({statusCode:404,statusMessage:"Mission 不存在。"});
  try{return query.data.recoverInvalidOutput?await previewReviewedInvalidRecovery(project):await previewReviewedHoldout(project);}
  catch(error){throw createError({statusCode:409,statusMessage:error instanceof Error?error.message:"无法核验复核范围。"});}
});
