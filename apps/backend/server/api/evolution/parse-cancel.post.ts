import {createError,defineEventHandler,readBody} from "nitro/h3";
import {z} from "zod";
import {SourceParseCancelResponseSchema} from "@evolution/contracts";
import {getServerArtifactStore} from "../../../src/services/artifact-runtime";
import {getServerProductionRuntime,JobStateConflictError} from "../../../src/services/production-runtime";
import {cancelServerJobWithWorkflow} from "../../../src/services/job-workflow-cancel";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

const Input=z.object({jobId:z.string().min(1),deleteArtifact:z.boolean().default(true)});

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const input=Input.parse(await readBody(event));
  const runtime=getServerProductionRuntime();
  const job=await runtime.jobs.get(input.jobId);
  if(!job||job.type!=="parse")throw createError({statusCode:404,statusMessage:"Parse Job 不存在"});
  let result;
  try{
    result=await cancelServerJobWithWorkflow(runtime,job);
  }catch(error){
    if(error instanceof JobStateConflictError){
      throw createError({
        statusCode:409,
        statusMessage:error.message,
        data:{code:error.code,jobId:error.jobId,reason:error.reason,current:error.current},
      });
    }
    throw createError({
      statusCode:502,
      statusMessage:"Parse Workflow cancel failed",
      data:{jobId:job.id,message:error instanceof Error?error.message:String(error)},
    });
  }
  if(input.deleteArtifact&&result.job.status==="cancelled"){
    const artifacts=getServerArtifactStore();
    if(result.job.inputRef)await artifacts.delete(result.job.inputRef).catch(()=>undefined);
    if(result.job.outputRef)await artifacts.delete(result.job.outputRef).catch(()=>undefined);
  }
  return SourceParseCancelResponseSchema.parse({jobId:job.id,status:result.job.status,workflow:result.workflow});
});
