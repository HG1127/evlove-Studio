import {describe,expect,it} from "vitest";
import type {TargetRunResult} from "@evolution/contracts";
import {observedOriginalHtmlBrowserDefect} from "./server-html-artifact-execution";

const sha="a".repeat(64);
const failed:TargetRunResult={
  testCaseId:"test-search",verificationStatus:"failed",cost:0,latencyMs:12,
  artifactHash:sha,error:"Error: 元素不可见：#slide-1",
  output:"VERCEL SANDBOX BROWSER EVIDENCE\nBlocked external resources: none",
  trace:[
    {id:"sha",stage:"sandbox-artifact",status:"pass",summary:"frozen SHA"},
    {id:"preview",stage:"browser-preview",status:"pass",summary:"actual Preview"},
    {id:"assertion",stage:"browser-step",status:"fail",summary:"visible #slide-1",detail:"Error: 元素不可见：#slide-1"},
  ],
};
describe("Cloud HTML original failed assertion is observed negative evidence",()=>{
  it("requires exact SHA and actual Chromium step, never marks the product as passing",()=>{
    const observed=observedOriginalHtmlBrowserDefect(failed,sha,{previewHealthy:true,browserRuntime:"snapshot"});
    expect(observed).toMatchObject({verificationStatus:"verified",artifactHash:sha});
    expect(observed?.error).toBeUndefined();
    expect(observed?.output).toContain("VERIFIED DOCUMENTED BASELINE DEFECT (not product success)");
    expect(observed?.trace).toContainEqual(expect.objectContaining({
      stage:"baseline-exact-browser-negative-evidence",status:"pass",
    }));
  });
  it("refuses missing original identity, unavailable browser and blocked network resources",()=>{
    expect(observedOriginalHtmlBrowserDefect(failed,"b".repeat(64),{previewHealthy:true,browserRuntime:"snapshot"})).toBeUndefined();
    expect(observedOriginalHtmlBrowserDefect(failed,sha,{previewHealthy:false,browserRuntime:"snapshot"})).toBeUndefined();
    expect(observedOriginalHtmlBrowserDefect({...failed,output:failed.output.replace("none","https://unsafe.example")},sha,{previewHealthy:true,browserRuntime:"snapshot"})).toBeUndefined();
    expect(observedOriginalHtmlBrowserDefect({...failed,trace:failed.trace.filter(t=>t.stage!=="browser-step")},sha,{previewHealthy:true,browserRuntime:"snapshot"})).toBeUndefined();
  });
});
