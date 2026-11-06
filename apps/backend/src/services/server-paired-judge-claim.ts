import {createHash,randomUUID} from "node:crypto";
import {createEvolutionEvent,PAIRED_JUDGE_POLICY,PairedReassessmentPinSchema,type AiUsageScope,type EvolutionEvent,type PairedJudgeRequest,type EvolveProject} from "@evolution/contracts";
import {currentServerAiUsageScope} from "./server-ai-usage";
import {pairedAdmissionDigest,pairedReassessmentScopeSha256,resolvePairedAttemptIdentity,type PairedAttemptIdentity} from "./server-paired-reassessment";
import {serverExperimentJudgeScope,serverPairedJudgeRequest} from "@evolution/harness";

type Ports={scope:AiUsageScope|undefined;list(missionId:string,limit:number):Promise<EvolutionEvent[]>;append(event:EvolutionEvent):Promise<void>;nonce?():string;now?():string};
const stopped=(reason:string)=>Object.assign(Error(reason),{code:"PAIRED_JUDGE_ATTEMPT_NOT_OWNED"});

type PhysicalScopeInput=Pick<PairedJudgeRequest,"criteria"|"testCases">&{context:Pick<PairedJudgeRequest["context"],"protocol"|"missionId"|"phase">&{
 bindings:Array<Pick<PairedJudgeRequest["context"]["bindings"][number],"sourceArtifactId"|"originalSha256"|"candidateSha256">>}};
export function pairedJudgePhysicalScopeSha256(request:PhysicalScopeInput){
 const c=request.context;
 return createHash("sha256").update(JSON.stringify({protocol:c.protocol,missionId:c.missionId,phase:c.phase,
    bindings:c.bindings.map(({sourceArtifactId,originalSha256,candidateSha256})=>({sourceArtifactId,originalSha256,candidateSha256})).sort((a,b)=>a.sourceArtifactId.localeCompare(b.sourceArtifactId)),criteria:[...request.criteria].sort((a,b)=>a.id.localeCompare(b.id)),testCases:[...request.testCases].sort((a,b)=>a.id.localeCompare(b.id))})).digest("hex");
}

/** A durable claim is deliberately not released on failure or unknown remote outcome. */
export async function claimPairedJudgeAttempt(request:PairedJudgeRequest,ports:Ports,identity?:PairedAttemptIdentity){
  const scope=ports.scope,c=request.context;
  if(!scope?.missionId||!scope.jobId||scope.missionId!==c.missionId||scope.candidateId&&scope.candidateId!==c.candidateId)throw stopped("Paired scoring needs its trusted Mission/Job scope");
  // Keep the legacy physical key: optional metadata, timestamps and control Job IDs never grant another scoring budget.
  const physicalScopeSha256=pairedJudgePhysicalScopeSha256(request);
  if(identity&&identity.physicalScopeSha256!==physicalScopeSha256)throw stopped("Reassessment physical identity differs");
  const scopeSha256=identity?.scopeSha256??physicalScopeSha256;
  if(scopeSha256!==physicalScopeSha256){
    const pin=PairedReassessmentPinSchema.parse(identity?.admission);
    if(pin.missionId!==c.missionId||pin.physicalScopeSha256!==physicalScopeSha256
      ||pairedAdmissionDigest(pin)!==identity?.admissionSha256||pairedReassessmentScopeSha256(physicalScopeSha256,pin.targetScoringRouteFingerprint)!==scopeSha256)
      throw stopped("Reassessment claim identity differs from its registrar pin");
  }
  const id="evt-paired-judge-claim-"+scopeSha256,read=()=>ports.list(c.missionId,1000);
  const before=await read();
  if(before.some(event=>event.id===id))throw stopped("This paired comparison already started; preserve its result or unknown outcome instead of rerolling");
  if(before.length>=1000)throw stopped("Paired claim lookup is incomplete; no model call was made");
  const nonce=ports.nonce?.()??randomUUID();
  const at=ports.now?.()??new Date().toISOString();
  if(identity?.admission&&Date.parse(at)>=Date.parse(identity.admission.expiresAt))throw stopped("Reassessment authorization expired before claim consumption");
  const event=createEvolutionEvent({id,missionId:c.missionId,jobId:scope.jobId,type:"ActionPlanned",source:"server-paired-evidence-judge",at,
    payload:{measurementKind:"paired-judge-claim-v1",ownerNonce:nonce,scopeSha256,inputFingerprint:c.inputFingerprint,protocol:c.protocol,candidateId:c.candidateId,phase:c.phase,
      ...(identity?.admissionSha256?{physicalScopeSha256,admissionSha256:identity.admissionSha256,reassessment:identity.admission}: {})}});
  // The production append performs insert-ignore plus canonical readback. The second read also protects injected stores that only ignore duplicates.
  await ports.append(event);
  const stored=(await read()).filter(row=>row.id===id);
  if(stored.length!==1||stored[0]!.missionId!==c.missionId||stored[0]!.jobId!==scope.jobId||stored[0]!.source!==event.source||stored[0]!.type!==event.type
    ||pairedAdmissionDigest(event.payload)!==pairedAdmissionDigest(stored[0]!.payload))throw stopped("Paired claim ownership was not confirmed; no model call was made");
  if(identity?.admission&&Date.parse(ports.now?.()??new Date().toISOString())>=Date.parse(identity.admission.expiresAt))throw stopped("Reassessment authorization expired during claim confirmation");
}

export async function resolveServerPairedAttemptIdentity(request:PhysicalScopeInput,route?:string,events?:EvolutionEvent[]){
  const physicalScopeSha256=pairedJudgePhysicalScopeSha256(request),rawTrust=process.env.EVOLUTION_PAIRED_REASSESSMENT_TRUST;
  if(!rawTrust?.trim())return {physicalScopeSha256,scopeSha256:physicalScopeSha256};
  const [{getServerProductionRuntime},{resolveServerAiOperationConfig},{serverAiScoringRouteFingerprint},{serverAiUsageRoute}]=await Promise.all([
    import("./production-runtime"),import("./server-ai-connection"),import("./ai-gateway"),import("./server-ai-usage"),
  ]);
  const runtime=getServerProductionRuntime(),config=await resolveServerAiOperationConfig("evaluate-paired");
  if(config?.mode!=="openai-compatible"||!config.protocol)throw stopped("Reassessment requires one explicit evaluator protocol");
  return resolvePairedAttemptIdentity(request,{physicalScopeSha256,rawTrust,
    route:route??await serverAiScoringRouteFingerprint()??"",physicalRoute:serverAiUsageRoute(config,config.protocol,"evaluate-paired"),
    runtimeCommit:process.env.VERCEL_GIT_COMMIT_SHA?.trim()||process.env.EVOLUTION_RUNTIME_COMMIT_SHA?.trim(),
    events:events??await runtime.events.list(request.context.missionId,1000),readJob:id=>runtime.jobs.get(id)});
}

export function serverPairedCandidateAssessmentRequests(project:EvolveProject){
  if(project.stage!=="experiment"||project.experimentPolicy.judgeComparison!==PAIRED_JUDGE_POLICY)return [];
  const selected=project.candidates.filter(candidate=>project.selectedCandidateIds.includes(candidate.id));
  return selected.flatMap(candidate=>{
    const runs=project.experimentRun.executionCheckpoints?.find(checkpoint=>checkpoint.candidateId===candidate.id)?.execution?.runs;
    if(!runs?.length)return [];
    const {judgeCases,effectiveCriteria}=serverExperimentJudgeScope(project,project.evalSuite,runs);
    if(!judgeCases.length||!effectiveCriteria.length)return [];
    return [serverPairedJudgeRequest(project,candidate,project.evalSuite,effectiveCriteria,runs,project.baselineRun.runs,"visible")];
  });
}

/** Inspect existing frozen candidates before browser allocation, Job creation or Original re-scoring. No claim is consumed. */
export async function assertServerPairedCandidateAssessmentReady(project:EvolveProject){
  const inputs=serverPairedCandidateAssessmentRequests(project);
  if(!inputs.length)return;
  const {getServerProductionRuntime}=await import("./production-runtime"),events=await getServerProductionRuntime().events.list(project.id,1000);
  if(events.length>=1000)throw stopped("Paired claim preflight is incomplete; no execution was started");
  for(const input of inputs){
    const identity=await resolveServerPairedAttemptIdentity(input,undefined,events);
    if(events.some(event=>event.id==="evt-paired-judge-claim-"+identity.scopeSha256))
      throw stopped("This paired assessment is occupied; reconcile its original attempt before starting another Job");
  }
}

export async function reserveServerPairedJudgeAttempt(request:PairedJudgeRequest){
  const scope=currentServerAiUsageScope();if(!scope?.missionId||!scope.jobId)throw stopped("Paired scoring requires durable Mission/Job tracking");
  const {getServerProductionRuntime}=await import("./production-runtime"),runtime=getServerProductionRuntime();
  const identity=await resolveServerPairedAttemptIdentity(request);
  return claimPairedJudgeAttempt(request,{scope,list:(id,limit)=>runtime.events.list(id,limit),append:event=>runtime.events.append(event)},identity);
}
