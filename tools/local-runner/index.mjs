import {chromium} from 'playwright';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {observeNativeHtml} from './native-html-observer.mjs';
import {createLocalNativePage} from './browser-boundary.mjs';

const kernelSha256=createHash('sha256').update(readFileSync(new URL('./native-html-observer.mjs',import.meta.url))).update(readFileSync(new URL('./browser-boundary.mjs',import.meta.url))).update(readFileSync(new URL('./index.mjs',import.meta.url))).update(readFileSync(new URL('./package.json',import.meta.url))).digest('hex');
export function localNativeKernelIdentity(){
 return {kernelSha256,boundaryVersion:'local-browser-process-sandbox-v1'};
}
/** Actual trusted-fixture preflight. No user HTML, provider request or cloud allocation. */
export async function probeLocalNativeBrowser(){
 let phase='launch';
 try{
 const result=await executeLocalNativeHtml({inputs:{},subjects:{},timeoutMs:30000},{chromium,observeNativeHtml:async({launchBrowser})=>{
  let assertions=0;
  for(const label of ['original','candidate']){
   const browser=await launchBrowser();
   try{
    phase=label+'-context';const {context,page}=await createLocalNativePage(browser,new TextEncoder().encode('<!doctype html><button id="probe">0</button><script>document.querySelector("#probe").onclick=()=>document.querySelector("#probe").textContent="1";</script>'));
    try{
     phase=label+'-navigation';await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:8000});
     const checks=[await page.locator('#probe').isVisible()];await page.locator('#probe').click();checks.push(await page.locator('#probe').innerText()==='1');
     phase=label+'-clipboard-and-egress';checks.push(...await page.evaluate(async()=>{
      const before=await navigator.clipboard.readText(),emptyStorage=localStorage.getItem('preflight')===null;
      localStorage.setItem('preflight','isolated');await navigator.clipboard.writeText('local-native-preflight');
      const copied=await navigator.clipboard.readText()==='local-native-preflight';
      const denied=await fetch('https://evolution-preflight.invalid/').then(()=>false,()=>true);
      return [typeof process==='undefined'&&typeof require==='undefined',before==='',emptyStorage,copied,denied];
     }));
     checks.push(context.serviceWorkers().length===0);
     phase=label+'-viewport';for(const width of [390,1440]){await page.setViewportSize({width,height:900});checks.push(await page.evaluate(()=>innerWidth)===width);}
     if(checks.length!==10||!checks.every(Boolean))throw Error('Local browser preflight assertions incomplete');assertions+=checks.length;
    }finally{phase=label+'-cleanup';await context.close();}
   }finally{await browser.close();}
   void label;
  }
  return {assertions};
 }});
 return {ready:true,assertions:result.measurement.assertions,browserVersion:result.browserVersion,kernelSha256:result.kernelSha256,runId:result.runId};
 }catch(error){throw new Error('Local browser preflight incomplete at '+phase,{cause:error});}
}
/** Fresh headless processes; source documents receive no Node API or credential environment. */
export async function executeLocalNativeHtml({inputs,subjects,timeoutMs=170000},ports={chromium,observeNativeHtml}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>170000)throw Error('Local native execution timeout differs');
 const browsers=[],versions=[],identity=await localNativeKernelIdentity();let expired=false,timer;
 const closeAll=()=>Promise.allSettled(browsers.map(browser=>browser.close()));
 const launchBrowser=async()=>{
  if(expired)throw Error('Local native deadline exceeded');
  const channels=process.env.BROWSER_CHANNEL?[process.env.BROWSER_CHANNEL]:process.platform==='win32'?['msedge','chrome',undefined]:[undefined,'chrome','msedge'];
  const env=Object.fromEntries(['SystemRoot','SYSTEMROOT','WINDIR','PATH','TEMP','TMP','TMPDIR','DISPLAY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR'].flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]]]));
  for(const channel of channels){
   if(expired)throw Error('Local native deadline exceeded');
   let browser;
   try{browser=await ports.chromium.launch({headless:true,chromiumSandbox:true,timeout:10000,env,...(channel?{channel}:{})});}
   catch{continue;}
   browsers.push(browser);
   if(expired){await browser.close();throw Error('Local native deadline exceeded');}
   const version=browser.version();if(versions.length&&version!==versions[0])throw Error('Native subjects use different browser versions');versions.push(version);
   return browser;
  }
  throw Error('Sandboxed local browser unavailable; no cloud fallback attempted');
 };
 try{
  const measurement=await Promise.race([(ports.observeNativeHtml??observeNativeHtml)({inputs,subjects,launchBrowser}),new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;void closeAll();reject(Error('Local native deadline exceeded'));},timeoutMs);})]);
  if(versions.length!==2)throw Error('Both physical native subjects were not executed');
  return {measurement,browserVersion:versions[0],runId:'local-native-'+randomUUID(),kernelSha256:identity.kernelSha256};
 }finally{expired=true;clearTimeout(timer);await closeAll();if(browsers.some(browser=>browser.isConnected()))throw Error('Local native browser cleanup incomplete');}
}
