import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executeLocalNativeHtml,localNativeKernelIdentity} from './index.mjs';

function fixture(observe){
 const launches=[],browsers=[];
 const chromium={launch:async options=>{launches.push(options);let connected=true;const browser={version:()=>"156.0",isConnected:()=>connected,close:async()=>{connected=false;}};browsers.push(browser);return browser;}};
 const observeNativeHtml=observe??(async({launchBrowser})=>{await (await launchBrowser()).close();await (await launchBrowser()).close();return {physicalFixture:true};});
 return {launches,browsers,ports:{chromium,observeNativeHtml}};
}
test('fresh sandboxed headless processes exclude credential environment even with the legacy CI bypass',async()=>{
 const old=process.env.RUNNER_BROWSER_CI_NO_SANDBOX,secret=process.env.EVOLUTION_TEST_SECRET;
 process.env.RUNNER_BROWSER_CI_NO_SANDBOX='1';process.env.EVOLUTION_TEST_SECRET='never-forward';
 try{
  const x=fixture(),result=await executeLocalNativeHtml({inputs:{},subjects:{}},x.ports);
  assert.equal(x.launches.length,2);assert.notEqual(x.browsers[0],x.browsers[1]);
  for(const options of x.launches){assert.equal(options.chromiumSandbox,true);assert.equal(options.headless,true);assert.equal(options.env.EVOLUTION_TEST_SECRET,undefined);assert.equal(options.env.RUNNER_BROWSER_CI_NO_SANDBOX,undefined);assert.equal(options.args,undefined);}
  assert.ok(x.browsers.every(b=>!b.isConnected()));assert.deepEqual(result.measurement,{physicalFixture:true});
  assert.equal(result.kernelSha256,localNativeKernelIdentity().kernelSha256);
 }finally{if(old===undefined)delete process.env.RUNNER_BROWSER_CI_NO_SANDBOX;else process.env.RUNNER_BROWSER_CI_NO_SANDBOX=old;if(secret===undefined)delete process.env.EVOLUTION_TEST_SECRET;else process.env.EVOLUTION_TEST_SECRET=secret;}
});
test('refuses missing and inconsistent subject execution and closes every process',async()=>{
 for(const mode of ['missing','version','observer']){
  const x=fixture(async({launchBrowser})=>{await launchBrowser();if(mode==='observer')throw Error('fixture-failure');if(mode==='version')await launchBrowser();return {};});
  if(mode==='version'){let n=0;const launch=x.ports.chromium.launch;x.ports.chromium.launch=async o=>{const b=await launch(o);b.version=()=>String(++n);return b;};}
  await assert.rejects(executeLocalNativeHtml({inputs:{},subjects:{}},x.ports));assert.ok(x.browsers.every(b=>!b.isConnected()));
 }
});
test('sandbox launch failures never downgrade flags or invoke an observer subject',async()=>{
 const options=[];let returned=false;
 await assert.rejects(executeLocalNativeHtml({inputs:{},subjects:{}},{chromium:{launch:async o=>{options.push(o);throw Error('sandbox unavailable');}},observeNativeHtml:async({launchBrowser})=>{await launchBrowser();returned=true;}}),/Sandboxed local browser unavailable/);
 assert.equal(returned,false);assert.ok(options.length>0&&options.every(o=>o.chromiumSandbox===true));
});
test('deadline closes a browser that finishes launching after timeout',async()=>{
 const x=fixture(async({launchBrowser})=>{await launchBrowser();return {};});
 const launch=x.ports.chromium.launch;x.ports.chromium.launch=async o=>{await new Promise(resolve=>setTimeout(resolve,1100));return launch(o);};
 await assert.rejects(executeLocalNativeHtml({inputs:{},subjects:{},timeoutMs:1000},x.ports),/deadline exceeded/);
 await new Promise(resolve=>setTimeout(resolve,200));assert.equal(x.browsers.length,1);assert.equal(x.browsers[0].isConnected(),false);
});
test('cleanup failure cannot be returned as observed success',async()=>{
 const x=fixture();x.ports.chromium.launch=async()=>({version:()=>"156",isConnected:()=>true,close:async()=>{throw Error('cleanup fixture');}});
 await assert.rejects(executeLocalNativeHtml({inputs:{},subjects:{}},x.ports),/cleanup incomplete/);
});
