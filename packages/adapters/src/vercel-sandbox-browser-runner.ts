import { BROWSER_ASSERTION_ACTIONS, type TestCase } from "@evolution/contracts";
import { VERCEL_SANDBOX_TYPED_BROWSER_STEP_RUNTIME_SCRIPT } from "./vercel-sandbox-browser-step-runtime";
import { VERCEL_SANDBOX_NATIVE_COPY_RUNTIME_SCRIPT } from "./vercel-sandbox-browser-copy-runtime";
import { VERCEL_SANDBOX_ISOLATED_BROWSER_OBSERVER_SCRIPT } from "./vercel-sandbox-browser-isolated-observer";

/** Bounded batch budget includes navigation and every existing action deadline. */
export function sandboxBrowserCommandTimeoutMs(testCases: Pick<TestCase, "browserSteps">[]): number {
  const work = testCases.reduce((total, test) => total + 15_000 + (test.browserSteps?.length ?? 0) * 7_000 + 10_000, 0);
  return Math.min(180_000, Math.max(30_000, 20_000 + work));
}

/** Trusted runtime installed in the versioned Sandbox browser cache. */
export const VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT = String.raw`
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "../browser/node_modules/playwright/index.mjs";
import { expect } from "../browser/node_modules/playwright/test.mjs";
const cases=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const baseUrl=process.argv[3];
const baseOrigin=new URL(baseUrl).origin;

`
  + "const BROWSER_ASSERTION_ACTIONS=" + JSON.stringify(BROWSER_ASSERTION_ACTIONS) + ";\n"
  + VERCEL_SANDBOX_TYPED_BROWSER_STEP_RUNTIME_SCRIPT + "\n"
  + VERCEL_SANDBOX_NATIVE_COPY_RUNTIME_SCRIPT + "\n"
  + VERCEL_SANDBOX_ISOLATED_BROWSER_OBSERVER_SCRIPT + "\n"
  + String.raw`
const browser=await chromium.launch({headless:true});
const results=[];
for(const testCase of cases){
  const started=Date.now();
  const trace=[];const errors=[];const blocked=[];const screenshots=[];
  const clipboardProbeUrl=new URL("/.evolution/clipboard-probe-"+randomUUID(),baseOrigin).href;
  const context=await browser.newContext({serviceWorkers:"block",acceptDownloads:false,viewport:{width:1440,height:960}});
  try{
    await context.route("**/*",route=>{
      const url=route.request().url();
      if(url===clipboardProbeUrl&&route.request().method()==="GET")return route.fulfill({
        contentType:"text/html; charset=utf-8",body:"<!doctype html><html><head><title>Trusted Clipboard Probe</title></head><body></body></html>",
        headers:{"Content-Security-Policy":"default-src 'none'; script-src 'none'; style-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'"},
      });
      try{
        const parsed=new URL(url);
        if(parsed.origin===baseOrigin||parsed.protocol==="data:"||parsed.protocol==="blob:")return route.continue();
      }catch{}
      blocked.push(url);return route.abort();
    });
    const page=await context.newPage();
    page.setDefaultTimeout(7000);
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto(baseUrl,{waitUntil:"domcontentloaded",timeout:15000});
    trace.push({id:"open",stage:"browser-preview",status:"pass",summary:"真实 Preview 已在 Chromium 打开"});
    let failed,unavailable,assertions=0;
    if(!Array.isArray(testCase.browserSteps??[])||(testCase.browserSteps??[]).length>24)
      throw browserCapabilityError("Browser steps exceed bounded protocol");
    for(const [index,step] of (testCase.browserSteps||[]).entries()){
      try{
        validateFixedBrowserStep(step);
        const locator=page.locator(step.selector);
        let observation;
        if(step.action==="click")await locator.click();
        else if(step.action==="fill")await locator.fill(step.value);
        // Retry only observations. The preceding action is executed exactly once.
        else if(step.action==="visible")await expect(locator).toBeVisible({timeout:7000})
          .catch(()=>{throw new Error("元素不可见："+step.selector);});
        else if(step.action==="text")await expect(locator).toContainText(
          new RegExp(step.value.replace(/[\\^$.*+?()[\]{}|]/g,"\\$&")),
          {timeout:7000,useInnerText:true},
        ).catch(()=>{throw new Error("文本断言未通过："+step.selector);});
        else if(step.action==="count")await expect(locator).toHaveCount(step.count,{timeout:7000})
          .catch(()=>{throw new Error("数量断言未通过："+step.selector);});
        else observation=await runFixedTypedBrowserStep({page,context,locator,step,clipboardProbeUrl});
        if(BROWSER_ASSERTION_ACTIONS.includes(step.action))assertions++;
        trace.push({id:"step-"+index,stage:"browser-step",status:"pass",summary:step.action+" "+step.selector,
          ...(observation?{detail:JSON.stringify(observation)}:{})});
      }catch(error){
        const message=String(error);
        if(error?.code==="BROWSER_CAPABILITY_UNAVAILABLE")unavailable=message;
        else failed=message;
        trace.push({id:"step-"+index,stage:"browser-step",status:unavailable?"warning":"fail",summary:step.action+" "+step.selector,detail:message});
        break;
      }
    }
    for(const viewport of [{name:"desktop",width:1440,height:900},{name:"mobile",width:390,height:844}]){
      await page.setViewportSize({width:viewport.width,height:viewport.height});
      let layout;
      try{layout=await observeFixedBrowserFacts(context,page,{action:"layout",selector:"html"});}
      catch(error){
        unavailable=String(error);
        trace.push({id:"viewport-"+viewport.width,stage:"layout",status:"warning",summary:"Isolated layout observation unavailable",detail:unavailable});
        continue;
      }
      trace.push({id:"viewport-"+viewport.width,stage:"layout",status:layout.overflow?"fail":"pass",summary:viewport.width+"px "+(layout.overflow?"存在横向溢出":"无横向溢出"),detail:layout.title});
      if(layout.overflow&&!failed)failed=viewport.width+"px 存在横向溢出";
      if(testCase.captureScreenshots){
        const bytes=await page.screenshot({type:"jpeg",quality:60,fullPage:false});
        if(bytes.length<=1500000){
          const artifactHash=createHash("sha256").update(bytes).digest("hex");
          screenshots.push({name:testCase.id+"-"+viewport.name+".jpg",width:viewport.width,height:viewport.height,dataUrl:"data:image/jpeg;base64,"+bytes.toString("base64"),artifactHash});
          trace.push({id:"screenshot-"+viewport.name,stage:"visual-evidence",status:"pass",summary:"已采集 "+viewport.name+" 真实截图",detail:artifactHash});
        }else trace.push({id:"screenshot-"+viewport.name,stage:"visual-evidence",status:"warning",summary:"截图超过 1.5MB，未嵌入证据传输"});
      }
    }
    const status=failed||errors.length?"failed":unavailable?"unverified":blocked.length||!assertions?"partial":"verified";
    results.push({testCaseId:testCase.id,verificationStatus:status,error:failed||errors[0]||unavailable,assertions,
      blockedResources:blocked.slice(0,20),screenshots,trace,latencyMs:Date.now()-started});
  }catch(error){
    results.push({testCaseId:testCase.id,verificationStatus:error?.code==="BROWSER_CAPABILITY_UNAVAILABLE"?"unverified":"failed",
      error:String(error),assertions:0,blockedResources:blocked.slice(0,20),trace,latencyMs:Date.now()-started});
  }finally{await context.close().catch(()=>{});}
}
await browser.close();
console.log(JSON.stringify({results}));

`;