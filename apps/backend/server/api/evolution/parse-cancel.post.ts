import {createError,defineEventHandler,readBody} from "nitro/h3";
import {z} from "zod";
import {getServerArtifactStore} from "../../../src/services/artifact-runtime";
import {getServerProductionRuntime,JobStateConflictError} from "../../../src/services/production-runtime";
import {requireGovernedEvolutionPermission} from "../../../src/services/security-policy";

const Input=z.object({jobId:z.string().min(1),deleteArtifact:z.boolean().default(true)});

export default defineEventHandler(async(event)=>{
  await requireGovernedEvolutionPermission(event,"mission.execute");
  const input=Input.parse(await readBody(event));
  const runtime=getServerProductionRuntime();
  const job=await runtime.jobs.get(input.jobId);
  if(!job||job.type!=="parse")throw createError({statusCode:404,statusMessage:"Parse Job 不存在"});
  try{
    await runtime.jobs.cancel(job.id);
  }catch(error){
    if(error instanceof JobStateConflictError){
      throw createError({
        statusCode:409,
        statusMessage:error.message,
        data:{code:error.code,jobId:error.jobId,reason:error.reason,current:error.current},
      });
    }
    throw error;
  }
  const current=await runtime.jobs.get(job.id)??job;
  if(input.deleteArtifact&&current.status==="cancelled"){
    const artifacts=getServerArtifactStore();
    if(current.inputRef)await artifacts.delete(current.inputRef).catch(()=>undefined);
    if(current.outputRef)await artifacts.delete(current.outputRef).catch(()=>undefined);
  }
  return {jobId:job.id,status:current.status};
});
