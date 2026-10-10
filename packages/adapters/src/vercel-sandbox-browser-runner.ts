import type { TestCase } from "@evolution/contracts";

/** Bounded batch budget includes navigation and every existing action deadline. */
export function sandboxBrowserCommandTimeoutMs(testCases: Pick<TestCase,"browserSteps">[]): number {
  const work=testCases.reduce((total,test)=>total+15_000+(test.browserSteps?.length??0)*7_000+10_000,0);
  return Math.min(180_000,Math.max(30_000,20_000+work));
}

/** Trusted runtime installed in the versioned Sandbox browser cache. */
export const VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT=String.raw`
import fs from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "../browser/node_modules/playwright/index.mjs";
import { expect } from "../browser/node_modules/playwright/test.mjs";
const cases=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const baseUrl=process.argv[3];
const baseOrigin=new URL(baseUrl).origin;
const browser=await chromium.launch({headless:true});
const results=[];
for(const testCase of cases){
  const started=Date.now();
  const trace=[];const errors=[];const blocked=[];const screenshots=[];
  const context=await browser.newContext({serviceWorkers:"block",acceptDownloads:false,viewport:{width:1440,height:960}});
  try{
    await context.route("**/*",route=>{
      const url=route.request().url();
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
    let failed;
    for(const [index,step] of (testCase.browserSteps||[]).entries()){
      try{
        const locator=page.locator(step.selector);
        if(step.action==="click")await locator.click();
        if(step.action==="fill")await locator.fill(step.value||"");
        // Retry only observations. The preceding input/click is executed once.
        if(step.action==="visible")await expect(locator).toBeVisible({timeout:7000})
          .catch(()=>{throw new Error("元素不可见："+step.selector);});
        if(step.action==="text")await expect(locator).toContainText(
          new RegExp((step.value||"").replace(/[\\^$.*+?()[\]{}|]/g,"\\$&")),
          {timeout:7000,useInnerText:true},
        ).catch(()=>{throw new Error("文本断言未通过："+step.selector);});
        if(step.action==="count")await expect(locator).toHaveCount(step.count,{timeout:7000})
          .catch(()=>{throw new Error("数量断言未通过："+step.selector);});
        trace.push({id:"step-"+index,stage:"browser-step",status:"pass",summary:step.action+" "+step.selector});
      }catch(error){
        failed=String(error);
        trace.push({id:"step-"+index,stage:"browser-step",status:"fail",summary:step.action+" "+step.selector,detail:failed});
        break;
      }
    }
    for(const viewport of [{name:"desktop",width:1440,height:900},{name:"mobile",width:390,height:844}]){
      await page.setViewportSize({width:viewport.width,height:viewport.height});
      const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+2,title:document.title}));
      trace.push({id:"viewport-"+viewport.width,stage:"layout",status:layout.overflow?"fail":"pass",summary:viewport.width+"px "+(layout.overflow?"存在横向溢出":"无横向溢出"),detail:layout.title});
      if(layout.overflow&&!failed)failed=viewport.width+"px 存在横向溢出";
      if(testCase.captureScreenshots){
        const bytes=await page.screenshot({type:"jpeg",quality:60,fullPage:false});
        if(bytes.length<=1500000){
          const artifactHash=createHash("sha256").update(bytes).digest("hex");
          screenshots.push({name:testCase.id+"-"+viewport.name+".jpg",width:viewport.width,height:viewport.height,dataUrl:"data:image/jpeg;base64,"+bytes.toString("base64"),artifactHash});
          trace.push({id:"screenshot-"+viewport.name,stage:"visual-evidence",status:"pass",summary:"已采集 "+viewport.name+" 真实截图",detail:artifactHash});
        }else{
          trace.push({id:"screenshot-"+viewport.name,stage:"visual-evidence",status:"warning",summary:"截图超过 1.5MB，未嵌入证据传输"});
        }
      }
    }
    const assertions=(testCase.browserSteps||[]).filter(step=>["visible","text","count"].includes(step.action)).length;
    const status=failed||errors.length?"failed":blocked.length||!assertions?"partial":"verified";
    results.push({testCaseId:testCase.id,verificationStatus:status,error:failed||errors[0],assertions,blockedResources:blocked.slice(0,20),screenshots,trace,latencyMs:Date.now()-started});
  }catch(error){
    results.push({testCaseId:testCase.id,verificationStatus:"failed",error:String(error),assertions:0,blockedResources:blocked.slice(0,20),trace,latencyMs:Date.now()-started});
  }finally{
    await context.close().catch(()=>{});
  }
}
await browser.close();
console.log(JSON.stringify({results}));
`;
