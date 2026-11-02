// @vitest-environment node
import {expect,it} from "vitest";
import {serverAiFormatCorrectionAllowed as allowed,withServerAiOutputPolicy as scope} from "./server-ai-output-policy";

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
