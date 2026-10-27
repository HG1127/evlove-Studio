import {expect,it} from "vitest";
import {AiProviderUsageObservationSchema} from "./ai-usage-contract";

const legacy={schemaVersion:"ai-provider-usage-v1",request:{schemaVersion:"ai-usage-request-v1",callId:"11111111-1111-4111-8111-111111111111",scope:{phase:"plan"},
  route:{operation:"plan",protocol:"chat-completions",model:"model",routeFingerprint:"a".repeat(64)},granularity:"physical-http-attempt",attempt:1,startedAt:"2026-10-27T00:00:00.000Z"},
  completedAt:"2026-10-27T00:00:01.000Z",elapsedMs:1000,outcome:"response",httpStatus:200,usage:{status:"complete",counts:{input:1,output:2,total:3}},billing:{status:"unavailable"}};
it("keeps legacy v1 records byte-identical without inventing completion metadata",()=>{
  const parsed=AiProviderUsageObservationSchema.parse(legacy);
  expect(JSON.stringify(parsed)).toBe(JSON.stringify(legacy));expect(parsed).not.toHaveProperty("completion");
  expect(AiProviderUsageObservationSchema.safeParse({...legacy,completion:{finishReason:"stop"}}).success).toBe(false);
});
it("requires explicit v2 completion observation, including null for unavailable",()=>{
  for(const completion of [null,{finishReason:"length"}]){
    expect(AiProviderUsageObservationSchema.parse({...legacy,schemaVersion:"ai-provider-usage-v2",completion})).toMatchObject({schemaVersion:"ai-provider-usage-v2",completion});
  }
  expect(AiProviderUsageObservationSchema.safeParse({...legacy,schemaVersion:"ai-provider-usage-v2"}).success).toBe(false);
});
it.each([{}, {finishReason:"PRIVATE_TEXT"},{finishReason:"stop",content:"PRIVATE_OUTPUT"}])("rejects unsafe or empty completion metadata %j",completion=>{
  expect(AiProviderUsageObservationSchema.safeParse({...legacy,schemaVersion:"ai-provider-usage-v2",completion}).success).toBe(false);
});
