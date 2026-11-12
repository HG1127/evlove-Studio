import {createError,defineEventHandler,getQuery} from "nitro/h3";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";
import {probeServerAiRuntime,probeServerAiJudgeRuntime} from "../../../src/services/server-ai-health";
import {withAuthorizedLabAiProbe} from "../../../src/services/server-ai-lab-probe";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"ai.execute");
  const role=String(getQuery(event).role??"generation");
  if(role!=="generation"&&role!=="judge")throw createError({statusCode:400,statusMessage:"Unknown AI probe role"});
  return withAuthorizedLabAiProbe(()=>role==="judge"?probeServerAiJudgeRuntime():probeServerAiRuntime());
});