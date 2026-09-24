import {createError,defineEventHandler,getHeader} from "nitro/h3";
import {
  runScheduledJobReconciliation,
  scheduledReconciliationFailureDiagnostic,
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
  let jobs:Awaited<ReturnType<typeof runScheduledJobReconciliation>>;
  try{jobs=await runScheduledJobReconciliation();}
  catch(error){
    console.error("Scheduled Job reconciliation failed",scheduledReconciliationFailureDiagnostic(error));
    throw error;
  }
  if(!serverSupabaseSecureConfigured()){
    throw createError({statusCode:503,statusMessage:"Scheduled Artifact cleanup needs a server credential"});
  }
  let artifactBlobs:Awaited<ReturnType<typeof cleanupArtifactBlobs>>;
  try{artifactBlobs=await cleanupArtifactBlobs({limit:50,minAgeSeconds:900,dryRun:false});}
  catch(error){
    console.error("Scheduled Artifact cleanup failed",scheduledReconciliationFailureDiagnostic(error));
    throw createError({statusCode:503,statusMessage:"Scheduled Artifact cleanup failed"});
  }
  const failed=artifactBlobs.results.filter((result)=>result.status==="failed").length;
  if(failed){
    console.error("Scheduled Artifact cleanup had failed items",{failed});
    throw createError({statusCode:503,statusMessage:"Scheduled Artifact cleanup had failed items"});
  }
  return {jobs,artifactBlobs};
});
