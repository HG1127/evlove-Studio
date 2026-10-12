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
const legacyActions=['click','fill','visible','text','count'];
const assertionActions=['visible','text','count','in-viewport','attribute','checked','scroll-position','computed-style','copy-text'];
const attributes=['class','id','style','checked','disabled','hidden','open','href','aria-expanded','aria-checked','aria-valuenow','aria-valuemin','aria-valuemax','aria-hidden','data-progress','data-state'];
const cssProperties=['opacity','transform','width','display','visibility'];
const selectorValid=value=>typeof value==='string'&&value.length<=500&&value.trim().length>0;
const literalValid=value=>typeof value==='string'&&value.length<=65536;
const finiteRange=(step,lower=-10000000,upper=10000000)=>Number.isFinite(step.min)&&Number.isFinite(step.max)&&step.min>=lower&&step.max<=upper&&step.min<=step.max;
function fieldsOnly(step,keys){return Object.keys(step).every(key=>['action','selector',...keys].includes(key));}
/** Standalone Gateway mirror of the closed contracts BrowserStepSchema; no supplied JS. */
export function validateBrowserSteps(steps){
 if(!Array.isArray(steps)||steps.length>24)throw new Error('浏览器步骤应为最多 24 项的数组');
 for(const step of steps){
  if(!step||typeof step!=='object'||Array.isArray(step)||!selectorValid(step.selector))throw new Error('无效的浏览器操作或选择器');
  let valid=false;
  if(legacyActions.includes(step.action)){
   valid=fieldsOnly(step,['value','count'])&&(step.value===undefined||literalValid(step.value))&&(step.count===undefined||(Number.isInteger(step.count)&&step.count>=0));
   if(['fill','text'].includes(step.action))valid=valid&&literalValid(step.value);
   if(step.action==='count')valid=valid&&Number.isInteger(step.count)&&step.count>=0;
  }else if(step.action==='viewport')valid=fieldsOnly(step,['width','height'])&&step.selector==='html'&&Number.isInteger(step.width)&&Number.isInteger(step.height)&&step.width>=240&&step.width<=2560&&step.height>=240&&step.height<=2560;
  else if(step.action==='scroll-into-view'||step.action==='hover')valid=fieldsOnly(step,[]);
  else if(step.action==='in-viewport')valid=fieldsOnly(step,['ratio','expected'])&&(step.ratio===undefined||(Number.isFinite(step.ratio)&&step.ratio>=0&&step.ratio<=1))&&(step.expected===undefined||typeof step.expected==='boolean');
  else if(step.action==='attribute')valid=fieldsOnly(step,['name','value','mode'])&&typeof step.name==='string'&&step.name.length<=64&&(attributes.includes(step.name)||/^data-[a-z0-9-]+$/.test(step.name))&&literalValid(step.value)&&(step.mode===undefined||['equals','contains'].includes(step.mode));
  else if(step.action==='checked')valid=fieldsOnly(step,['checked'])&&typeof step.checked==='boolean';
  else if(step.action==='scroll-position')valid=fieldsOnly(step,['axis','min','max'])&&step.selector==='html'&&(step.axis===undefined||['x','y'].includes(step.axis))&&finiteRange(step);
  else if(step.action==='copy-text')valid=fieldsOnly(step,['value'])&&literalValid(step.value);
  else if(step.action==='computed-style'&&cssProperties.includes(step.property)){
   if(step.mode==='literal')valid=fieldsOnly(step,['property','mode','value'])&&typeof step.value==='string'&&step.value.length>0&&step.value.length<=512&&(step.property!=='opacity'||/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(step.value));
   if(step.mode==='numeric-range')valid=fieldsOnly(step,['property','mode','min','max'])&&['opacity','width'].includes(step.property)&&finiteRange(step,0,step.property==='opacity'?1:10000000);
   if(step.mode==='identity-transform')valid=fieldsOnly(step,['property','mode','tolerance'])&&step.property==='transform'&&(step.tolerance===undefined||(Number.isFinite(step.tolerance)&&step.tolerance>=0&&step.tolerance<=0.1));
   if(step.mode==='parent-relative')valid=fieldsOnly(step,['property','mode','relativeTo','min','max'])&&step.property==='width'&&selectorValid(step.relativeTo)&&finiteRange(step,0,1);
  }
  if(!valid)throw new Error('无效或不支持的浏览器操作字段：'+String(step.action));
 }
 return steps;
}
class BrowserCapabilityUnavailable extends Error{}
async function setActionViewport(page,step){
 let timer;
 try{
  if(typeof page.setViewportSize!=='function')throw new Error('setViewportSize 不可用');
  // Match Gateway's existing 5s action budget; the unchanged 45s case timer also
  // bounds this action. Call once, never retry or turn resize into an observation.
  await Promise.race([
   Promise.resolve().then(()=>page.setViewportSize({width:step.width,height:step.height})),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('viewport action deadline')),5000);}),
  ]);
  return {width:step.width,height:step.height};
 }catch(error){
  // Stop this case immediately. Close the page to prevent a late resize from
  // changing any later observation; close failures do not reclassify capability.
  void Promise.resolve().then(()=>page.close()).catch(()=>{});
  throw new BrowserCapabilityUnavailable('viewport capability UNVERIFIED：无法可靠改变浏览器尺寸',{cause:error});
 }finally{clearTimeout(timer);}
}
async function hoverAction(page,locator,caseDeadline){
 let timer;let expired=false;const deadline=Math.min(Date.now()+5000,caseDeadline);
 try{
  const hover=locator.hover;
  if(typeof hover!=='function')throw new Error('locator.hover 不可用');
  // Check at actual dispatch: a delayed microtask must not grant a fresh 5s
  // timeout after either the original action or case deadline has elapsed.
  await Promise.race([
   Promise.resolve().then(()=>{
    const remaining=Math.min(5000,deadline-Date.now());
    if(expired||remaining<=0)throw new Error('hover action deadline before dispatch');
    return hover.call(locator,{timeout:remaining});
   }),
   new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new Error('hover action deadline'));},Math.min(5000,Math.max(0,deadline-Date.now())));}),
  ]);
  if(expired||Date.now()>=deadline)throw new Error('hover action deadline after completion');
 }catch(error){
  void Promise.resolve().then(()=>page.close()).catch(()=>{});
  throw new BrowserCapabilityUnavailable('hover capability UNVERIFIED：无法可靠执行悬停',{cause:error});
 }finally{clearTimeout(timer);}
}
async function pollObservation(read,predicate,summary){
 let last;let capability;
 try{await expect.poll(async()=>{
  try{last=await read();capability=undefined;return last.available&&predicate(last.value);}
  catch(error){last=undefined;capability=error instanceof BrowserCapabilityUnavailable?error:undefined;return false;}
 },{timeout:5000}).toBe(true);}
 catch(error){
  if(capability)throw capability;
  if(last?.available===false)throw new BrowserCapabilityUnavailable(`${summary}：${last.reason??'无法可靠测量'}`);
  throw new Error(summary,{cause:error});
 }
}
// Only this fixed declaration is sent to CDP. Selectors/modes are closed JSON
// arguments, never interpolated code; native DOM wrappers belong to this world.
async function fixedIsolatedObservation(step){
 function query(selector){
  const css=selector.startsWith('css=')?selector.slice(4):selector;
  if(/^[a-zA-Z][\w-]*=/.test(css)||css.startsWith('//'))throw new Error('Unsupported selector engine');
  const found=new Set();const roots=[document];
  for(const root of roots){
   for(const element of root.querySelectorAll(css))found.add(element);
   for(const element of root.querySelectorAll('*'))if(element.shadowRoot)roots.push(element.shadowRoot);
  }
  return [...found];
 }
 function readComputedStyle(element,{property,mode,reference}){
 try{
  const view=element.ownerDocument.defaultView;
  if(!view||typeof view.getComputedStyle!=='function')return {available:false,reason:'computed style 不可用'};
  if(property==='opacity'){
   let opacity=1;
   for(let current=element;current;){
    const raw=view.getComputedStyle(current).opacity;
    if(!raw.trim())return {available:false,reason:'opacity 读数缺失'};
    const value=Number(raw);
    if(!Number.isFinite(value)||value<0||value>1)return {available:false,reason:'opacity 读数无效'};
    opacity*=value;
    const root=current.getRootNode();
    current=current.assignedSlot??current.parentElement??(root instanceof view.ShadowRoot?root.host:null);
   }
   return {available:Number.isFinite(opacity),value:mode==='literal'?String(opacity):opacity,reason:'opacity 读数无效'};
  }
  if(mode==='parent-relative'){
   if(!reference?.isConnected)return {available:false,reason:'相对宽度参考元素不可用'};
   const width=element.getBoundingClientRect().width;const denominator=reference.getBoundingClientRect().width;
   if(!Number.isFinite(width)||width<0||!Number.isFinite(denominator)||denominator<=0)return {available:false,reason:'相对宽度缺少有效正分母'};
   return {available:true,value:width/denominator};
  }
  const value=view.getComputedStyle(element).getPropertyValue(property);
  if(!value.trim())return {available:false,reason:'CSS 读数缺失'};
  if(mode==='identity-transform'){
   if(typeof view.DOMMatrixReadOnly!=='function')return {available:false,reason:'DOMMatrixReadOnly 不可用'};
   const matrix=value==='none'?new view.DOMMatrixReadOnly():new view.DOMMatrixReadOnly(value);
   const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
   const entries=[matrix.m11,matrix.m12,matrix.m13,matrix.m14,matrix.m21,matrix.m22,matrix.m23,matrix.m24,matrix.m31,matrix.m32,matrix.m33,matrix.m34,matrix.m41,matrix.m42,matrix.m43,matrix.m44];
   if(entries.length!==16||!entries.every(Number.isFinite))return {available:false,reason:'transform 矩阵读数无效'};
   return {available:true,value:Math.max(...entries.map((entry,index)=>Math.abs(entry-identity[index])))};
  }
  if(mode==='numeric-range'){
   if(!/^(?:\d+(?:\.\d+)?|\.\d+)px$/.test(value))return {available:false,reason:'width 不是有限 px 读数'};
   const width=Number(value.slice(0,-2));return {available:Number.isFinite(width),value:width,reason:'width 读数无效'};
  }
  return {available:true,value};
 }catch{return {available:false,reason:'浏览器不支持此 CSS 测量'};}
}
 try{
  if(step.action==='probe')return {available:true,value:true};
  if(step.action==='layout')return {available:true,value:{overflow:document.documentElement.scrollWidth>innerWidth+2,title:document.title,body:document.body.innerText.slice(0,16000),resources:performance.getEntriesByType('resource').filter(r=>/^https?:/.test(r.name)&&!r.name.startsWith('https://artifact.invalid/')).length}};
  let elements;
  try{elements=query(step.selector);}catch{return {available:false,reason:'仅支持原生 CSS 选择器（含开放 shadow root）；选择器无法解析'};}
  // Missing/ambiguous real elements are assertion failures, not absent capability.
  if(elements.length!==1)return {available:true,reason:'目标元素不存在或不唯一'};
  const element=elements[0];
  if(step.action==='scroll-position'){
   const value=step.axis==='x'?scrollX:scrollY;
   return {available:Number.isFinite(value),value,reason:'scroll position 不可用'};
  }
  if(step.action==='in-viewport'){
   if(typeof IntersectionObserver!=='function')return {available:false,reason:'IntersectionObserver 不可用'};
   return await new Promise(resolve=>{
    let observer;let timer;
    const finish=value=>{clearTimeout(timer);observer?.disconnect();resolve(value);};
    observer=new IntersectionObserver(entries=>{
     const value=entries[0]?.intersectionRatio;
     finish({available:Number.isFinite(value)&&value>=0&&value<=1,value,reason:'viewport intersection 读数无效'});
    });
    timer=setTimeout(()=>finish({available:false,reason:'viewport intersection 测量超时'}),1000);
    observer.observe(element);requestAnimationFrame(()=>{});
   });
  }
  if(step.action==='computed-style'){
   let reference;
   if(step.mode==='parent-relative'){
    let matches;
    try{matches=query(step.relativeTo);}catch{return {available:false,reason:'相对宽度参考选择器无法解析'};}
    if(matches.length!==1)return {available:true,reason:'相对宽度参考元素不存在或不唯一'};
    reference=matches[0];
   }
   return readComputedStyle(element,{property:step.property,mode:step.mode,reference});
  }
  return {available:false,reason:'不支持的固定测量'};
 }catch{return {available:false,reason:'独立 realm 的原生 DOM 测量不可用'};}
}
// Public APIs: https://playwright.dev/docs/api/class-cdpsession
// https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-createIsolatedWorld
// https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-callFunctionOn
async function createIsolatedObserver(context,page){
 let session;
 try{
  session=await context.newCDPSession(page);
  const contexts=new Map();const worldName='__evolution_gateway_observer_v1__';
  session.on('Runtime.executionContextCreated',event=>contexts.set(event.context.id,event.context));
  session.on('Runtime.executionContextDestroyed',event=>contexts.delete(event.executionContextId));
  session.on('Runtime.executionContextsCleared',()=>contexts.clear());
  await session.send('Runtime.enable');await session.send('Page.enable');
  const read=async step=>{
   try{
    const {frameTree}=await session.send('Page.getFrameTree');const frameId=frameTree?.frame?.id;
    if(typeof frameId!=='string'||!frameId)throw new Error('Missing frame identity');
    // This misspelling is the actual pinned CDP parameter. Never grant universal access.
    const {executionContextId}=await session.send('Page.createIsolatedWorld',{frameId,worldName,grantUniveralAccess:false});
    const realm=contexts.get(executionContextId);
    if(realm?.name!==worldName||realm.auxData?.isDefault!==false||realm.auxData?.type!=='isolated'||realm.auxData?.frameId!==frameId||typeof realm.uniqueId!=='string'||!realm.uniqueId)throw new Error('Independent realm identity unavailable');
    // uniqueContextId prevents an integer context id reused after navigation from
    // silently redirecting fixed evidence reads into another realm.
    const response=await session.send('Runtime.callFunctionOn',{uniqueContextId:realm.uniqueId,functionDeclaration:fixedIsolatedObservation.toString(),arguments:[{value:step}],returnByValue:true,awaitPromise:true,userGesture:false});
    const value=response.result?.value;
    if(response.exceptionDetails||!value||typeof value.available!=='boolean')throw new Error('Invalid fixed observation response');
    return value;
   }catch{throw new BrowserCapabilityUnavailable('Chromium CDP 独立测量能力不可用；禁止 main world 回退');}
  };
  if((await read({action:'probe'})).value!==true)throw new Error('Isolated probe failed');
  return {read,close:()=>session.detach()};
 }catch(error){await session?.detach().catch(()=>{});throw new BrowserCapabilityUnavailable('Chromium CDP 独立测量能力不可用；禁止加载或 main world 回退',{cause:error});}
}
async function observeComputedStyle(observer,step){
 await pollObservation(()=>observer.read(step),value=>step.mode==='literal'?value===step.value:step.mode==='identity-transform'?value<=(step.tolerance??0.01):value>=step.min&&value<=step.max,'样式断言未通过：'+step.selector);
}
/** Gateway uses an installed desktop browser: no artifact may access native clipboard. */
async function denyDesktopClipboard(context,onBlocked){
 await context.grantPermissions([]);
 await context.exposeBinding('__runnerClipboardDenied',onBlocked);
 await context.addInitScript(()=>{
  const report=globalThis.__runnerClipboardDenied;let attempted=false;
  const apply=Reflect.apply;const stringValue=String;const trim=String.prototype.trim;
  const lower=String.prototype.toLowerCase;const includes=String.prototype.includes;
  const deny=()=>{attempted=true;void report().catch(()=>{});return Promise.reject(new DOMException('Desktop clipboard is unavailable in this Runner','NotAllowedError'));};
  const clipboard=Object.freeze({read:deny,readText:deny,write:deny,writeText:deny});
  // Install before any artifact script. Do not read the native clipboard getter,
  // retain a native Clipboard method, or call any read/write/copy/cut operation.
  const navigatorPrototype=Object.getPrototypeOf(navigator);
  Object.defineProperty(navigatorPrototype,'clipboard',{get:()=>clipboard,configurable:false});
  Object.defineProperty(navigator,'clipboard',{get:()=>clipboard,configurable:false});
  if(globalThis.Clipboard?.prototype){
   for(const name of ['read','readText','write','writeText'])Object.defineProperty(Clipboard.prototype,name,{value:deny,writable:false,configurable:false});
  }
  const exec=Document.prototype.execCommand;
  Object.defineProperty(Document.prototype,'execCommand',{value:function(command,...args){
   // Captured intrinsics cannot be replaced by artifact RegExp/String/Function prototypes.
   const name=apply(lower,apply(trim,stringValue(command),[]),[]);
   if(apply(includes,name,['copy'])||apply(includes,name,['cut'])||apply(includes,name,['paste'])||apply(includes,name,['clipboard'])){attempted=true;void report().catch(()=>{});return false;}
   return apply(exec,this,[name,...args]);
  },writable:false,configurable:false});
  Object.defineProperty(globalThis,'__runnerClipboardAttempted',{get:()=>attempted,configurable:false});
  Object.defineProperty(globalThis,'__runnerClipboardGuardReady',{value:true,writable:false,configurable:false});
 });
}
/** Uploaded HTML runs in a fresh browser context; no local files or network resources. */
export async function executeBrowserTest({testCase,artifact}){
 const started=Date.now();const trace=[];const shots=[];const requestedViewports=[];
 const result={testCaseId:String(testCase?.id??'preview'),cost:0,trace,screenshots:shots,verificationStatus:'unverified'};
 if(!artifact?.content || !/\.html?$/i.test(artifact.name??''))return {...result,output:'此执行器需要单个完整 HTML 成果；工程构建需连接工程 Runner。',latencyMs:0};
 const steps=validateBrowserSteps(testCase?.browserSteps??[]);
 const hash=createHash('sha256').update(artifact.content).digest('hex');
 if(steps.some(step=>step.action==='copy-text'))return {...result,artifactHash:hash,latencyMs:Date.now()-started,error:'copy-text capability UNVERIFIED: Gateway cannot use the desktop clipboard',output:JSON.stringify({browserStepProtocol:'v5-typed-hover',scope:'copy-text',assertions:0,capability:'unavailable',limitations:['本机 Gateway 禁止访问桌面剪贴板；需隔离 Sandbox 的可信探针。']})};
 const instance=await getBrowser();
 let contextTimer;
 const context=await Promise.race([instance.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:1440,height:960}}),new Promise((_,reject)=>{contextTimer=setTimeout(()=>{void instance.close();reject(new Error('浏览器环境初始化超时'));},15000);})]).finally(()=>clearTimeout(contextTimer));
 const caseDeadline=Date.now()+45000;let timedOut=false;const timer=setTimeout(()=>{timedOut=true;void context.close();},45000);
 const errors=[];const blocked=new Set();let clipboardBlocked=false;let observer;
 try{
  try{await denyDesktopClipboard(context,()=>{clipboardBlocked=true;});}
  catch{throw new BrowserCapabilityUnavailable('桌面剪贴板隔离入口不可用');}
  await context.routeWebSocket('**/*',route=>route.close());
  await context.route('**/*',route=>{
   if(route.request().url()==='https://artifact.invalid/index.html'&&route.request().method()==='GET')return route.fulfill({contentType:'text/html; charset=utf-8',body:artifact.content,headers:{'Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"}});
   blocked.add(route.request().url());return route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(5000);
  page.on('pageerror',error=>errors.push(error.message));
  context.on('page',popup=>{if(popup!==page)void popup.close();});
  // Verify on a trusted blank document before loading any artifact code.
  if(!await page.evaluate(()=>globalThis.__runnerClipboardGuardReady===true))throw new BrowserCapabilityUnavailable('桌面剪贴板隔离入口不可用');
  observer=await createIsolatedObserver(context,page);
  await page.goto('https://artifact.invalid/index.html',{waitUntil:'load',timeout:12000});
  if(!await page.evaluate(()=>globalThis.__runnerClipboardGuardReady===true))throw new BrowserCapabilityUnavailable('桌面剪贴板隔离入口不可用');
  const checkClipboard=async()=>{
   // The immutable per-frame flag also observes attempts synchronously, even if
   // the host binding's notification has not completed yet.
   if(!clipboardBlocked)for(const frame of page.frames()){
    if(await frame.evaluate(()=>globalThis.__runnerClipboardAttempted===true)){clipboardBlocked=true;break;}
   }
   if(clipboardBlocked)throw new BrowserCapabilityUnavailable('artifact 请求本机剪贴板；此能力不可验证');
  };
  await checkClipboard();
  trace.push({id:'open',stage:'browser',status:'pass',summary:'完整 HTML 已在独立浏览器打开',detail:`sha256:${hash}`});
  for(const [index,step] of steps.entries()){
   await checkClipboard();
   const locator=page.locator(step.selector);
   // Perform each action once. Only observations are retried within 5s; the
   // context's 45s deadline also bounds the complete sequence.
   switch(step.action){
    case 'viewport':requestedViewports.push(await setActionViewport(page,step));break;
    case 'hover':await hoverAction(page,locator,caseDeadline);break;
    case 'click':await locator.click();break;
    case 'fill':await locator.fill(step.value);break;
    case 'scroll-into-view':await locator.scrollIntoViewIfNeeded();break;
    case 'visible':await expect(locator).toBeVisible({timeout:5000});break;
    case 'text':await expect(locator).toContainText(new RegExp(step.value.replace(/[\\^$.*+?()[\]{}|]/g,'\\$&')),{timeout:5000,useInnerText:true});break;
    case 'count':await expect(locator).toHaveCount(step.count,{timeout:5000});break;
    // These assertions never scroll: a broken navigation must remain observable.
    case 'in-viewport':await pollObservation(()=>observer.read(step),value=>Number.isFinite(value)&&((value>0&&value>=(step.ratio??0))===(step.expected??true)),'viewport 断言未通过：'+step.selector);break;
    case 'checked':await (step.checked?expect(locator):expect(locator).not).toBeChecked({timeout:5000});break;
    case 'attribute':await pollObservation(async()=>({available:true,value:await locator.getAttribute(step.name)}),value=>typeof value==='string'&&((step.mode??'equals')==='contains'?value.includes(step.value):value===step.value),'属性断言未通过：'+step.selector);break;
    case 'scroll-position':await pollObservation(()=>observer.read(step),value=>value>=step.min&&value<=step.max,'滚动位置断言未通过');break;
    case 'computed-style':await observeComputedStyle(observer,step);break;
    default:throw new Error('不支持的浏览器操作：'+String(step.action));
   }
   await checkClipboard();
   trace.push({id:`step-${index}`,stage:'interaction',status:'pass',summary:`${step.action} ${step.selector}`});
  }
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:960});
   const measurement=await observer.read({action:'layout'});if(!measurement.available)throw new BrowserCapabilityUnavailable('独立 layout 测量不可用');const layout=measurement.value;
   trace.push({id:`viewport-${width}`,stage:'layout',status:layout.overflow?'fail':'pass',summary:`${width}px ${layout.overflow?'存在横向溢出':'无横向溢出'}`,detail:layout.title});
   if(layout.resources)blocked.add('页面请求了外部资源（已由隔离策略阻止）');
   shots.push({name:`${width}px.png`,width,height:960,dataUrl:'data:image/png;base64,'+(await page.screenshot({fullPage:false})).toString('base64'),artifactHash:hash});
  }
  await checkClipboard();
  const failed=trace.some(t=>t.status==='fail')||errors.length>0;
  const assertions=steps.filter(s=>assertionActions.includes(s.action)).length;
  // Rendering alone never proves a business workflow passed.
  result.verificationStatus=failed?'failed':blocked.size||!assertions?'partial':'verified';
  return {...result,artifactHash:hash,latencyMs:Date.now()-started,output:JSON.stringify({browserStepProtocol:'v5-typed-hover',requestedViewports,fixedObservationRealm:'chromium-cdp-isolated-v1',scope:assertions?'所列浏览器断言':'浏览器渲染与布局',assertions,errors,blockedResources:[...blocked],limitations:['截图仅覆盖两个视口的当前画面；美观与语义效果需独立评审。','不安装上传代码的依赖，不执行服务器命令，不访问外部网络。','桌面剪贴板始终禁用；copy-text 需隔离 Sandbox。']}),...(failed?{error:'浏览器运行、断言或布局检查存在失败'}:{})};
 }catch(error){return {...result,artifactHash:hash,latencyMs:Date.now()-started,verificationStatus:timedOut||error instanceof BrowserCapabilityUnavailable||clipboardBlocked?'unverified':'failed',error:String(error),output:timedOut?'执行超时，需补充验证。':String(error)};}
 finally{clearTimeout(timer);await observer?.close().catch(()=>{});await context.close().catch(()=>{});}
}
