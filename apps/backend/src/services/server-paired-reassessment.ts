import {createHash} from "node:crypto";
import {AiUsageLedgerRecordSchema,PairedReassessmentPinSchema,PairedReassessmentTrustSchema,type AiUsageRoute,type EvolutionEvent,type EvolutionJob,type PairedJudgeRequest,type PairedReassessmentPin} from "@evolution/contracts";

export type PairedAttemptIdentity={physicalScopeSha256:string;scopeSha256:string;admissionSha256?:string;admission?:PairedReassessmentPin};
type Options={physicalScopeSha256:string;route:string;physicalRoute:AiUsageRoute;runtimeCommit:string|undefined;
  rawTrust:string|undefined;events:EvolutionEvent[];readJob(id:string):Promise<EvolutionJob|undefined>;nowMs?:number};
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export const pairedAdmissionDigest=(value:unknown)=>createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const pairedReassessmentScopeSha256=(physicalScopeSha256:string,targetScoringRouteFingerprint:string)=>pairedAdmissionDigest({policy:"qualified-paired-reassessment-v1",physicalScopeSha256,targetScoringRouteFingerprint});
const deny=()=>Object.assign(Error("Qualified evaluator reassessment admission is unavailable or differs"),{code:"PAIRED_REASSESSMENT_NOT_ADMITTED"});
/** Expiry/ENV withdrawal prevents new consumption, but cannot erase an immutable complete pair owned by this Job. */
export function recoverConsumedPairedIdentity(input:{physicalScopeSha256:string;route:string;events:EvolutionEvent[];missionId:string;jobId:string|undefined;inputFingerprint:string}):PairedAttemptIdentity|undefined{
  const scope=pairedReassessmentScopeSha256(input.physicalScopeSha256,input.route),claim=input.events.find(e=>e.id==="evt-paired-judge-claim-"+scope);
  if(!claim)return;
  const pin=PairedReassessmentPinSchema.parse(claim.payload.reassessment);
  if(claim.source!=="server-paired-evidence-judge"||claim.type!=="ActionPlanned"||claim.missionId!==input.missionId||claim.jobId!==input.jobId
    ||claim.payload.scopeSha256!==scope||claim.payload.physicalScopeSha256!==input.physicalScopeSha256||claim.payload.inputFingerprint!==input.inputFingerprint
    ||pin.missionId!==input.missionId||pin.physicalScopeSha256!==input.physicalScopeSha256||pin.targetScoringRouteFingerprint!==input.route
    ||pairedAdmissionDigest(pin)!==claim.payload.admissionSha256||!Number.isFinite(Date.parse(claim.at))||Date.parse(claim.at)>=Date.parse(pin.expiresAt)
    ||input.events.length>=1000)throw deny();
  const orders=input.events.filter(e=>e.id==="evt-paired-order-completed-"+scope+"-0"||e.id==="evt-paired-order-completed-"+scope+"-1");
  if(orders.length!==2||new Set(orders.map(e=>e.id)).size!==2)throw deny();
  // The regular journal subsequently validates owner, context, hashes, routes and complete response provenance for both orders.
  return {physicalScopeSha256:input.physicalScopeSha256,scopeSha256:scope,admissionSha256:pairedAdmissionDigest(pin),admission:pin};
}
/** A pin attests qualification/authorization reviewed by the server registrar, not by the evaluated model.
 * Runtime independently verifies the old failure and every old physical request. No pin means the original lock. */
export async function resolvePairedAttemptIdentity(request:{context:Pick<PairedJudgeRequest["context"],"missionId">},options:Options):Promise<PairedAttemptIdentity>{
  const physical=options.physicalScopeSha256,legacy={physicalScopeSha256:physical,scopeSha256:physical};
  if(!options.rawTrust?.trim())return legacy;
  const trust=PairedReassessmentTrustSchema.parse(JSON.parse(options.rawTrust));
  const matches=trust.pins.filter(pin=>pin.missionId===request.context.missionId&&pin.physicalScopeSha256===physical);
  if(!matches.length)return legacy;
  const pins=matches.filter(pin=>pin.targetScoringRouteFingerprint===options.route);
  if(pins.length!==1)throw deny();
  const pin=pins[0]!;
  if(pin.runtimeCommit!==options.runtimeCommit||Date.parse(pin.expiresAt)<=(options.nowMs??Date.now())
    ||pairedAdmissionDigest(pin.targetPhysicalRoute)!==pairedAdmissionDigest(options.physicalRoute)
    ||options.events.length>=1000)throw deny();
  const old=options.events.find(event=>event.id===pin.priorClaimId);
  if(!old||old.id!=="evt-paired-judge-claim-"+physical||old.missionId!==pin.missionId||old.jobId!==pin.priorJobId
    ||old.source!=="server-paired-evidence-judge"||old.type!=="ActionPlanned"
    ||old.payload.measurementKind!=="paired-judge-claim-v1"||old.payload.scopeSha256!==physical
    ||pairedAdmissionDigest(old.payload)!==pin.priorClaimPayloadSha256)throw deny();
  const failure=options.events.find(event=>event.id===pin.priorFailureEventId);
  if(!failure||failure.jobId!==pin.priorJobId||failure.missionId!==pin.missionId
    ||failure.source!=="vercel-workflow-control"||failure.type!=="JobProgress"
    ||pairedAdmissionDigest(failure.payload)!==pin.priorFailurePayloadSha256
    ||typeof failure.payload.reason!=="string"||!failure.payload.reason.startsWith("[server-campaign-experiment-judge-pending]")
    ||!/JSON.*(?:任务结构|schema)/i.test(failure.payload.reason))throw deny();
  const priorJob=await options.readJob(pin.priorJobId);
  if(priorJob?.id!==pin.priorJobId||priorJob.missionId!==pin.missionId||priorJob.status!=="failed")throw deny();
  // A partial or valid stored paired result is not evidence of an unsent request and cannot be re-scored here.
  if(options.events.some(event=>event.id.startsWith("evt-paired-order-completed-"+physical+"-")))throw deny();
  const from=Date.parse(old.at),until=Date.parse(failure.at);
  if(!Number.isFinite(from)||!Number.isFinite(until)||until<from
    ||options.events.filter(event=>event.jobId===pin.priorJobId&&event.source==="server-paired-evidence-judge"&&Date.parse(event.at)>=from&&Date.parse(event.at)<=until).length!==1)throw deny();
  const records=options.events.filter(event=>event.jobId===pin.priorJobId&&event.source==="server-ai-usage"
    &&Date.parse(event.at)>=from&&Date.parse(event.at)<=until).map(event=>AiUsageLedgerRecordSchema.parse(event.payload.record))
    .filter(record=>(record.kind==="request-start"?record.request:record.observation.request).route.operation==="evaluate-paired");
  const starts=records.filter(record=>record.kind==="request-start"),results=records.filter(record=>record.kind==="request-result");
  if(!starts.length||starts.length!==results.length||new Set(starts.map(s=>s.request.callId)).size!==starts.length)throw deny();
  for(const start of starts){
    const completed=results.filter(result=>result.observation.request.callId===start.request.callId);
    if(completed.length!==1)throw deny();
    const observation=completed[0]!.observation;
    if(pairedAdmissionDigest(start.request)!==pairedAdmissionDigest(observation.request)
      ||start.request.scope.missionId!==pin.missionId||start.request.scope.jobId!==pin.priorJobId
      ||pairedAdmissionDigest(start.request.route)!==pairedAdmissionDigest(pin.priorPhysicalRoute)
      ||observation.outcome!=="response"||observation.httpStatus!==200||observation.responseModel!==pin.priorPhysicalRoute.model
      ||observation.schemaVersion==="ai-provider-usage-v1"||observation.completion?.finishReason!=="stop"
      ||Date.parse(observation.completedAt)>until)throw deny();
  }
  if(Date.parse(pin.expiresAt)<=(options.nowMs??Date.now()))throw deny();
  // Neither authorization IDs, calibration file names, Jobs nor timestamps can create another target budget.
  return {physicalScopeSha256:physical,scopeSha256:pairedReassessmentScopeSha256(physical,options.route),admissionSha256:pairedAdmissionDigest(pin),admission:pin};
}
