import {AiUsageLedgerRecordSchema,type AiUsageLedgerRecord,type AiUsageRequestStarted} from "@evolution/contracts";

/** Request accounting, never a claim of acceptance, elapsed-task benefit or monetary savings. */
export function summarizeAiUsageLedger(input:unknown[]){
  const starts=new Map<string,AiUsageRequestStarted>(),results=new Map<string,Extract<AiUsageLedgerRecord,{kind:"request-result"}>["observation"]>();
  const invalidCallIds=new Set<string>();let invalidRecordCount=0;
  for(const raw of input){
    const parsed=AiUsageLedgerRecordSchema.safeParse(raw);
    if(!parsed.success){invalidRecordCount++;continue;}
    const record=parsed.data;
    if(record.kind==="request-start"){
      const prior=starts.get(record.request.callId);
      if(prior&&JSON.stringify(prior)!==JSON.stringify(record.request))invalidCallIds.add(record.request.callId);
      else starts.set(record.request.callId,record.request);
    }else{
      const prior=results.get(record.observation.request.callId);
      if(prior&&JSON.stringify(prior)!==JSON.stringify(record.observation))invalidCallIds.add(record.observation.request.callId);
      else results.set(record.observation.request.callId,record.observation);
    }
  }
  const unmatchedCallIds=[...starts.keys()].filter(id=>!results.has(id));
  const orphanCallIds=[...results.keys()].filter(id=>!starts.has(id));
  for(const [id,result] of results)if(starts.has(id)&&JSON.stringify(starts.get(id))!==JSON.stringify(result.request))invalidCallIds.add(id);
  const matched=[...results.values()].filter(result=>starts.has(result.request.callId)&&!invalidCallIds.has(result.request.callId));
  const reportedTokens:Partial<Record<"input"|"output"|"total"|"reasoning"|"cacheRead",number>>={};
  let overflow=false;
  for(const result of matched){
    if(result.usage.status==="invalid")continue;
    for(const key of ["input","output","total","reasoning","cacheRead"] as const){
      const count=result.usage.counts[key];if(count===undefined)continue;
      const sum=(reportedTokens[key]??0)+count;
      if(!Number.isSafeInteger(sum))overflow=true;else reportedTokens[key]=sum;
    }
  }
  const ledgerComplete=starts.size>0&&!invalidRecordCount&&!invalidCallIds.size&&!unmatchedCallIds.length&&!orphanCallIds.length;
  const physicalAttempts=[...starts.values()].filter(request=>request.granularity==="physical-http-attempt").length;
  return {schemaVersion:"ai-usage-summary-v1" as const,startedRequests:starts.size,matchedObservations:matched.length,
    physicalHttpAttempts:physicalAttempts,sdkGenerations:starts.size-physicalAttempts,
    transportFailures:matched.filter(result=>result.outcome==="transport-error").length,
    unmatchedCallIds,orphanCallIds,invalidCallIds:[...invalidCallIds],invalidRecordCount,ledgerComplete,
    tokenCoverageComplete:ledgerComplete&&!overflow&&physicalAttempts===starts.size&&matched.every(result=>result.usage.status==="complete"),
    reportedTokens:overflow?undefined:reportedTokens,overflow,
    billingStatus:"unavailable" as const,
    limitations:["Reported token counters exclude missing/invalid observations; they are not an inferred full bill.",
      "SDK generation records do not establish physical retry coverage.",
      "Token usage and request latency do not prove actual monetary cost, accepted delivery or end-to-end business improvement."]};
}
