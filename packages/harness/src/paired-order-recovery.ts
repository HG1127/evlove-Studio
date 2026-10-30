import {PairedOrderObservationSchema,type PairedJudgeRequest} from "@evolution/contracts";
import {fastHash} from "@evolution/core";
const same=(a:string[],b:string[])=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
/** Validate stored model evidence before reuse; an occupied unknown attempt is never made fresh. */
export function inspectPairedOrderObservation(raw:unknown,request:PairedJudgeRequest,route:string,sha256:(value:unknown)=>string){
 const observation=PairedOrderObservationSchema.parse(raw),value=observation.response;
 if(fastHash(observation.context)!==fastHash(request.context)||observation.scoringRouteFingerprint!==route
   ||observation.resultSha256!==sha256(value))throw Error("Persisted paired order request/model/file/paper/hash differs");
 for(const version of value.versions){
  if(!same(version.result.criteria.map(c=>c.criterionId),request.context.criterionIds)
    ||version.result.cases.some(c=>!request.context.testCaseIds.includes(c.testCaseId))
    ||version.result.criteria.some(c=>!same(c.testCaseIds,request.testCases.filter(t=>t.criterionIds.includes(c.criterionId)).map(t=>t.id))))
   throw Error("Persisted paired order criterion/case coverage differs");
 }
 return observation;
}
export function recoverPairedOrderObservations(raw:unknown[],request:PairedJudgeRequest,route:string,sha256:(value:unknown)=>string){
 const observations=raw.map(row=>inspectPairedOrderObservation(row,request,route,sha256));
 if(observations.length>2||new Set(observations.map(o=>o.order)).size!==observations.length)
  throw Error("Persisted paired order identities are duplicated");
 const calls=observations.flatMap(o=>o.responseProvenance.map(p=>p.request.callId));
 if(new Set(calls).size!==calls.length)throw Error("A physical response cannot stand for both paired orders");
 if(observations.length===1)throw Error("Partial paired observation preserved; remaining attempt outcome unconfirmed, no model request may be repeated");
 return observations;
}
