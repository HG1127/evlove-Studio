import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {describe,expect,it} from "vitest";
import {SandboxHtmlValidationRequestSchema,TestCaseSchema} from "@evolution/contracts";
import {runVercelSandboxHtmlValidation} from "./vercel-sandbox-html";

/**
 * Actual Vercel Sandbox + Cloud Chromium browser smoke. Opt-in only:
 *   $env:EVOLUTION_SANDBOX_LIVE_AUDIT='1'
 *   pnpm exec vitest run packages/adapters/src/vercel-sandbox-html.live-audit.test.ts
 *
 * This test is not an AI-generated Candidate and is not an accepted Mission.
 * It only proves exact Original + known repaired bytes run in a real cloud
 * browser against independent, executable assertions.
 */
const authorized=process.env.EVOLUTION_SANDBOX_LIVE_AUDIT==="1";
const run=authorized?it:it.skip;
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const positive=TestCaseSchema.parse({
  id:"audit-html-positive-search",title:"输入 alpha 必须出现 Alpha 研究卡片",
  input:"Browser: actual user enters alpha",hidden:true,
  expected:["搜索输入 alpha 后 Alpha 卡片可见","卡片数量为一，计数同步变为 1 页命中"],
  executionMode:"external-runner",evidenceScope:"product-behavior",
  criterionIds:["SEARCH-POSITIVE"],
  browserSteps:[
    {action:"visible",selector:"#slide-1"},
    {action:"fill",selector:"#search",value:"alpha"},
    {action:"visible",selector:"#slide-1"},
    {action:"count",selector:".slide-card:not(.search-hidden)",count:1},
    {action:"text",selector:"#searchCount",value:"1 页命中"},
  ],
});
const resilience=TestCaseSchema.parse({
  id:"audit-html-no-match-reset",title:"无结果计数及清空恢复",
  input:"Browser: query no match then clear the input",hidden:true,
  expected:["无结果时计数为零","清空恢复两张卡片"],
  executionMode:"external-runner",evidenceScope:"product-behavior",
  criterionIds:["SEARCH-RESET"],
  browserSteps:[
    {action:"fill",selector:"#search",value:"__no_matched_research__"},
    {action:"count",selector:".slide-card:not(.search-hidden)",count:0},
    {action:"text",selector:"#searchCount",value:"0 页命中"},
    {action:"fill",selector:"#search",value:""},
    {action:"visible",selector:"#slide-1"},
    {action:"visible",selector:"#slide-2"},
    {action:"count",selector:".slide-card:not(.search-hidden)",count:2},
  ],
});
describe("LIVE authorized cloud Sandbox: original vs isolated repaired HTML",()=>{
  run("checks same-source SHA256 and real Browser Steps without treating broken Original as VERIFIED",async()=>{
    const source=await readFile("e2e/fixtures/search-source.html");
    const original=source.toString("utf8");
    const bug="const matches=query ? false : true;";
    const fix="const matches=query ? card.dataset.search.includes(query) : true;";
    expect(original.split(bug)).toHaveLength(2);
    const repaired=new Uint8Array(Buffer.from(original.replace(bug,fix),"utf8"));
    const originalSha=hash(source),candidateSha=hash(repaired);
    expect(candidateSha).not.toBe(originalSha);
    expect(SandboxHtmlValidationRequestSchema.safeParse({id:"audit-original",html:new Uint8Array(source),expectedSha256:originalSha,testCases:[positive,resilience]}).success).toBe(true);
    expect(SandboxHtmlValidationRequestSchema.safeParse({id:"audit-candidate",html:repaired,expectedSha256:candidateSha,testCases:[positive,resilience]}).success).toBe(true);
    for(const {stage,html,sha} of [
      {stage:"original",html:new Uint8Array(source),sha:originalSha},
      {stage:"candidate",html:repaired,sha:candidateSha},
    ]){
      // Validate this test runner realm before allocating another cloud Sandbox.
      expect(SandboxHtmlValidationRequestSchema.safeParse({id:"audit-realm",html,expectedSha256:sha,testCases:[positive,resilience]}).success).toBe(true);
      const proof=await runVercelSandboxHtmlValidation({
        id:"audit-html-real-cloud-"+stage,
        html,expectedSha256:sha,testCases:[positive,resilience],
      });
      const perTest=proof.results.map(x=>({
        id:x.testCaseId,status:x.verificationStatus,artifactMatches:x.artifactHash===sha,
        error:x.error?.slice(0,150),traceSteps:x.trace.filter(x=>x.stage==="browser").length,
      }));
      console.log("REAL_CLOUD_HTML_BROWSER_PROOF",JSON.stringify({
        stage,sha,previewHealthy:proof.previewHealthy,stepsExecuted:proof.browserStepsExecuted,
        browserRuntime:proof.browserRuntime,results:perTest,
      }));
      expect(proof.artifactHash).toBe(sha);
      expect(proof.results).toHaveLength(2);
      expect(proof.results.every(x=>x.artifactHash===sha)).toBe(true);
      if(stage==="original"){
        expect(proof.results.find(x=>x.testCaseId===positive.id)?.verificationStatus).not.toBe("verified");
        expect(proof.results.find(x=>x.testCaseId===resilience.id)?.verificationStatus).toBe("verified");
      }else{
        expect(proof.previewHealthy).toBe(true);
        expect(proof.browserRuntime).toBe("snapshot");
        expect(proof.browserStepsExecuted).toBeGreaterThanOrEqual(2);
        expect(proof.results.every(x=>x.verificationStatus==="verified")).toBe(true);
      }
    }
  },420_000);
});
