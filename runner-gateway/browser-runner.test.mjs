import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {executeBrowserTest,closeBrowser,validateBrowserSteps} from './browser-runner.mjs';
after(closeBrowser);
const artifact={name:'fixture.html',content:'<!doctype html><html lang="zh"><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>验证样例</title><body><button id="save" onclick="document.querySelector(\'#status\').textContent=\'已保存\'">保存</button><p id="status">等待</p></body></html>'};
test('actual click and assertion succeed, desktop/mobile evidence hashes match',async()=>{
 const result=await executeBrowserTest({artifact,testCase:{id:'click',browserSteps:[{action:'click',selector:'#save'},{action:'text',selector:'#status',value:'已保存'}]}});
 assert.equal(result.verificationStatus,'verified');assert.equal(result.screenshots.length,2);assert.equal(result.screenshots[0].artifactHash,result.artifactHash);assert.equal(result.screenshots[1].width,390);
});
test('wrong expected value fails rather than fabricated success',async()=>{
 const result=await executeBrowserTest({artifact,testCase:{id:'negative',browserSteps:[{action:'text',selector:'#status',value:'已保存'}]}});
 assert.equal(result.verificationStatus,'failed');
});
test('rendering alone is partial, not E2E verified',async()=>{
 const result=await executeBrowserTest({artifact,testCase:{id:'render'}});assert.equal(result.verificationStatus,'partial');assert.equal(result.screenshots.length,2);
});
test('reject arbitrary scripts and malformed steps',()=>{
 assert.throws(()=>validateBrowserSteps([{action:'evaluate',selector:'body',value:'process.exit()'}]));
 assert.throws(()=>validateBrowserSteps([{action:'count',selector:'body',count:-1}]));
});
