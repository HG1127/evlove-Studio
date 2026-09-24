import {createError,defineEventHandler,getHeader} from "nitro/h3";
import {
  runScheduledJobReconciliation,
  scheduledReconciliationAuthorized,
} from "../../../../src/services/scheduled-job-reconciliation";
import {cleanupArtifactBlobs} from "../../../../src/services/artifact-blob-cleanup";
import {serverSupabaseSecureConfigured} from "../../../../src/server-env";

export default defineEventHandler(async(event)=>{
  const secret=process.env.CRON_SECRET?.trim();
  if(!secret||secret.length<16){
    throw createError({statusCode:503,statusMessage:"Scheduled reconciliation is not configured"});
  }
  if(!scheduledReconciliationAuthorized(getHeader(event,"authorization"),secret)){
    throw createError({statusCode:401,statusMessage:"Unauthorized"});
  }
  const jobs=await runScheduledJobReconciliation();
  let artifactBlobs:unknown={status:"unavailable",reason:"Server-only Supabase secret is missing"};
  if(serverSupabaseSecureConfigured()){
    try{artifactBlobs=await cleanupArtifactBlobs({limit:50,minAgeSeconds:900,dryRun:false});}
    catch(error){artifactBlobs={status:"failed",reason:error instanceof Error?error.message:String(error)};}
  }
  return {jobs,artifactBlobs};
});
