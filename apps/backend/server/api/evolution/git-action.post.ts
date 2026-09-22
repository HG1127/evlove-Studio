import {createError,defineEventHandler,readBody} from "nitro/h3";
import {createEvolutionEvent,GitTargetActionRequestSchema} from "@evolution/contracts";
import {serverSupabaseConfigured} from "../../../src/server-env";
import {executeGitTargetAction} from "../../../src/services/github-target";
import {gitActionPermission} from "../../../src/services/git-permission";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  const input=GitTargetActionRequestSchema.parse(await readBody(event));
  await requireGovernedEvolutionPermission(event,gitActionPermission(input.action));
  const writeAction=["mutate","open-pr","merge","rollback"].includes(input.action);
  if(writeAction&&!serverSupabaseConfigured()){
    throw createError({statusCode:503,statusMessage:"Git write requires configured Server Data Plane for durable audit"});
  }
  try{
    const result=await executeGitTargetAction(input);
    if(writeAction&&"missionId" in input&&input.missionId){
      const runtime=getServerProductionRuntime();
      await runtime.events.append(createEvolutionEvent({
        missionId:input.missionId,
        type:"ActionCompleted",
        source:"github-target",
        payload:{
          action:input.action,candidateId:"candidateId" in input?input.candidateId:undefined,repository:result.repository,
          branch:result.branch,baseCommitSha:result.baseCommitSha,commitSha:result.commitSha,
          treeSha:result.treeSha,pullNumber:result.pullNumber,pullUrl:result.pullUrl,
          mergeCommitSha:result.mergeCommitSha,changedPaths:result.changedPaths,
        },
      }));
    }
    return result;
  }catch(error){
    const code=(error as {code?:string}).code;
    if(code==="GITHUB_TARGET_CREDENTIAL_REQUIRED"||code==="GITHUB_TARGET_ALLOWLIST_REQUIRED"){
      throw createError({statusCode:503,statusMessage:error instanceof Error?error.message:String(error)});
    }
    if(code==="GITHUB_TARGET_REPOSITORY_NOT_ALLOWED"){
      throw createError({statusCode:403,statusMessage:error instanceof Error?error.message:String(error)});
    }
    throw error;
  }
});
