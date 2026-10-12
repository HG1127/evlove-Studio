import {chromium} from 'playwright';
import {expect} from 'playwright/test';
import {createHash} from 'node:crypto';
let browser;
let launching;
let idleTimer;
function releaseWhenIdle(){
 clearTimeout(idleTimer);
 idleTimer=setTimeout(()=>{if(browser?.contexts().length)releaseWhenIdle();else void closeBrowser();},60000);idleTimer.unref();
}
export async function getBrowser(){
 releaseWhenIdle();
 if(browser?.isConnected())return browser;
 launching ??= (async()=>{
  const channels=process.env.BROWSER_CHANNEL?[process.env.BROWSER_CHANNEL]:process.platform==='win32'?['msedge','chrome',undefined]:[undefined,'chrome','msedge'];
  const failures=[];
  for(const channel of channels){
   // Hosted CI runners lack the setuid helper required by Chromium's process sandbox.
   // Production keeps the sandbox on; only the dedicated Runner test step opts out.
   try{return browser=await chromium.launch({headless:true,chromiumSandbox:process.env.RUNNER_BROWSER_CI_NO_SANDBOX!=='1',timeout:10000,...(channel?{channel}:{})});}
   catch(error){failures.push(`${channel??'chromium'}: ${error.message}`);}
  }
  throw new Error(`未找到可用浏览器。请安装 Edge/Chrome 或执行 npm run runner:install-browser。${failures.join('；')}`);
 })().finally(()=>{launching=undefined;});
 return launching;
}
export async function closeBrowser(){clearTimeout(idleTimer);await browser?.close();browser=undefined;}
export function validateBrowserSteps(steps){
 if(!Array.isArray(steps)||steps.length>24)throw new Error('浏览器步骤应为最多 24 项的数组');
 for(const step of steps){
  if(!['click','fill','visible','text','count'].includes(step.action)||typeof step.selector!=='string'||!step.selector.trim()||step.selector.length>500)throw new Error('无效的浏览器操作或选择器');
  if(['fill','text'].includes(step.action)&&typeof step.value!=='string')throw new Error('操作缺少 value');
  if(step.action==='count'&&(!Number.isInteger(step.count)||step.count<0))throw new Error('count 断言缺少非负整数');
 }
 return steps;
}
/** Uploaded HTML runs in a fresh browser context; no local files or network resources. */
export async function executeBrowserTest({testCase,artifact}){
 const started=Date.now();const trace=[];const shots=[];
 const result={testCaseId:String(testCase?.id??'preview'),cost:0,trace,screenshots:shots,verificationStatus:'unverified'};
 if(!artifact?.content || !/\.html?$/i.test(artifact.name??''))return {...result,output:'此执行器需要单个完整 HTML 成果；工程构建需连接工程 Runner。',latencyMs:0};
 const steps=validateBrowserSteps(testCase?.browserSteps??[]);
 const hash=createHash('sha256').update(artifact.content).digest('hex');
 const instance=await getBrowser();
 let contextTimer;
 const context=await Promise.race([instance.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:1440,height:960}}),new Promise((_,reject)=>{contextTimer=setTimeout(()=>{void instance.close();reject(new Error('浏览器环境初始化超时'));},15000);})]).finally(()=>clearTimeout(contextTimer));
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;void context.close();},45000);
 const errors=[];const blocked=new Set();
 try{
  await context.routeWebSocket('**/*',route=>route.close());
  await context.route('**/*',route=>{
   if(route.request().url()==='https://artifact.invalid/index.html'&&route.request().method()==='GET')return route.fulfill({contentType:'text/html; charset=utf-8',body:artifact.content,headers:{'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"}});
   blocked.add(route.request().url());return route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(5000);
  page.on('pageerror',error=>errors.push(error.message));
  context.on('page',popup=>{if(popup!==page)void popup.close();});
  await page.goto('https://artifact.invalid/index.html',{waitUntil:'load',timeout:12000});
  trace.push({id:'open',stage:'browser',status:'pass',summary:'完整 HTML 已在独立浏览器打开',detail:`sha256:${hash}`});
  for(const [index,step] of steps.entries()){
   const locator=page.locator(step.selector);
   if(step.action==='click')await locator.click();
   if(step.action==='fill')await locator.fill(step.value);
   // Retry observations, never the preceding click/fill. Keep the existing 5s
   // action budget and the context's 45s hard deadline.
   if(step.action==='visible')await expect(locator).toBeVisible({timeout:5000})
    .catch(()=>{throw new Error('元素不可见：'+step.selector);});
   // A literal RegExp + innerText preserves the prior case/whitespace-sensitive
   // substring predicate; string matchers would normalize meaningful whitespace.
   if(step.action==='text')await expect(locator).toContainText(
    new RegExp(step.value.replace(/[\\^$.*+?()[\]{}|]/g,'\\$&')),
    {timeout:5000,useInnerText:true},
   ).catch(()=>{throw new Error('文本断言未通过：'+step.selector);});
   if(step.action==='count')await expect(locator).toHaveCount(step.count,{timeout:5000})
    .catch(()=>{throw new Error('数量断言未通过：'+step.selector);});
   trace.push({id:`step-${index}`,stage:'interaction',status:'pass',summary:`${step.action} ${step.selector}`});
  }
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:960});
   const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+2,title:document.title,body:document.body.innerText.slice(0,16000),resources:performance.getEntriesByType('resource').filter(r=>/^https?:/.test(r.name)&&!r.name.startsWith('https://artifact.invalid/')).length}));
   trace.push({id:`viewport-${width}`,stage:'layout',status:layout.overflow?'fail':'pass',summary:`${width}px ${layout.overflow?'存在横向溢出':'无横向溢出'}`,detail:layout.title});
   if(layout.resources)blocked.add('页面请求了外部资源（已由隔离策略阻止）');
   shots.push({name:`${width}px.png`,width,height:960,dataUrl:'data:image/png;base64,'+(await page.screenshot({fullPage:false})).toString('base64'),artifactHash:hash});
  }
  const failed=trace.some(t=>t.status==='fail')||errors.length>0;
  const assertions=steps.filter(s=>['visible','text','count'].includes(s.action)).length;
  // Rendering alone never proves a business workflow passed.
  result.verificationStatus=failed?'failed':blocked.size||!assertions?'partial':'verified';
  return {...result,artifactHash:hash,latencyMs:Date.now()-started,output:JSON.stringify({scope:assertions?'所列浏览器断言':'浏览器渲染与布局',assertions,errors,blockedResources:[...blocked],limitations:['截图仅覆盖两个视口的当前画面；美观与语义效果需独立评审。','不安装上传代码的依赖，不执行服务器命令，不访问外部网络。']}),...(failed?{error:'浏览器运行、断言或布局检查存在失败'}:{})};
 }catch(error){return {...result,artifactHash:hash,latencyMs:Date.now()-started,verificationStatus:timedOut?'unverified':'failed',error:String(error),output:timedOut?'执行超时，需补充验证。':String(error)};}
 finally{clearTimeout(timer);await context.close().catch(()=>{});}
}
