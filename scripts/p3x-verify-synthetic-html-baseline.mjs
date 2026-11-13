#!/usr/bin/env node
// P3-X: deterministic offline original-file browser baseline; NEVER runs MiniMax.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "@playwright/test";

const dir=join(process.cwd(),"tests/fixtures/p3x-synthetic-task-board");
const htmlPath=join(dir,"original.html");
const original=readFileSync(htmlPath,"utf8");
const mission=JSON.parse(readFileSync(join(dir,"mission.template.json"),"utf8"));
const sha=createHash("sha256").update(original,"utf8").digest("hex");
assert.equal(mission.sourceArtifacts[0].mutationGovernance.parentSha256,sha);
async function run(){
  const browser=await chromium.launch({channel:"chrome",headless:true,timeout:15000});
  const networkRequests=[];
  try{
    const context=await browser.newContext({javaScriptEnabled:true});
    context.on("request",r=>{if(/^https?:\/\//.test(r.url()))networkRequests.push(r.url());});
    const page=await context.newPage();
    const results=[];
    for(const test of mission.evalSuite){
      await page.goto(pathToFileURL(htmlPath).href,{waitUntil:"load"});
      const assertions=[];
      for(const step of test.browserSteps){
        const item=page.locator(step.selector);
        if(step.action==="fill"){await item.fill(step.value);continue;}
        let actual;
        let passed=false;
        if(step.action==="count"){actual=await item.count();passed=actual===step.count;}
        else if(step.action==="text"){actual=(await item.textContent())?.trim();passed=actual===step.value;}
        else if(step.action==="visible"){actual=await item.isVisible();passed=actual===true;}
        else throw new Error("Unsupported browser assertion action");
        assertions.push({action:step.action,selector:step.selector,
          ...(step.action==="count"?{expected:step.count}:{expected:step.action==="visible"?true:step.value}),
          actual,passed});
      }
      results.push({testCaseId:test.id,passed:assertions.every(x=>x.passed),assertions});
    }
    await context.close();
    const protection=results.find(t=>t.testCaseId==="V-PRESERVE");
    const missingFeature=results.find(t=>t.testCaseId==="V-ALPHA");
    assert.equal(protection?.passed,true,"Original protected board is not present");
    assert.equal(missingFeature?.passed,false,"Synthetic source unexpectedly already meets filtering goal");
    const visibleCount=missingFeature.assertions.find(x=>x.selector===".task-card:not([hidden])");
    const liveCount=missingFeature.assertions.find(x=>x.selector==="#result-count");
    assert.equal(visibleCount?.actual,3);
    assert.equal(visibleCount?.expected,1);
    assert.equal(liveCount?.actual,"3 tasks");
    assert.equal(liveCount?.expected,"1 task");
    assert.deepEqual(networkRequests,[],"No external resources or requests are permitted in the synthetic baseline");
    const observation={
      schemaVersion:"p3x-original-html-browser-observation-v1",
      status:"baseline-defect-reproduced",mode:"offline-source-only",
      missionId:mission.id,sourceSha256:sha,
      browser:"installed-chrome-headless",
      providerModelCalls:0,labDatabaseWrites:0,
      tests:results,
      hiddenCasesExecuted:false,independentFinalExecuted:false,externalRequests:networkRequests.length,
      caveat:"Only this original source file was evaluated. No AI Candidate, Judge, Hidden, independent Final, or Gate F was executed."
    };
    const target=join(dir,"baseline-visible-observation.json");
    const content=JSON.stringify(observation,null,2)+"\n";
    if(existsSync(target)){
      assert.equal(readFileSync(target,"utf8"),content,"Browser evidence changed; review before overwriting");
    }else writeFileSync(target,content,{flag:"wx",encoding:"utf8"});
    console.log(JSON.stringify({status:observation.status,missionId:mission.id,
      originalTitlePreserved:true,matchingQueryVisible:visibleCount.actual,
      desiredMatchingQueryVisible:visibleCount.expected,liveCount:liveCount.actual,
      desiredLiveCount:liveCount.expected,externalRequests:0,providerCalls:0}));
  }finally{await browser.close();}
}
await run();
