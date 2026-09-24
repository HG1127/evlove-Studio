import {createError,defineEventHandler,getHeader} from "nitro/h3";
import {getDataPlaneHealth} from "../../../src/services/data-plane-health";
import {getServerJobByIdempotencyKey} from "../../../src/services/production-runtime";
import {
  scheduledReconciliationAuthorized,
  scheduledReconciliationFailureDiagnostic,
} from "../../../src/services/scheduled-job-reconciliation";

export default defineEventHandler(async(event)=>{
  const secret=process.env.CRON_SECRET?.trim();
  if(!secret||secret.length<16){
    throw createError({statusCode:503,statusMessage:"Scheduled data-plane health is not configured"});
  }
  if(!scheduledReconciliationAuthorized(getHeader(event,"authorization"),secret)){
    throw createError({statusCode:401,statusMessage:"Unauthorized"});
  }

  const health=await getDataPlaneHealth();
  let directRestJobs=false;
  let restFailure:ReturnType<typeof scheduledReconciliationFailureDiagnostic>|undefined;
  if(health.status==="ready"){
    try{
      await getServerJobByIdempotencyKey("health-probe:no-such-job");
      directRestJobs=true;
    }catch(error){
      restFailure=scheduledReconciliationFailureDiagnostic(error);
    }
  }
  console.info("Scheduled data-plane health",{
    status:health.status,
    database:health.database,
    storage:health.storage,
    artifactCleanup:health.artifactCleanup,
    tables:health.tables,
    blockers:health.blockers,
    directRestJobs,
    ...(restFailure?{restFailure}:{}),
  });
  if(health.status!=="ready"||!directRestJobs){
    throw createError({statusCode:503,statusMessage:"Scheduled data-plane health is not ready"});
  }
  return health;
});
