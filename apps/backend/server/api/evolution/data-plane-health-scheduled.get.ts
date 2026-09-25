import {createError,defineEventHandler,getHeader} from "nitro/h3";
import {getDataPlaneHealth} from "../../../src/services/data-plane-health";
import {probeEvidenceLedgerPage} from "../../../src/services/evidence-ledger";
import {probeOrganizationCapabilitySearchPage} from "../../../src/services/organization-capability";
import {probeOutcomeSampleStore} from "../../../src/services/outcome-sample-store";
import {
  getServerJobByIdempotencyKey,
  listRecentServerParseJobs,
  listServerJobPage,
  listServerMissionEnvelopePage,
  probeServerActiveJobPage,
  probeServerEventPage,
} from "../../../src/services/production-runtime";
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
  let parseRecoveryQuery=false;
  let activeJobPage=false;
  let collectionPages=false;
  let eventPage=false;
  let outcomeSamples=false;
  let evidenceLedgerPage=false;
  let capabilitySearchPage=false;
  let restFailure:ReturnType<typeof scheduledReconciliationFailureDiagnostic>|undefined;
  if(health.status==="ready"){
    try{
      await getServerJobByIdempotencyKey("health-probe:no-such-job");
      directRestJobs=true;
      await listRecentServerParseJobs({
        since:new Date(Date.now()-3_600_000).toISOString(),limit:1,sessionId:"health-probe",
      });
      await listRecentServerParseJobs({
        since:new Date(Date.now()-3_600_000).toISOString(),limit:1,sessionId:"health-probe",
        after:{createdAt:"2026-01-01T00:00:00Z",id:"health-probe-no-such-job"},
      });
      parseRecoveryQuery=true;
      await probeServerActiveJobPage();
      activeJobPage=true;
      await listServerMissionEnvelopePage(undefined,1);
      await listServerJobPage(undefined,undefined,1);
      collectionPages=true;
      await probeServerEventPage();
      eventPage=true;
      await probeOutcomeSampleStore();
      outcomeSamples=true;
      await probeEvidenceLedgerPage();
      evidenceLedgerPage=true;
      await probeOrganizationCapabilitySearchPage();
      capabilitySearchPage=true;
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
    parseRecoveryQuery,
    activeJobPage,
    collectionPages,
    eventPage,
    outcomeSamples,
    evidenceLedgerPage,
    capabilitySearchPage,
    ...(restFailure?{restFailure}:{}),
  });
  if(health.status!=="ready"||!directRestJobs||!parseRecoveryQuery||!activeJobPage||!collectionPages||!eventPage||!outcomeSamples||!evidenceLedgerPage||!capabilitySearchPage){
    throw createError({statusCode:503,statusMessage:"Scheduled data-plane health is not ready"});
  }
  return health;
});
