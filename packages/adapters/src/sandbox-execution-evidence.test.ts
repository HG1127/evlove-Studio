import {describe,expect,it} from "vitest";
import {TestCaseSchema,type SandboxStepResult} from "@evolution/contracts";
import {classifySandboxBrowserWithScripts,classifySandboxCaseFailure,classifySandboxExecutionEvidence,needsSandboxBehaviorExecution,sandboxCaseScriptTrace,sandboxExecutedScripts,sandboxTestIntent,sandboxTestScriptBindings,selectSandboxScriptPlan} from "./sandbox-execution-evidence";

function testCase(title:string,evidenceScope:"implementation"|"product-behavior"="implementation",browserSteps?:Array<{action:"click";selector:string}>){
  return TestCaseSchema.parse({
    id:"sandbox-proof",title,input:title,expected:[],tags:[],criterionIds:[],
    executionMode:"external-runner",evidenceScope,
    ...(browserSteps?{browserSteps}:{}),
  });
}
describe("Sandbox execution evidence is bound to exact requested intent",()=>{
  it("never marks generic script success VERIFIED without a concrete build/test/e2e requirement",()=>{
    const test=testCase("Inspect implementation quality");
    expect(sandboxTestIntent(test)).toMatchObject({build:false,typecheck:false,test:false,integration:false,e2e:false});
    expect(classifySandboxExecutionEvidence({testCase:test,buildRan:true,testRan:true,e2eRan:true}).verificationStatus).toBe("partial");
  });
  it("requires every explicitly requested build and test stage to have passed",()=>{
    const test=testCase("Build and test the package");
    expect(classifySandboxExecutionEvidence({testCase:test,buildRan:true,testRan:false,e2eRan:false}).verificationStatus).toBe("partial");
    expect(classifySandboxExecutionEvidence({testCase:test,buildRan:true,testRan:true,e2eRan:false}).verificationStatus).toBe("verified");
    // E2E success must not stand in for an explicitly requested test script.
    expect(classifySandboxExecutionEvidence({testCase:test,buildRan:true,testRan:false,e2eRan:true}).verificationStatus).toBe("partial");
    expect(classifySandboxExecutionEvidence({testCase:test,buildRan:false,testRan:true,e2eRan:false}).verificationStatus).toBe("partial");
  });
  it("selects only real requested typecheck/integration scripts and never aliases integration as explicit E2E",()=>{
    const typecheck=testCase("Run TypeScript typecheck");
    expect(selectSandboxScriptPlan({build:"vite build",test:"vitest",typecheck:"tsc --noEmit"},[typecheck]))
      .toMatchObject({scriptsToRun:["build","test","typecheck"],typecheckScript:"typecheck"});
    expect(selectSandboxScriptPlan({build:"vite build",test:"vitest"},[typecheck]).typecheckScript).toBeUndefined();
    const integration=testCase("Run integration tests");
    expect(selectSandboxScriptPlan({test:"vitest",integration:"vitest run integration"},[integration]))
      .toMatchObject({scriptsToRun:["test","integration"],integrationScript:"integration",e2eScript:undefined});
    const e2e=testCase("E2E browser workflow");
    expect(selectSandboxScriptPlan({test:"vitest",integration:"vitest integration"},[e2e]).e2eScript).toBeUndefined();
    expect(selectSandboxScriptPlan({test:"vitest",e2e:"playwright test"},[e2e]).e2eScript).toBe("e2e");
  });
  it("requires typecheck and integration scripts independently of build/unit tests",()=>{
    const typecheck=testCase("Run TypeScript typecheck");
    expect(sandboxTestIntent(typecheck)).toMatchObject({build:false,typecheck:true,test:false});
    expect(classifySandboxExecutionEvidence({testCase:typecheck,buildRan:true,testRan:true,e2eRan:false}).verificationStatus).toBe("partial");
    expect(classifySandboxExecutionEvidence({testCase:typecheck,buildRan:true,testRan:true,e2eRan:false,typecheckRan:true}).verificationStatus).toBe("verified");
    const integration=testCase("Run integration tests");
    expect(sandboxTestIntent(integration)).toMatchObject({test:false,integration:true});
    expect(classifySandboxExecutionEvidence({testCase:integration,buildRan:true,testRan:true,e2eRan:false}).verificationStatus).toBe("partial");
    expect(classifySandboxExecutionEvidence({testCase:integration,buildRan:true,testRan:true,e2eRan:false,integrationRan:true}).verificationStatus).toBe("verified");
  });
  it("requires the requested E2E script and schedules behavior execution even for implementation-scoped tests",()=>{
    const test=testCase("E2E browser workflow");
    expect(needsSandboxBehaviorExecution(test)).toBe(true);
    expect(classifySandboxExecutionEvidence({testCase:test,buildRan:true,testRan:true,e2eRan:false}).verificationStatus).toBe("partial");
    const genericSuite=classifySandboxExecutionEvidence({testCase:test,buildRan:true,testRan:true,e2eRan:true});
    expect(genericSuite.verificationStatus).toBe("partial");
    expect(genericSuite.proof).toContain("当前 TestCase");
  });
  it("never promotes product behavior to VERIFIED from build/test scripts alone",()=>{
    const test=testCase("Build and test the app","product-behavior");
    expect(classifySandboxExecutionEvidence({testCase:test,buildRan:true,testRan:true,e2eRan:true}).verificationStatus).toBe("partial");
  });
  it("distinguishes specialized E2E/integration testing from independently requested unit tests",()=>{
    expect(sandboxTestIntent(testCase("浏览器端到端测试"))).toMatchObject({e2e:true,test:false});
    expect(sandboxTestIntent(testCase("Run integration tests"))).toMatchObject({integration:true,test:false});
    expect(sandboxTestIntent(testCase("执行集成测试"))).toMatchObject({integration:true,test:false});
    expect(sandboxTestIntent(testCase("Run E2E tests and unit tests"))).toMatchObject({e2e:true,test:true});
    expect(sandboxTestIntent(testCase("执行集成测试和单元测试"))).toMatchObject({integration:true,test:true});
  });
  it("does not require a project E2E script for a Browser-only Chinese TestCase",()=>{
    const browser=testCase("在浏览器点击保存按钮","product-behavior",[{action:"click",selector:"#save"}]);
    expect(sandboxTestIntent(browser)).toMatchObject({browser:true,e2e:false});
    const plan=selectSandboxScriptPlan({build:"vite build",test:"vitest run"},[browser]);
    expect(plan).toMatchObject({needsBehavior:true,e2eScript:undefined});
    expect(classifySandboxBrowserWithScripts({testCase:browser,browserStatus:"verified",
      buildRan:false,typecheckRan:false,testRan:false,integrationRan:false,e2eRan:false,e2eFailed:false}))
      .toEqual({verificationStatus:"verified",missing:[]});
    const explicit=testCase("浏览器端到端测试","product-behavior",[{action:"click",selector:"#save"}]);
    expect(sandboxTestIntent(explicit).e2e).toBe(true);
    expect(classifySandboxBrowserWithScripts({testCase:explicit,browserStatus:"verified",
      buildRan:false,typecheckRan:false,testRan:false,integrationRan:false,e2eRan:false,e2eFailed:false}))
      .toMatchObject({verificationStatus:"partial",missing:["e2e"]});
  });
  it("combines real browser assertions with every requested Build/Typecheck script",()=>{
    const test=testCase("Build and TypeScript typecheck the page","implementation",[{action:"click",selector:"#save"}]);
    const evidence={testCase:test,browserStatus:"verified" as const,buildRan:true,
      typecheckRan:false,testRan:true,integrationRan:false,e2eRan:false,e2eFailed:false};
    expect(classifySandboxBrowserWithScripts(evidence)).toMatchObject({verificationStatus:"partial",missing:["typecheck"]});
    expect(classifySandboxBrowserWithScripts({...evidence,typecheckRan:true})).toEqual({verificationStatus:"verified",missing:[]});
    expect(classifySandboxBrowserWithScripts({...evidence,browserStatus:"failed"})).toEqual({verificationStatus:"failed",missing:[]});
  });
  it("does not mistake a Browser assertion for a requested project E2E test",()=>{
    const test=testCase("E2E browser workflow","product-behavior",[{action:"click",selector:"#save"}]);
    const evidence={testCase:test,browserStatus:"verified" as const,buildRan:true,
      typecheckRan:false,testRan:true,integrationRan:false,e2eRan:false,e2eFailed:false};
    expect(classifySandboxBrowserWithScripts(evidence)).toMatchObject({verificationStatus:"partial",missing:["e2e"]});
    expect(classifySandboxBrowserWithScripts({...evidence,e2eRan:true})).toEqual({verificationStatus:"verified",missing:[]});
    expect(classifySandboxBrowserWithScripts({...evidence,e2eRan:true,e2eFailed:true})).toMatchObject({verificationStatus:"partial",missing:["failed e2e"]});
  });
  it("still accepts a verified browser-only TestCase without invented script requirements",()=>{
    const test=testCase("Click save","product-behavior",[{action:"click",selector:"#save"}]);
    expect(classifySandboxBrowserWithScripts({testCase:test,browserStatus:"verified",
      buildRan:false,typecheckRan:false,testRan:false,integrationRan:false,e2eRan:false,e2eFailed:false}))
      .toEqual({verificationStatus:"verified",missing:[]});
  });
  it("runs and verifies a TestCase explicitly bound to one exact package.json script",()=>{
    const checkout={...testCase("Verify checkout implementation"),tags:["npm-script:verify:checkout"]};
    const other={...testCase("Verify invoice implementation"),tags:["npm-script:verify:invoice"]};
    const scripts={build:"vite build",test:"vitest run", "verify:checkout":"node checks/checkout.mjs",
      "verify:invoice":"node checks/invoice.mjs"};
    const plan=selectSandboxScriptPlan(scripts,[checkout,other]);
    expect(plan.scriptsToRun).toEqual(["build","test","verify:checkout","verify:invoice"]);
    expect(sandboxTestIntent(checkout)).toMatchObject({build:false,test:false,e2e:false});
    const fromCheckout=classifySandboxExecutionEvidence({testCase:checkout,buildRan:true,testRan:true,
      e2eRan:false,passedScriptNames:["verify:checkout"]});
    expect(fromCheckout.verificationStatus).toBe("verified");
    expect(classifySandboxExecutionEvidence({testCase:other,buildRan:true,testRan:true,
      e2eRan:false,passedScriptNames:["verify:checkout"]})).toMatchObject({
        verificationStatus:"partial",proof:expect.stringContaining("verify:invoice"),
      });
  });
  it("requires exact E2E script and keeps a generic passing E2E suite partial",()=>{
    const linked={...testCase("Run E2E checkout script"),tags:["npm-script:e2e:checkout"]};
    const scripts={build:"vite build",test:"vitest run",e2e:"playwright test",
      "e2e:checkout":"playwright test checkout.spec.ts"};
    const plan=selectSandboxScriptPlan(scripts,[linked]);
    expect(plan.e2eScript).toBe("e2e:checkout");
    expect(plan.scriptsToRun).not.toContain("e2e:checkout");
    expect(classifySandboxExecutionEvidence({testCase:linked,buildRan:true,testRan:true,
      e2eRan:true,passedScriptNames:["e2e"]}).verificationStatus).toBe("partial");
    expect(classifySandboxExecutionEvidence({testCase:linked,buildRan:true,testRan:true,
      e2eRan:true,passedScriptNames:["e2e:checkout"]}).verificationStatus).toBe("verified");
  });
  it("does not schedule unsafe, nonexistent or unexecuted bound scripts",()=>{
    const invalid={...testCase("Verify checkout"),tags:["npm-script:verify:checkout;rm -rf"]};
    expect(sandboxTestScriptBindings(invalid)).toMatchObject({valid:[],invalid:expect.arrayContaining(["npm-script:verify:checkout;rm -rf"])});
    expect(selectSandboxScriptPlan({"verify:checkout":"node checks/checkout.mjs"},[invalid]).scriptsToRun).toEqual([]);
    expect(classifySandboxExecutionEvidence({testCase:invalid,buildRan:true,testRan:true,e2eRan:false})
      .verificationStatus).toBe("partial");
    const missing={...testCase("Verify invoice"),tags:["npm-script:verify:invoice"]};
    expect(selectSandboxScriptPlan({},[missing]).scriptsToRun).toEqual([]);
    expect(classifySandboxBrowserWithScripts({testCase:missing,browserStatus:"verified",buildRan:true,
      typecheckRan:true,testRan:true,integrationRan:true,e2eRan:true,e2eFailed:false,
      passedScriptNames:["verify:checkout"]})).toMatchObject({verificationStatus:"partial",missing:["verify:invoice"]});
  });
  it("reports only genuinely attempted scripts and the precise ones that passed",()=>{
    const step=(id:string,exitCode:number)=>({id,phase:"test" as const,command:"npm run "+id,
      exitCode,stdout:"",stderr:""});
    expect(sandboxExecutedScripts([step("install",0),step("script-build",0),
      step("script-verify:checkout",0),step("script-verify:invoice",1)]))
      .toEqual({attempted:["build","verify:checkout","verify:invoice"],passed:["build","verify:checkout"],failed:["verify:invoice"]});
  });
  it("keeps per-TestCase script trace bound to exit code and frozen artifact SHA",()=>{
    const linked={...testCase("Verify checkout"),tags:["npm-script:verify:checkout"]};
    const step=(exitCode:number)=>({id:"script-verify:checkout",phase:"test" as const,
      command:"npm run verify:checkout",exitCode,stdout:"",stderr:""});
    const complete=sandboxCaseScriptTrace(linked,[step(0)],"frozen-sha-123");
    expect(complete).toHaveLength(1);
    expect(complete[0]).toMatchObject({stage:"script-binding",status:"pass",
      summary:expect.stringContaining("verify:checkout"),
      detail:expect.stringContaining("frozen-sha-123")});
    expect(JSON.parse(complete[0]!.detail!)).toMatchObject({testCaseId:"sandbox-proof",
      scriptName:"verify:checkout",stepId:"script-verify:checkout",exitCodes:[0]});
    const repeated=[step(0),step(1)];
    expect(sandboxExecutedScripts(repeated)).toEqual({attempted:["verify:checkout"],passed:[],failed:["verify:checkout"]});
    expect(sandboxCaseScriptTrace(linked,repeated,"frozen-sha-123")[0]?.status).toBe("fail");
    expect(classifySandboxExecutionEvidence({testCase:linked,buildRan:true,testRan:true,
      e2eRan:false,passedScriptNames:sandboxExecutedScripts(repeated).passed}).verificationStatus).toBe("partial");
  });
  it("combines case-specific browser assertions with an exact bound script",()=>{
    const linked={...testCase("Click checkout","product-behavior",[{action:"click",selector:"#buy"}]),
      tags:["npm-script:verify:checkout"]};
    const base={testCase:linked,browserStatus:"verified" as const,buildRan:false,
      typecheckRan:false,testRan:false,integrationRan:false,e2eRan:false,e2eFailed:false};
    expect(classifySandboxBrowserWithScripts(base)).toMatchObject({verificationStatus:"partial",missing:["verify:checkout"]});
    expect(classifySandboxBrowserWithScripts({...base,passedScriptNames:["verify:checkout"]}))
      .toEqual({verificationStatus:"verified",missing:[]});
  });
  it("attributes a failing exact script only to its bound TestCase",()=>{
    const checkout={...testCase("Verify checkout"),tags:["npm-script:verify:checkout"]};
    const invoice={...testCase("Verify invoice"),tags:["npm-script:verify:invoice"]};
    const failedCheckout:SandboxStepResult={id:"script-verify:checkout",phase:"test",
      command:"npm run verify:checkout",exitCode:1,stdout:"",stderr:"assertion failed"};
    expect(classifySandboxCaseFailure({testCase:checkout,steps:[failedCheckout]}))
      .toMatchObject({verificationStatus:"failed",reason:expect.stringContaining("verify:checkout")});
    expect(classifySandboxCaseFailure({testCase:invoice,steps:[failedCheckout]}))
      .toMatchObject({verificationStatus:"unverified",reason:expect.stringContaining("共享前置")});
  });
  it("does not label a TestCase failed when install/build blocked its own script from running",()=>{
    const checkout={...testCase("Verify checkout"),tags:["npm-script:verify:checkout"]};
    const installFailure:SandboxStepResult={id:"install",phase:"install",command:"pnpm install",
      exitCode:1,stdout:"",stderr:"registry unavailable"};
    expect(classifySandboxCaseFailure({testCase:checkout,steps:[installFailure]}))
      .toMatchObject({verificationStatus:"unverified",reason:expect.stringContaining("依赖安装")});
    const buildFailure:SandboxStepResult={id:"script-build",phase:"build",command:"pnpm run build",
      exitCode:1,stdout:"",stderr:"compile failed"};
    expect(classifySandboxCaseFailure({testCase:checkout,steps:[buildFailure]}))
      .toMatchObject({verificationStatus:"unverified",reason:expect.stringContaining("共享前置步骤")});
    expect(classifySandboxCaseFailure({testCase:testCase("Build the package"),steps:[buildFailure]}))
      .toMatchObject({verificationStatus:"failed",reason:expect.stringContaining("build")});
  });
  it("treats a Runner exception without a failed target assertion as UNVERIFIED",()=>{
    const checkout={...testCase("Verify checkout"),tags:["npm-script:verify:checkout"]};
    expect(classifySandboxCaseFailure({testCase:checkout,steps:[],error:"Sandbox create timeout"}))
      .toMatchObject({verificationStatus:"unverified",reason:expect.stringContaining("Sandbox create timeout")});
  });
  it("attributes generic unit-test failure only to TestCases that requested unit tests",()=>{
    const unitTest=testCase("Run unit tests");
    const checkout={...testCase("Verify checkout"),tags:["npm-script:verify:checkout"]};
    const failed:SandboxStepResult={id:"script-test",phase:"test",command:"npm test",exitCode:1,stdout:"",stderr:"failed"};
    expect(classifySandboxCaseFailure({testCase:unitTest,steps:[failed]})).toMatchObject({verificationStatus:"failed"});
    expect(classifySandboxCaseFailure({testCase:checkout,steps:[failed]})).toMatchObject({verificationStatus:"unverified"});
  });
  it("marks a failed exact bound script as FAILED even when the browser assertion itself passed",()=>{
    const linked={...testCase("Click checkout","product-behavior",[{action:"click",selector:"#buy"}]),
      tags:["npm-script:verify:checkout"]};
    expect(classifySandboxBrowserWithScripts({testCase:linked,browserStatus:"verified",buildRan:true,
      typecheckRan:false,testRan:true,integrationRan:false,e2eRan:false,e2eFailed:false,
      passedScriptNames:[],failedScriptNames:["verify:checkout"]}))
      .toMatchObject({verificationStatus:"failed",missing:["failed script verify:checkout"]});
  });
  it("leaves requested browser steps unverified until the dedicated browser runner returns them",()=>{
    const test=testCase("Build and test the page","implementation",[{action:"click",selector:"#save"}]);
    expect(needsSandboxBehaviorExecution(test)).toBe(true);
    expect(classifySandboxExecutionEvidence({testCase:test,buildRan:true,testRan:true,e2eRan:false}).verificationStatus).toBe("unverified");
  });
});
