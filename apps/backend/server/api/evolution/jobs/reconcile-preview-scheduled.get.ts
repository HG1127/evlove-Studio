import {createError,defineEventHandler,getHeader} from "nitro/h3";
import {reconcileWorkflowJobs} from "../../../../src/services/job-reconciliation";
import {cleanupArtifactBlobs} from "../../../../src/services/artifact-blob-cleanup";
import {reconcileEventEvidence} from "../../../../src/services/event-evidence-reconciliation";
import {
  scheduledReconciliationAuthorized,
  scheduledReconciliationFailureDiagnostic,
} from "../../../../src/services/scheduled-job-reconciliation";

export default defineEventHandler(async(event)=>{
  const secret=process.env.CRON_SECRET?.trim();
  if(!secret||secret.length<16){
    throw createError({statusCode:503,statusMessage:"Scheduled reconciliation preview is not configured"});
  }
  if(!scheduledReconciliationAuthorized(getHeader(event,"authorization"),secret)){
    throw createError({statusCode:401,statusMessage:"Unauthorized"});
  }

  let jobs:Awaited<ReturnType<typeof reconcileWorkflowJobs>>;
  let artifactBlobs:Awaited<ReturnType<typeof cleanupArtifactBlobs>>;
  let eventEvidence:Awaited<ReturnType<typeof reconcileEventEvidence>>;
  try{
    jobs=await reconcileWorkflowJobs({minAgeSeconds:900,limit:50,repair:false});
  }catch(error){
    console.error("Scheduled Job preview failed",scheduledReconciliationFailureDiagnostic(error));
    throw createError({statusCode:503,statusMessage:"Scheduled reconciliation preview failed"});
  }
  try{
    artifactBlobs=await cleanupArtifactBlobs({limit:50,minAgeSeconds:900,dryRun:true});
  }catch(error){
    console.error("Scheduled Artifact preview failed",scheduledReconciliationFailureDiagnostic(error));
    throw createError({statusCode:503,statusMessage:"Scheduled reconciliation preview failed"});
  }
  try{eventEvidence=await reconcileEventEvidence({limit:10,repair:false});}
  catch(error){
    console.error("Scheduled Event Evidence preview failed",scheduledReconciliationFailureDiagnostic(error));
    throw createError({statusCode:503,statusMessage:"Scheduled reconciliation preview failed"});
  }

  const failed=artifactBlobs.results.filter((result)=>result.status==="failed").length;
  console.info("Scheduled reconciliation preview",{
    jobsInspected:jobs.inspected,
    jobIssues:jobs.issues.length,
    jobsRepaired:jobs.repaired,
    blobsInspected:artifactBlobs.inspected,
    blobsWouldRemove:artifactBlobs.results.filter((result)=>result.status==="would-remove").length,
    blobFailures:failed,
    eventsInspected:eventEvidence.inspected,
    eventMirrorsMissing:eventEvidence.missing,
    eventMirrorFailures:eventEvidence.failed,
  });
  if(failed||eventEvidence.failed){
    throw createError({statusCode:503,statusMessage:"Scheduled reconciliation preview has failed items"});
  }
  return {jobs,artifactBlobs,eventEvidence};
});
