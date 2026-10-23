import {createHash} from "node:crypto";
import {AiUsageLedgerRecordSchema,type AiUsageLedgerRecord,type EvolutionEvent} from "@evolution/contracts";
import {summarizeAiUsageLedger} from "@evolution/core";

/** Decode only canonical usage events; raw provider or user payloads never become accounting evidence. */
export function decodeServerAiUsageEvents(events:EvolutionEvent[],listingComplete:boolean){
  const records:AiUsageLedgerRecord[]=[],invalidEventIds:string[]=[];
  for(const event of events){
    if(event.source!=="server-ai-usage")continue;
    const parsed=AiUsageLedgerRecordSchema.safeParse(event.payload.record);
    if(!parsed.success){invalidEventIds.push(event.id);continue;}
    const record=parsed.data,request=record.kind==="request-start"?record.request:record.observation.request;
    const at=record.kind==="request-start"?request.startedAt:record.observation.completedAt;
    const expectedHash=createHash("sha256").update(JSON.stringify(record)).digest("hex");
    if(event.type!=="JobProgress"||event.payload.measurementKind!=="ai-usage-ledger-v1"||event.payload.recordSha256!==expectedHash
      ||event.id!==`evt-ai-usage-${request.callId}-${record.kind}`||event.missionId!==request.scope.missionId||event.jobId!==request.scope.jobId
      ||Date.parse(event.at)!==Date.parse(at))invalidEventIds.push(event.id);
    else records.push(record);
  }
  const summary=summarizeAiUsageLedger(records);
  return {records,invalidEventIds,listingComplete,summary,
    usageEvidenceComplete:listingComplete&&!invalidEventIds.length&&summary.tokenCoverageComplete,
    // The current providers have no verified monetary billing adapter.
    monetaryEvidenceComplete:false as const};
}
