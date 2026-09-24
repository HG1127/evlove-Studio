import {
  SourceArtifactSchema,SourceParseListResponseSchema,SourceParseStatusResponseSchema,
  type ArtifactStorePort,type EvolutionJob,type SourceParseStatusResponse,
} from "@evolution/contracts";

export async function readSourceParseResult(
  job:EvolutionJob,
  artifacts:Pick<ArtifactStorePort,"get">,
):Promise<SourceParseStatusResponse>{
  if(job.status!=="completed")return SourceParseStatusResponseSchema.parse({job});
  if(!job.outputRef){
    return SourceParseStatusResponseSchema.parse({job,resultIssue:"Parse 结果 Artifact 缺失"});
  }
  let blob:Blob|undefined;
  try{blob=await artifacts.get(job.outputRef);}
  catch{
    return SourceParseStatusResponseSchema.parse({job,resultIssue:"Parse 结果 Artifact 暂时不可读取"});
  }
  if(!blob)return SourceParseStatusResponseSchema.parse({job,resultIssue:"Parse 结果 Artifact 缺失"});
  try{
    const artifact=SourceArtifactSchema.parse(JSON.parse(await blob.text()));
    return SourceParseStatusResponseSchema.parse({job,artifact});
  }catch{
    return SourceParseStatusResponseSchema.parse({job,resultIssue:"Parse 结果 Artifact 已损坏或 schema 不兼容"});
  }
}

export async function readSourceParseResults(
  jobs:EvolutionJob[],
  artifacts:Pick<ArtifactStorePort,"get">,
):Promise<SourceParseStatusResponse[]>{
  const items:Array<SourceParseStatusResponse>=new Array(jobs.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{
    while(next<jobs.length){
      const index=next++;
      items[index]=await readSourceParseResult(jobs[index],artifacts);
    }
  }));
  return SourceParseListResponseSchema.parse({items}).items;
}
