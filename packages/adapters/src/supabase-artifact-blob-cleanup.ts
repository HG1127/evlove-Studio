import {ArtifactBlobTombstoneRowSchema,ArtifactBlobLiveRowSchema,
  ArtifactBlobCleanupMarkerRowSchema,ArtifactBlobExistsSchema,ArtifactIdSchema,
  SupabaseBackendConfigSchema,
  type ArtifactBlobTombstoneRow,type SupabaseBackendConfig} from "@evolution/contracts";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createSupabaseBackendClient} from "./supabase-production-adapter";
import {supabaseTimestampToIso} from "./supabase-timestamp";

export type ArtifactBlobCleanupPort={
  listPending:(olderThan:string,limit:number)=>Promise<ArtifactBlobTombstoneRow[]>;
  hasLivePath:(path:string)=>Promise<boolean>;
  remove:(bucket:string,path:string)=>Promise<void>;
  markRemoved:(artifactId:string,bucket:string,path:string)=>Promise<boolean>;
};

function requireSuccess(error:{message:string}|null,operation:string){
  if(error)throw new Error(`${operation}: ${error.message}`);
}

export function createSupabaseArtifactBlobCleanupPort(
  config:SupabaseBackendConfig,suppliedClient?:SupabaseClient,
):ArtifactBlobCleanupPort{
  const parsedConfig=SupabaseBackendConfigSchema.parse(config);
  const client=suppliedClient??createSupabaseBackendClient(parsedConfig);
  const allowedBucket=parsedConfig.artifactBucket;
  function requireAllowedBucket(bucket:string){
    if(bucket!==allowedBucket)throw new Error("Artifact cleanup bucket does not match the configured bucket");
  }
  return {
    async listPending(olderThan,limit){
      const {data,error}=await client.from("artifact_retention_tombstones")
        .select("artifact_id,bucket,object_path,deleted_at")
        .eq("bucket",allowedBucket).is("blob_deleted_at",null).lte("deleted_at",olderThan)
        .order("deleted_at",{ascending:true}).limit(limit);
      requireSuccess(error,"List Artifact blob tombstones");
      return (data??[]).map((row)=>ArtifactBlobTombstoneRowSchema.parse({...row,deleted_at:supabaseTimestampToIso(row.deleted_at)}));
    },
    async hasLivePath(path){
      const {data,error}=await client.from("artifacts").select("id").eq("object_path",path).limit(1);
      requireSuccess(error,"Check live Artifact path");
      return ArtifactBlobLiveRowSchema.array().parse(data??[]).length>0;
    },
    async remove(bucket,path){
      requireAllowedBucket(bucket);
      const {data:exists,error:existsError}=await client.storage.from(bucket).exists(path);
      requireSuccess(existsError,"Check orphan Artifact blob");
      if(!ArtifactBlobExistsSchema.parse(exists))return;
      const {error}=await client.storage.from(bucket).remove([path]);
      requireSuccess(error,"Remove orphan Artifact blob");
    },
    async markRemoved(artifactId,bucket,path){
      ArtifactIdSchema.parse(artifactId);
      requireAllowedBucket(bucket);
      const {data,error}=await client.from("artifact_retention_tombstones")
        .update({blob_deleted_at:new Date().toISOString()})
        .eq("artifact_id",artifactId).eq("bucket",bucket).eq("object_path",path)
        .is("blob_deleted_at",null).select("artifact_id").maybeSingle();
      requireSuccess(error,"Mark Artifact blob removed");
      return Boolean(ArtifactBlobCleanupMarkerRowSchema.nullable().parse(data));
    },
  };
}
