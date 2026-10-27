// @vitest-environment node
import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {AiProviderUsageObservationSchema,AiUsageLedgerRecordSchema,AiUsageRequestStartedSchema,createEvolutionEvent,type AiProviderCompletion,type AiUsageLedgerRecord} from "@evolution/contracts";
import {decodeServerAiUsageEvents} from "./server-ai-usage-events";

function fixture(completion?:AiProviderCompletion|null){
  const request=AiUsageRequestStartedSchema.parse({schemaVersion:"ai-usage-request-v1",callId:"00000000-0000-4000-8000-000000000001",scope:{missionId:"mission",jobId:"job",phase:"baseline"},
    route:{operation:"execute-artifact",protocol:"chat-completions",model:"model",routeFingerprint:"a".repeat(64)},granularity:"physical-http-attempt",attempt:1,startedAt:"2026-10-24T00:00:00.000Z"});
  const records:AiUsageLedgerRecord[]=[{kind:"request-start",request},{kind:"request-result",observation:{schemaVersion:"ai-provider-usage-v1",request,
    completedAt:"2026-10-24T00:00:01.000Z",elapsedMs:1000,outcome:"response",usage:{status:"complete",counts:{input:2,output:3,total:5}},billing:{status:"unavailable"}}}];
  if(completion!==undefined&&records[1]!.kind==="request-result")records[1].observation=AiProviderUsageObservationSchema.parse({...records[1].observation,schemaVersion:"ai-provider-usage-v2",completion});
  return records.map(record=>createEvolutionEvent({id:`evt-ai-usage-${request.callId}-${record.kind}`,missionId:"mission",jobId:"job",type:"JobProgress",source:"server-ai-usage",
    at:record.kind==="request-start"?request.startedAt:record.observation.completedAt,
    payload:{measurementKind:"ai-usage-ledger-v1",record,recordSha256:createHash("sha256").update(JSON.stringify(record)).digest("hex")}}));
}
describe("authoritative usage event readback",()=>{
  it("accepts complete hash-bound records and still refuses a monetary-cost claim",()=>{
    expect(decodeServerAiUsageEvents(fixture(),true)).toMatchObject({invalidEventIds:[],usageEvidenceComplete:true,monetaryEvidenceComplete:false});
    expect(decodeServerAiUsageEvents(fixture(),false).usageEvidenceComplete).toBe(false);
  });
  it.each(["hash","mission","job","id","time","type"])("rejects a mismatched %s event instead of adopting its counters",field=>{
    const events=fixture(),end=events[1]!;
    if(field==="hash")end.payload.recordSha256="f".repeat(64);
    if(field==="mission")end.missionId="other";
    if(field==="job")end.jobId="other";
    if(field==="id")end.id="other";
    if(field==="time")end.at="2026-10-24T00:00:02.000Z";
    if(field==="type")end.type="ValidationPassed";
    const result=decodeServerAiUsageEvents(events,true);
    expect(result.invalidEventIds).toHaveLength(1);expect(result.usageEvidenceComplete).toBe(false);expect(result.summary.ledgerComplete).toBe(false);
  });
  it.each([null,{finishReason:"length" as const}])("reads hash-bound v2 completion %j without strengthening billing evidence",completion=>{
    const decoded=decodeServerAiUsageEvents(fixture(completion),true);
    expect(decoded).toMatchObject({invalidEventIds:[],usageEvidenceComplete:true,monetaryEvidenceComplete:false});
    expect(decoded.records[1]?.kind==="request-result"&&decoded.records[1].observation).toMatchObject({schemaVersion:"ai-provider-usage-v2",completion});
    expect(decoded.summary.reportedTokens).toEqual({input:2,output:3,total:5});
  });
  it("does not adopt a changed completion marker under the original record hash",()=>{
    const events=fixture({finishReason:"length"}),end=events[1]!,record=AiUsageLedgerRecordSchema.parse(end.payload.record);
    if(record.kind!=="request-result"||record.observation.schemaVersion!=="ai-provider-usage-v2"||!record.observation.completion)throw Error("fixture");
    record.observation.completion.finishReason="stop";end.payload.record=record;
    const decoded=decodeServerAiUsageEvents(events,true);
    expect(decoded.invalidEventIds).toEqual([end.id]);expect(decoded.usageEvidenceComplete).toBe(false);
  });
});
