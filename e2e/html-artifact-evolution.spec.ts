import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {test,expect,type Page} from "@playwright/test";
import {TestCaseSchema,type TestCase} from "@evolution/contracts";

// Execute the exact BrowserStep contract with real Chromium interactions.
// This is an isolated Runner/E2E regression, not a live HTML Mission approval.
const sourcePath=new URL("./fixtures/search-source.html",import.meta.url);
const patchBefore="const matches=query ? false : true;";
const patchAfter="const matches=query ? card.dataset.search.includes(query) : true;";
const hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
const actualCase=TestCaseSchema.parse({
  id:"H-REAL-HTML-SEARCH",title:"搜索：正向命中、负向、恢复",
  input:"完整验证真实 HTML 的搜索用户流程",
  expected:["alpha 命中第一页","无结果时没有可见卡片","清空查询后恢复原始卡片"],
  hidden:true,criterionIds:["HTML-SEARCH"],
  executionMode:"external-runner",evidenceScope:"product-behavior",
  browserSteps:[
    {action:"visible",selector:"#slide-1"},
    {action:"visible",selector:"#slide-2"},
    {action:"fill",selector:"#search",value:"alpha"},
    {action:"visible",selector:"#slide-1"},
    {action:"count",selector:".slide-card:not(.search-hidden)",count:1},
    {action:"text",selector:"#searchCount",value:"1 页命中"},
    {action:"fill",selector:"#search",value:"__evolve_audit_no_match__"},
    {action:"count",selector:".slide-card:not(.search-hidden)",count:0},
    {action:"text",selector:"#searchCount",value:"0 页命中"},
    {action:"fill",selector:"#search",value:""},
    {action:"count",selector:".slide-card.search-hidden",count:0},
    {action:"visible",selector:"#slide-1"},
    {action:"visible",selector:"#slide-2"},
  ],
});

async function performBrowserEvidence(page:Page,testCase:TestCase){
  if(testCase.executionMode!=="external-runner"||!testCase.browserSteps?.length){
    throw new Error("No executable external-runner BrowserSteps");
  }
  let assertionCount=0;
  for(const [i,step] of testCase.browserSteps.entries()){
    const target=page.locator(step.selector);
    if(step.action==="fill")await target.fill(step.value??"");
    if(step.action==="click")await target.click();
    if(step.action==="visible"){await expect(target,`step ${i} visible`).toBeVisible({timeout:900});assertionCount++;}
    if(step.action==="count"){await expect(target,`step ${i} count`).toHaveCount(step.count!,{timeout:900});assertionCount++;}
    if(step.action==="text"){await expect(target,`step ${i} text`).toContainText(step.value!,{timeout:900});assertionCount++;}
  }
  return assertionCount;
}

test("real original HTML fails its observed positive-search behavior instead of earning a fake VERIFIED",async({page,baseURL})=>{
  const source=await readFile(sourcePath,"utf8");
  if(!source.includes(patchBefore))throw new Error("Exact original fixture changed");
  const bytes=Buffer.from(source,"utf8");
  const digest=hash(bytes);
  await page.route("**/audit-html-source.html",route=>route.fulfill({
    status:200,contentType:"text/html",body:bytes,headers:{"X-Artifact-SHA256":digest},
  }));
  const response=await page.goto(`${baseURL}/audit-html-source.html`);
  expect(response?.ok()).toBe(true);
  expect(response?.headers()["x-artifact-sha256"]).toBe(digest);
  expect(await page.locator(".slide-card:not(.search-hidden)").count()).toBe(2);
  let observedFailure:Error|undefined;
  try{await performBrowserEvidence(page,actualCase);}
  catch(error){observedFailure=error as Error;}
  expect(observedFailure,"A broken positive search must be rejected").toBeDefined();
  expect(observedFailure?.message).toMatch(/step 3 visible/);
  expect(await page.locator(".slide-card:not(.search-hidden)").count()).toBe(0);
});

test("evolved exact HTML bytes pass real Chromium actions, mobile layout and reopened same-byte delivery",async({page,context,baseURL},testInfo)=>{
  const source=await readFile(sourcePath,"utf8");
  if(source.split(patchBefore).length!==2)throw new Error("Candidate mutation anchor is not unique");
  const candidate=source.replace(patchBefore,patchAfter);
  const bytes=Buffer.from(candidate,"utf8");
  const digest=hash(bytes);
  expect(digest).not.toBe(hash(source));
  const serve=async(pageForArtifact:Page)=>{
    await pageForArtifact.route("**/audit-html-candidate.html",route=>route.fulfill({
      status:200,contentType:"text/html",body:bytes,headers:{"X-Artifact-SHA256":digest},
    }));
  };
  await serve(page);
  const pageErrors:string[]=[];
  page.on("pageerror",error=>pageErrors.push(error.message));
  const response=await page.goto(`${baseURL}/audit-html-candidate.html`);
  expect(response?.ok()).toBe(true);
  expect(response?.headers()["x-artifact-sha256"]).toBe(digest);
  const assertions=await performBrowserEvidence(page,actualCase);
  expect(assertions).toBeGreaterThanOrEqual(9);
  await page.setViewportSize({width:390,height:844});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+2);
  expect(overflow,"Mobile viewport must not scroll horizontally").toBe(false);
  await expect(page.locator("#slide-1")).toBeVisible();
  await testInfo.attach("html-candidate-real-mobile.jpg",{
    body:await page.screenshot({type:"jpeg",quality:65}),contentType:"image/jpeg",
  });
  expect(pageErrors).toEqual([]);
  // The downloaded bytes below come from the same immutable Candidate Buffer,
  // never from a separately generated HTML representation.
  // Use a byte-preserving data URL for this isolated browser fixture. The
  // production accepted-output route is exercised by a separate durable audit.
  // Playwright/Vite may bypass page.route for browser download navigations,
  // which would otherwise download the SPA fallback instead of the fixture.
  await page.evaluate((base64)=>{
    const a=document.createElement("a");a.id="audit-deliver";
    a.href="data:text/html;base64,"+base64;a.download="evolved-audit-search.html";
    a.textContent="下载验收成果";document.body.append(a);
  },bytes.toString("base64"));
  const [download]=await Promise.all([
    page.waitForEvent("download"),
    page.locator("#audit-deliver").click(),
  ]);
  const filePath=await download.path();
  if(!filePath)throw new Error("Browser download did not persist");
  const recovered=await readFile(filePath);
  expect(recovered.equals(bytes)).toBe(true);
  expect(hash(recovered)).toBe(digest);
  const reopened=await context.newPage();
  await serve(reopened);
  const reopenedResult=await reopened.goto(`${baseURL}/audit-html-candidate.html`);
  expect(reopenedResult?.ok()).toBe(true);
  await performBrowserEvidence(reopened,actualCase);
  await reopened.close();
  await testInfo.attach("candidate-html-sha256.txt",{
    body:Buffer.from(digest,"utf8"),contentType:"text/plain",
  });
});
