import {ArtifactBlobCleanupRequestSchema,type ArtifactBlobCleanupRequest} from "@evolution/contracts";
import {createSupabaseArtifactBlobCleanupPort,type ArtifactBlobCleanupPort} from "@evolution/adapters";
import {getServerSupabaseConfig,serverSupabaseSecureConfigured} from "../server-env";

export async function cleanupArtifactBlobs(
  raw:unknown,
  suppliedPort?:ArtifactBlobCleanupPort,
  now=new Date(),
){
  const input:ArtifactBlobCleanupRequest=ArtifactBlobCleanupRequestSchema.parse(raw);
  if(!suppliedPort&&!serverSupabaseSecureConfigured()){
    throw new Error("Artifact blob cleanup requires a server-only Supabase secret");
  }
  const port=suppliedPort??createSupabaseArtifactBlobCleanupPort(getServerSupabaseConfig());
  const olderThan=new Date(now.getTime()-input.minAgeSeconds*1000).toISOString();
  const pending=await port.listPending(olderThan,input.limit);
  const results:Array<{artifactId:string;status:"removed"|"would-remove"|"skipped-live"|"failed";detail?:string}>=[];
  for(const item of pending){
    try{
      if(await port.hasLivePath(item.object_path)){
        results.push({artifactId:item.artifact_id,status:"skipped-live"});
        continue;
      }
      if(input.dryRun){
        results.push({artifactId:item.artifact_id,status:"would-remove"});
        continue;
      }
      await port.remove(item.bucket,item.object_path);
      if(!await port.markRemoved(item.artifact_id,item.bucket,item.object_path)){
        throw new Error("Artifact tombstone changed before cleanup was recorded");
      }
      results.push({artifactId:item.artifact_id,status:"removed"});
    }catch(error){
      results.push({artifactId:item.artifact_id,status:"failed",
        detail:error instanceof Error?error.message:String(error)});
    }
  }
  return {checkedAt:now.toISOString(),inspected:pending.length,
    removed:results.filter((item)=>item.status==="removed").length,results};
}
