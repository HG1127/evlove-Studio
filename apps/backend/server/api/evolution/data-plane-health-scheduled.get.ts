import {createError,defineEventHandler,getHeader} from "nitro/h3";
import {getDataPlaneHealth} from "../../../src/services/data-plane-health";
import {scheduledReconciliationAuthorized} from "../../../src/services/scheduled-job-reconciliation";

export default defineEventHandler(async(event)=>{
  const secret=process.env.CRON_SECRET?.trim();
  if(!secret||secret.length<16){
    throw createError({statusCode:503,statusMessage:"Scheduled data-plane health is not configured"});
  }
  if(!scheduledReconciliationAuthorized(getHeader(event,"authorization"),secret)){
    throw createError({statusCode:401,statusMessage:"Unauthorized"});
  }

  const health=await getDataPlaneHealth();
  console.info("Scheduled data-plane health",{
    status:health.status,
    database:health.database,
    storage:health.storage,
    artifactCleanup:health.artifactCleanup,
    tables:health.tables,
    blockers:health.blockers,
  });
  if(health.status!=="ready"){
    throw createError({statusCode:503,statusMessage:"Scheduled data-plane health is not ready"});
  }
  return health;
});
