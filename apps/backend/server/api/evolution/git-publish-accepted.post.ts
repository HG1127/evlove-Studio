import {createError,defineEventHandler,readBody} from "nitro/h3";
import {createEvolutionEvent,GitAcceptedPublishRequestSchema} from "@evolution/contracts";
import {serverSupabaseConfigured} from "../../../src/server-env";
import {publishAcceptedChampionToGit} from "../../../src/services/git-accepted-publisher";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"target.write");
  if(!serverSupabaseConfigured()){
    throw createError({statusCode:503,statusMessage:"Accepted Git publish requires configured Server Data Plane for Mission binding and durable audit"});
  }
  const input=GitAcceptedPublishRequestSchema.parse(await readBody(event));
  const runtime=getServerProductionRuntime();
  const mission=await runtime.missions.get(input.missionId);
  if(!mission)throw createError({statusCode:404,statusMessage:"Mission not found"});
  try{
    const result=await publishAcceptedChampionToGit(mission,input);
    await runtime.events.append(createEvolutionEvent({
      missionId:mission.id,
      type:"ActionCompleted",
      source:"github-accepted-publisher",
      payload:{
        action:"publish-accepted",
        candidateId:result.candidateId,
        repository:result.mutation.repository,
        branch:result.mutation.branch,
        commitSha:result.mutation.commitSha,
        treeSha:result.mutation.treeSha,
        pullNumber:result.pullRequest?.pullNumber,
        pullUrl:result.pullRequest?.pullUrl,
        changedPaths:result.mutation.changedPaths,
        artifactCount:result.artifactCount,
        metadataCount:result.metadataCount,
      },
    }));
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
