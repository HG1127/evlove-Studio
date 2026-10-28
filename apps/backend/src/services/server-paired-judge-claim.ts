import {createHash,randomUUID} from "node:crypto";
import {createEvolutionEvent,type AiUsageScope,type EvolutionEvent,type PairedJudgeRequest} from "@evolution/contracts";
import {currentServerAiUsageScope} from "./server-ai-usage";

type Ports={scope:AiUsageScope|undefined;list(missionId:string,limit:number):Promise<EvolutionEvent[]>;append(event:EvolutionEvent):Promise<void>;nonce?():string;now?():string};
const stopped=(reason:string)=>Object.assign(Error(reason),{code:"PAIRED_JUDGE_ATTEMPT_NOT_OWNED"});

/** A durable claim is deliberately not released on failure or unknown remote outcome. */
export async function claimPairedJudgeAttempt(request:PairedJudgeRequest,ports:Ports){
  const scope=ports.scope,c=request.context;
  if(!scope?.missionId||!scope.jobId||scope.missionId!==c.missionId||scope.candidateId&&scope.candidateId!==c.candidateId)throw stopped("Paired scoring needs its trusted Mission/Job scope");
  // Keep the legacy physical key: optional metadata, timestamps and control Job IDs never grant another scoring budget.
  const scopeSha256=createHash("sha256").update(JSON.stringify({protocol:c.protocol,missionId:c.missionId,phase:c.phase,
    bindings:c.bindings.map(({sourceArtifactId,originalSha256,candidateSha256})=>({sourceArtifactId,originalSha256,candidateSha256})).sort((a,b)=>a.sourceArtifactId.localeCompare(b.sourceArtifactId)),criteria:[...request.criteria].sort((a,b)=>a.id.localeCompare(b.id)),testCases:[...request.testCases].sort((a,b)=>a.id.localeCompare(b.id))})).digest("hex");
  const id="evt-paired-judge-claim-"+scopeSha256,read=()=>ports.list(c.missionId,1000);
  const before=await read();
  if(before.some(event=>event.id===id))throw stopped("This paired comparison already started; preserve its result or unknown outcome instead of rerolling");
  if(before.length>=1000)throw stopped("Paired claim lookup is incomplete; no model call was made");
  const nonce=ports.nonce?.()??randomUUID();
  const event=createEvolutionEvent({id,missionId:c.missionId,jobId:scope.jobId,type:"ActionPlanned",source:"server-paired-evidence-judge",at:ports.now?.()??new Date().toISOString(),
    payload:{measurementKind:"paired-judge-claim-v1",ownerNonce:nonce,scopeSha256,inputFingerprint:c.inputFingerprint,protocol:c.protocol,candidateId:c.candidateId,phase:c.phase}});
  // The production append performs insert-ignore plus canonical readback. The second read also protects injected stores that only ignore duplicates.
  await ports.append(event);
  const stored=(await read()).filter(row=>row.id===id);
  if(stored.length!==1||stored[0]!.missionId!==c.missionId||stored[0]!.jobId!==scope.jobId||stored[0]!.source!==event.source||stored[0]!.type!==event.type
    ||Object.entries(event.payload).some(([key,value])=>stored[0]!.payload[key]!==value))throw stopped("Paired claim ownership was not confirmed; no model call was made");
}

export async function reserveServerPairedJudgeAttempt(request:PairedJudgeRequest){
  const scope=currentServerAiUsageScope();if(!scope?.missionId||!scope.jobId)throw stopped("Paired scoring requires durable Mission/Job tracking");
  const {getServerProductionRuntime}=await import("./production-runtime"),runtime=getServerProductionRuntime();
  return claimPairedJudgeAttempt(request,{scope,list:(id,limit)=>runtime.events.list(id,limit),append:event=>runtime.events.append(event)});
}
