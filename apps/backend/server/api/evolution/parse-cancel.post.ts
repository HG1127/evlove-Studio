import {createError,defineEventHandler,readBody} from "nitro/h3";
import {z} from "zod";
import {getServerArtifactStore} from "../../../src/services/artifact-runtime";
import {getServerProductionRuntime} from "../../../src/services/production-runtime";
import {requireEvolutionPermission} from "../../../src/services/security-policy";

const Input=z.object({jobId:z.string().min(1),deleteArtifact:z.boolean().default(true)});

export default defineEventHandler(async(event)=>{
  requireEvolutionPermission(event,"mission.execute");
  const input=Input.parse(await readBody(event));
  const runtime=getServerProductionRuntime();
  const job=await runtime.jobs.get(input.jobId);
  if(!job||job.type!=="parse")throw createError({statusCode:404,statusMessage:"Parse Job 不存在"});
  await runtime.jobs.cancel(job.id);
  if(input.deleteArtifact){
    const artifacts=getServerArtifactStore();
    if(job.inputRef)await artifacts.delete(job.inputRef).catch(()=>undefined);
    if(job.outputRef)await artifacts.delete(job.outputRef).catch(()=>undefined);
  }
  return {jobId:job.id,status:"cancelled"};
});
