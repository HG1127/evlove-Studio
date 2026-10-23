// @vitest-environment node
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {TestCaseSchema,type SandboxStepResult} from "@evolution/contracts";
import {classifySandboxExecutionEvidence,sandboxExecutedScripts,selectSandboxScriptPlan} from "./sandbox-execution-evidence";

/**
 * This runs actual Node child processes on a generated, disposable fixture.
 * It verifies process-exit to TestCase evidence binding; it is NOT a paid
 * Vercel Sandbox or an independent browser/Hidden Validation run.
 */
describe("real local script process → frozen TestCase evidence boundary",()=>{
  it("records only executed, successful named scripts without cross-crediting another TestCase",()=>{
    const dir=mkdtempSync(join(tmpdir(),"evo-script-evidence-"));
    try{
      mkdirSync(join(dir,"checks"));
      writeFileSync(join(dir,"app.json"),JSON.stringify({checkoutEnabled:true,invoiceEnabled:false}));
      const scripts={
        "verify:checkout":"node checks/checkout.mjs",
        "verify:invoice":"node checks/invoice.mjs",
      };
      writeFileSync(join(dir,"package.json"),JSON.stringify({private:true,scripts}));
      writeFileSync(join(dir,"checks","checkout.mjs"),
        'import assert from "node:assert/strict";import {readFileSync} from "node:fs";'+
        'assert.equal(JSON.parse(readFileSync("app.json","utf8")).checkoutEnabled,true);console.log("checkout verified");');
      writeFileSync(join(dir,"checks","invoice.mjs"),
        'import assert from "node:assert/strict";import {readFileSync} from "node:fs";'+
        'assert.equal(JSON.parse(readFileSync("app.json","utf8")).invoiceEnabled,true);console.log("invoice verified");');
      const cases=[
        TestCaseSchema.parse({id:"checkout",title:"Verify checkout implementation",input:"",expected:[],
          tags:["npm-script:verify:checkout"],criterionIds:[],executionMode:"external-runner",evidenceScope:"implementation"}),
        TestCaseSchema.parse({id:"invoice",title:"Verify invoice implementation",input:"",expected:[],
          tags:["npm-script:verify:invoice"],criterionIds:[],executionMode:"external-runner",evidenceScope:"implementation"}),
      ];
      const packageScripts=JSON.parse(readFileSync(join(dir,"package.json"),"utf8")).scripts as Record<string,string>;
      const plan=selectSandboxScriptPlan(packageScripts,cases);
      expect(plan.scriptsToRun).toEqual(["verify:checkout","verify:invoice"]);
      const steps:SandboxStepResult[]=plan.scriptsToRun.map(name=>{
        const command=packageScripts[name]!;
        // Fixture-owned commands, exact literal script map, no shell expansion.
        assert.match(command,/^node checks\/[a-z]+\.mjs$/);
        const relative=command.slice("node ".length);
        const result=spawnSync(process.execPath,[join(dir,relative)],{
          cwd:dir,encoding:"utf8",timeout:5000,shell:false,
          env:{SYSTEMROOT:process.env.SYSTEMROOT??"",PATH:process.env.PATH??""},
        });
        expect(result.error).toBeUndefined();
        return{id:"script-"+name,phase:"test",command,exitCode:result.status??-1,
          stdout:result.stdout??"",stderr:result.stderr??""};
      });
      expect(steps[0]!.exitCode).toBe(0);
      expect(steps[0]!.stdout).toContain("checkout verified");
      expect(steps[1]!.exitCode).not.toBe(0);
      const observed=sandboxExecutedScripts(steps);
      expect(observed).toEqual({
        attempted:["verify:checkout","verify:invoice"],passed:["verify:checkout"],failed:["verify:invoice"],
      });
      expect(classifySandboxExecutionEvidence({
        testCase:cases[0]!,buildRan:false,testRan:false,e2eRan:false,
        passedScriptNames:observed.passed,
      }).verificationStatus).toBe("verified");
      expect(classifySandboxExecutionEvidence({
        testCase:cases[1]!,buildRan:false,testRan:false,e2eRan:false,
        passedScriptNames:observed.passed,
      })).toMatchObject({verificationStatus:"partial",
        proof:expect.stringContaining("verify:invoice")});
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
});
