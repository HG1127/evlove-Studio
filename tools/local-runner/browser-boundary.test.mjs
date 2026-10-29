import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {executeLocalNativeHtml} from './index.mjs';
import {createLocalNativePage} from './browser-boundary.mjs';

// Trusted fixture only. This test never reads or executes user HTML.
test('real local browser denies document egress and keeps clipboard and storage inside fresh processes',{timeout:45000},async()=>{
 let requests=0;
 const server=createServer((_,response)=>{requests++;response.end('must never reach this server');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const target='http://127.0.0.1:'+server.address().port;
 try{
  const output=await executeLocalNativeHtml({inputs:{},subjects:{},timeoutMs:40000},{chromium,observeNativeHtml:async({launchBrowser})=>{
   const facts=[];
   for(const label of ['original','candidate']){
    const browser=await launchBrowser();
    console.log('local boundary fixture: '+label+' browser launched');
    try{
     const {context,page,blocked,pageErrors}=await createLocalNativePage(browser,new TextEncoder().encode('<!doctype html><body>Trusted local boundary fixture</body>'));
     await page.goto('http://127.0.0.1:4173/');
     console.log('local boundary fixture: '+label+' document loaded');
     const before=await page.evaluate(async()=>({clipboard:await navigator.clipboard.readText(),storage:localStorage.getItem('fixture')}));
     assert.equal(before.clipboard,'');assert.equal(before.storage,null);
     console.log('local boundary fixture: '+label+' clipboard empty');
     await page.evaluate(async()=>{localStorage.setItem('fixture','original');await navigator.clipboard.writeText('trusted-local-clipboard-fixture');});
     assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'trusted-local-clipboard-fixture');
     console.log('local boundary fixture: '+label+' clipboard write verified');
     const failures=await page.evaluate(async target=>{
      // Playwright's service-worker block may leave registration pending rather than reject it.
      // Check that no worker starts and no request reaches the server; never wait on that promise.
      void navigator.serviceWorker.register('/worker.js').catch(()=>{});
      const results=await Promise.allSettled([fetch(target+'/fetch'),fetch('file:///C:/Windows/win.ini')]);
      const websocket=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture WebSocket result remained unknown')),2000);const done=value=>{clearTimeout(timer);resolve(value);};try{const socket=new WebSocket(target.replace('http:','ws:'));socket.onerror=()=>done(true);socket.onclose=()=>done(true);socket.onopen=()=>{done(false);socket.close();};}catch{done(true);}});
      const frame=document.createElement('iframe');frame.src=target+'/frame';document.body.append(frame);
      window.open(target+'/popup');
      return {rejected:results.map(r=>r.status==='rejected'),websocket,nodeAbsent:typeof process==='undefined'&&typeof require==='undefined'};
     },target);
     assert.deepEqual(failures,{rejected:[true,true],websocket:true,nodeAbsent:true});
     await page.waitForTimeout(100);assert.equal(context.pages().length,1);assert.equal(context.serviceWorkers().length,0);
     await page.evaluate(()=>alert('trusted boundary fixture'));assert.ok(pageErrors.includes('unexpected-dialog'));
     const downloadEvent=page.waitForEvent('download',{timeout:3000});
     await page.evaluate(()=>{const a=document.createElement('a');a.href='data:text/plain,trusted-fixture';a.download='trusted-fixture.txt';a.click();});
     const download=await downloadEvent;assert.ok(await download.failure());
     const navigation=await page.goto(target+'/navigation').catch(()=>undefined);assert.equal(navigation,undefined);
     assert.ok(blocked.length>0);facts.push({label,networkDenied:true,clipboardFresh:true,storageFresh:true});
     await context.close();
    }finally{await browser.close();}
   }
   return {subjects:facts};
  }});
  assert.equal(requests,0);assert.equal(output.measurement.subjects.length,2);
  console.log(JSON.stringify({kind:'local-browser-boundary-fixture',browserVersion:output.browserVersion,kernelSha256:output.kernelSha256,networkRequests:requests,subjects:output.measurement.subjects}));
 }finally{await new Promise(resolve=>server.close(resolve));}
});
