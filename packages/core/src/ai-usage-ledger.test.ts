import {describe,expect,it} from "vitest";
import {AiUsageRequestStartedSchema,type AiUsageLedgerRecord} from "@evolution/contracts";
import {summarizeAiUsageLedger} from "./ai-usage-ledger";

function pair():AiUsageLedgerRecord[]{
  const request=AiUsageRequestStartedSchema.parse({schemaVersion:"ai-usage-request-v1",callId:"00000000-0000-4000-8000-000000000001",
    scope:{missionId:"mission",jobId:"job",phase:"experiment"},route:{operation:"execute-artifact",protocol:"chat-completions",model:"model",routeFingerprint:"a".repeat(64)},
    granularity:"physical-http-attempt",attempt:1,startedAt:"2026-10-24T00:00:00.000Z"});
  return [{kind:"request-start",request},{kind:"request-result",observation:{schemaVersion:"ai-provider-usage-v1",request,
    completedAt:"2026-10-24T00:00:01.000Z",elapsedMs:1000,outcome:"response",httpStatus:200,
    usage:{status:"complete",counts:{input:10,output:3,total:13,reasoning:2}},billing:{status:"unavailable"}}}];
}
describe("request-level actual usage accounting",()=>{
  it("counts each bound physical request once and separates token evidence from billing or accepted-delivery proof",()=>{
    const records=pair(),summary=summarizeAiUsageLedger([...records,...structuredClone(records)]);
    expect(summary).toMatchObject({startedRequests:1,matchedObservations:1,physicalHttpAttempts:1,ledgerComplete:true,tokenCoverageComplete:true,
      reportedTokens:{input:10,output:3,total:13,reasoning:2},billingStatus:"unavailable"});
    expect(summary).not.toHaveProperty("cost");expect(summary).not.toHaveProperty("costPerAcceptedDelivery");
  });
  it.each(["missing-result","orphan-result","conflicting-result","wrong-scope","invalid-record"])("never treats %s as complete actual cost evidence",kind=>{
    const records=pair();
    if(kind==="missing-result")records.pop();
    if(kind==="orphan-result")records.shift();
    if(kind==="conflicting-result"){const extra=structuredClone(records[1]!);if(extra.kind==="request-result")extra.observation.usage.counts.total=99;records.push(extra);}
    if(kind==="wrong-scope"&&records[1]!.kind==="request-result"){records[1]=structuredClone(records[1]);records[1].observation.request.scope.jobId="other";}
    const input:unknown[]=records;if(kind==="invalid-record")input.push({kind:"request-result"});
    expect(summarizeAiUsageLedger(input)).toMatchObject({ledgerComplete:false,tokenCoverageComplete:false,billingStatus:"unavailable"});
  });
  it.each(["sdk","missing-usage","invalid-usage","transport-error"])("preserves %s uncertainty even with a complete start/end ledger",kind=>{
    const records=pair();if(records[1]!.kind!=="request-result"||records[0]!.kind!=="request-start")throw Error("fixture");
    const observation=records[1]!.observation;
    if(kind==="sdk"){records[0].request.granularity="sdk-generation";observation.request.granularity="sdk-generation";}
    if(kind==="missing-usage")observation.usage={status:"unavailable",counts:{},reason:"missing-usage"};
    if(kind==="invalid-usage")observation.usage={status:"invalid",counts:{},reason:"invalid-fields"};
    if(kind==="transport-error"){observation.outcome="transport-error";observation.usage={status:"unavailable",counts:{},reason:"missing-usage"};}
    expect(summarizeAiUsageLedger(records)).toMatchObject({ledgerComplete:true,tokenCoverageComplete:false,billingStatus:"unavailable"});
  });
  it("does not represent an empty ledger as zero observed usage",()=>{
    expect(summarizeAiUsageLedger([])).toMatchObject({ledgerComplete:false,tokenCoverageComplete:false,reportedTokens:{},billingStatus:"unavailable"});
  });
  it("rejects a forged complete token status with missing counters",()=>{
    const records=pair();if(records[1]!.kind!=="request-result")throw Error("fixture");
    records[1]!.observation.usage={status:"complete",counts:{}};
    expect(summarizeAiUsageLedger(records)).toMatchObject({invalidRecordCount:1,ledgerComplete:false,tokenCoverageComplete:false});
  });
});
