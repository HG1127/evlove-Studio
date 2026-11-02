// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {serverAiFormatCorrectionAllowed as allowed,serverAiPairedJsonlEnabled as jsonl,withServerAiOutputPolicy as scope} from "./server-ai-output-policy";
beforeEach(()=>vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT",""));
afterEach(()=>vi.unstubAllEnvs());

it("validates policy before entering work",()=>{
  let entered=false;
  expect(()=>scope({formatCorrection:"typo"},()=>{entered=true;})).toThrow();
  expect(entered).toBe(false);
});
it("isolates concurrent scopes, prevents nested expansion, and restores default after failure",async()=>{
  const results=await Promise.all([
    scope({formatCorrection:"forbid"},async()=>{await Promise.resolve();return scope({formatCorrection:"allow-once"},()=>allowed());}),
    scope({formatCorrection:"allow-once"},async()=>{await Promise.resolve();return allowed();}),
  ]);
  expect(results).toEqual([false,true]);
  await expect(scope({formatCorrection:"forbid"},async()=>{throw Error("stop");})).rejects.toThrow("stop");
  expect(allowed()).toBe(true);
});
it("keeps legacy JSON as default and scopes the server setting to paired operations",()=>{
  expect(jsonl()).toBe(false);vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","json");expect(jsonl()).toBe(false);
  vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","jsonl-v1");expect(jsonl()).toBe(true);
  expect(jsonl("plan")).toBe(false);expect(jsonl("evaluate")).toBe(false);
  expect(scope({formatCorrection:"forbid"},()=>scope({formatCorrection:"allow-once"},()=>({jsonl:jsonl(),correction:allowed()})))).toEqual({jsonl:true,correction:false});
});
it("rejects invalid server settings without silently falling back or echoing them",()=>{
  vi.stubEnv("EVOLUTION_AI_PAIRED_TRANSPORT","private-invalid-value");
  expect(()=>jsonl()).toThrow("Invalid paired AI transport configuration");
  try{jsonl();}catch(error){expect(String(error)).not.toContain("private-invalid-value");}
  expect(()=>scope({formatCorrection:"forbid",pairedTransport:"jsonl-v1"},()=>jsonl())).toThrow();
});
it("retains the explicit diagnostic scope's operation restriction and nested transport",()=>{
  expect(scope({formatCorrection:"forbid",pairedTransport:"jsonl-v1"},()=>scope({formatCorrection:"allow-once"},()=>jsonl()))).toBe(true);
  expect(()=>scope({formatCorrection:"forbid",pairedTransport:"jsonl-v1"},()=>jsonl("plan"))).toThrow("evaluate-paired only");
});
