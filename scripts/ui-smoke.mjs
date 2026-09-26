import assert from 'node:assert/strict';
import path from 'node:path';
import {getBrowser,closeBrowser} from '../runner-gateway/browser-runner.mjs';
const output=process.argv[2];
assert.ok(output,'截图输出目录必填');
const baseUrl=process.env.UI_SMOKE_BASE_URL??'http://127.0.0.1:8000';
console.log('启动 UI 检查浏览器…');
const browser=await getBrowser();
console.log('浏览器已启动');
const errors=[];
const failedResponses=[];
const rows=[];
let page;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1045}});
 console.log('检查上下文已创建');
 page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text().slice(0,450));});
 page.on('response',response=>{if(response.status()>=400)failedResponses.push({path:new URL(response.url()).pathname,status:response.status()});});
 for(const [name,route,title] of [['home','/','工作台'],['projects','/projects','进化任务'],['project','/projects/demo',''],['settings','/settings',''],['outputs','/outputs',''],['templates','/templates','']]){
  console.log(`检查 ${name}`);
  await page.goto(`${baseUrl}/#${route}`);
  await page.locator('.studio-main').waitFor();
  if(title)await page.getByRole('heading',{name:title,exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('main')?.innerText.trim().length>30);
  await page.screenshot({path:path.join(output,`ui-${name}-desktop.png`)});
  rows.push({name,...await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,content:document.querySelector('main').innerText.slice(0,100)}))});
 }
 await page.setViewportSize({width:390,height:844});
 await page.goto(`${baseUrl}/#/`);
 await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'ui-home-mobile.png'),fullPage:true});
 rows.push({name:'home-mobile',...await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}))});
 await page.getByRole('button',{name:'粘贴内容',exact:true}).click();
 await page.getByPlaceholder('例如：当前 System Prompt、Workflow JSON、报告模板、代码片段……').waitFor();
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 let localParse='skipped';
 const parseCapabilityResponse=await page.request.get(`${baseUrl}/api/evolution/parse-capabilities`);
 if(parseCapabilityResponse.ok()&&(await parseCapabilityResponse.json()).available===false){
  await page.locator('input[type="file"]').first().setInputFiles({name:'smoke-source.md',mimeType:'text/markdown',buffer:Buffer.from('A local parse smoke artifact with verifiable source text.')});
  await page.getByText('已读取 · 后台解析完成',{exact:true}).waitFor({timeout:15000});
  localParse='passed';
 }
 const racePage=await context.newPage();
 racePage.on('pageerror',error=>errors.push(error.message));
 let releaseStart;
 let markStarted;
 let markCancelled;
 let markListed;
 const startGate=new Promise(resolve=>{releaseStart=resolve;});
 const startSeen=new Promise(resolve=>{markStarted=resolve;});
 const cancelSeen=new Promise(resolve=>{markCancelled=resolve;});
 const listSeen=new Promise(resolve=>{markListed=resolve;});
 let listCalls=0;
 let submittedArtifactId;
 const within=async(promise,label)=>{
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out`)),15000);})]);}
  finally{clearTimeout(timer);}
 };
 await racePage.route('**/api/evolution/parse-capabilities',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({available:true,durable:true,artifactStore:true,serverNative:true,supportedExtensions:['md']})}));
 await racePage.route('**/api/evolution/parse-jobs*',async route=>{
  const job={schemaVersion:'job-v1',id:'parse-smoke-late',type:'parse',status:'cancelled',label:'Parse smoke-late.md',
   idempotencyKey:'smoke-late',generation:1,attempts:1,priority:80,inputRef:'parse-input-smoke-late',
   outputRef:'parse-result-smoke-late',metadata:{artifactId:submittedArtifactId??'artifact-smoke-late',name:'smoke-late.md',mimeType:'text/markdown',size:11,role:'target'},
   createdAt:'2026-09-24T00:00:00.000Z',updatedAt:'2026-09-24T00:00:00.000Z'};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:listCalls++? [{job}]:[]})});
  markListed();
 });
 await racePage.route('**/api/evolution/parse-start',async route=>{
  markStarted();
  await startGate;
  const request=route.request();
  const body=request.postDataBuffer();
  const match=body?.toString().match(/name="artifactId"\r?\n\r?\n([^\r\n]+)/);
  assert.ok(match?.[1],'Parse start did not send an artifactId');
  submittedArtifactId=match[1];
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({jobId:'parse-smoke-late',runId:'run-smoke-late',artifactId:submittedArtifactId,status:'queued'})});
 });
 await racePage.route('**/api/evolution/parse-cancel',async route=>{
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({jobId:'parse-smoke-late',status:'cancelled',workflow:{runId:'run-smoke-late',bound:true,exists:true,statusBefore:'running',statusAfter:'cancelled',cancelIssued:true,reason:'workflow-run-cancelled'}})});
  markCancelled();
 });
 await racePage.goto(`${baseUrl}/#/`);
 await within(listSeen,'initial Parse list');
 await racePage.locator('input[type="file"]').first().setInputFiles({name:'smoke-late.md',mimeType:'text/markdown',buffer:Buffer.from('late source')});
 await within(startSeen,'delayed Parse start');
 await racePage.getByRole('button',{name:'移除附件：smoke-late.md'}).click();
 releaseStart();
 await within(cancelSeen,'Parse cancellation');
 assert.equal(await racePage.getByText('smoke-late.md',{exact:true}).count(),0,'removed Parse input reappeared after delayed start');
 const recoveredList=racePage.waitForResponse(response=>response.url().includes('/api/evolution/parse-jobs')&&response.ok());
 await racePage.reload();
 await recoveredList;
 await racePage.getByRole('heading',{name:'工作台',exact:true}).waitFor();
 await racePage.waitForTimeout(250);
 assert.ok(listCalls>=2,'Parse recovery list was not requested after reload');
 assert.equal(await racePage.getByText('smoke-late.md',{exact:true}).count(),0,'dismissed Parse Job reappeared after reload');
 await racePage.close();
 assert.equal(errors.length,0,errors.join('\n'));
 assert.ok(rows.every(row=>row.scrollWidth<=row.width+2),JSON.stringify(rows));
 console.log(JSON.stringify({status:'PASS',rows,pageErrors:errors,failedResponses,mobilePaste:'passed',localParse,lateParseRemoval:'passed'},null,2));
 await context.close();
}catch(error){console.error(JSON.stringify({errors,failedResponses,rows,body:await page?.locator('body').innerText().catch(()=>''),failure:String(error)},null,2));throw error;}finally{await closeBrowser();}
