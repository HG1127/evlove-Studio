import JSZip from "jszip";
import { describe,expect,it } from "vitest";
import { loadEnv } from "vite";
import type { TestCase } from "@evolution/contracts";
import { runVercelSandboxCodebaseValidation } from "./vercel-sandbox-adapter";

const live=process.env.RUN_LIVE_SANDBOX==="1";

describe.runIf(live)("Vercel Sandbox live browser regression",()=>{
  it("builds, previews and executes exact Browser Steps in Chromium",async()=>{
    const env=loadEnv("development",process.cwd(),"");
    const oidc=env.VERCEL_OIDC_TOKEN?.trim();
    if(!oidc)throw new Error("VERCEL_OIDC_TOKEN missing; run vercel link first");
    process.env.VERCEL_OIDC_TOKEN=oidc;

    const zip=new JSZip();
    zip.file("package.json",JSON.stringify({
      name:"evolution-browser-live-probe",
      private:true,
      scripts:{build:"node build.mjs",test:"node test.mjs"},
    },null,2));
    zip.file("build.mjs",[
      'import fs from "node:fs";',
      'fs.mkdirSync("dist",{recursive:true});',
      'const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Probe</title></head><body><button id="save">保存</button><p id="status">等待</p><script>document.querySelector("#save").addEventListener("click",()=>{document.querySelector("#status").textContent="已保存"})</script></body></html>`;',
      'fs.writeFileSync("dist/index.html",html);',
      'console.log("BUILD_OK");',
    ].join("\n"));
    zip.file("test.mjs",[
      'import fs from "node:fs";',
      'if(!fs.existsSync("dist/index.html"))process.exit(2);',
      'console.log("TEST_OK");',
    ].join("\n"));

    const archive=await zip.generateAsync({type:"uint8array"});
    const testCase:TestCase={
      id:"browser-live-probe",
      title:"真实 Preview 浏览器交互",
      input:"点击保存并确认状态变化",
      expected:["点击保存后显示已保存"],
      tags:["browser","npm-script:build","npm-script:test"],
      hidden:false,
      criterionIds:[],
      executionMode:"external-runner",
      evidenceScope:"product-behavior",
      browserSteps:[
        {action:"click",selector:"#save"},
        {action:"text",selector:"#status",value:"已保存"},
      ],
    };

    const result=await runVercelSandboxCodebaseValidation({
      id:"browser-live-probe",
      archive,
      testCases:[testCase],
    });

    expect(result.previewHealthy).toBe(true);
    expect(result.browserRuntime).toBe("snapshot");
    expect(result.browserStepsExecuted).toBe(2);
    expect(result.scriptsRun).toContain("build");
    expect(result.scriptsRun).toContain("test");
    expect(result.results[0]?.verificationStatus).toBe("verified");
    expect(result.results[0]?.output).toContain("VERCEL SANDBOX BROWSER EVIDENCE");
  },180_000);
});
