import {chromium} from 'playwright';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {observeNativeHtml} from './native-html-observer.mjs';

const kernelSha256=createHash('sha256').update(readFileSync(new URL('./native-html-observer.mjs',import.meta.url))).update(readFileSync(new URL('./browser-boundary.mjs',import.meta.url))).update(readFileSync(new URL('./index.mjs',import.meta.url))).update(readFileSync(new URL('./package.json',import.meta.url))).digest('hex');
export function localNativeKernelIdentity(){
 return {kernelSha256,boundaryVersion:'local-browser-process-sandbox-v1'};
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
