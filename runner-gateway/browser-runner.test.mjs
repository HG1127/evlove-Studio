import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {executeBrowserTest,closeBrowser,validateBrowserSteps} from './browser-runner.mjs';
import {sourceGroundedHtmlProtectionSteps} from '../packages/core/src/html-protection-browser-steps.ts';
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
test('source-grounded protection checks exercise search and catch a broken Candidate',async()=>{
 const content=`<!doctype html><html><head><style>.search-hidden{display:none}</style></head><body>
 <input id="search"><span id="searchCount">2 页</span>
 <article class="slide-card" id="slide-2" data-search="intro">Intro</article>
 <article class="slide-card" id="slide-3" data-search="end">End</article>
 <script>const search=document.querySelector('#search');search.addEventListener('input',()=>{
  let visible=0;document.querySelectorAll('.slide-card').forEach(card=>{const ok=!search.value||card.dataset.search.includes(search.value);card.classList.toggle('search-hidden',!ok);if(ok)visible++});
  document.querySelector('#searchCount').textContent=search.value?visible+' 页命中':'2 页';
 });</script></body></html>`;
 const project={sourceArtifacts:[{id:'html',role:'target',extension:'html',textContent:content}]};
 const criterion={id:'PROTECT-ALL',artifactIds:['html']};
 const testCase={id:'protect',executionMode:'external-runner'};
 const steps=sourceGroundedHtmlProtectionSteps(project,[criterion],testCase);
 assert.ok(steps?.length);
 const good=await executeBrowserTest({artifact:{name:'guide.html',content},testCase:{id:'protect',browserSteps:steps}});
 assert.equal(good.verificationStatus,'verified');
 const broken=content.replace("card.classList.toggle('search-hidden',!ok)","card.classList.toggle('search-hidden',false)");
 const bad=await executeBrowserTest({artifact:{name:'guide.html',content:broken},testCase:{id:'protect',browserSteps:steps}});
 assert.equal(bad.verificationStatus,'failed');
 const hidesEveryQuery=content.replace('card.dataset.search.includes(search.value)','false');
 const falseNegative=await executeBrowserTest({artifact:{name:'guide.html',content:hidesEveryQuery},testCase:{id:'protect-positive',browserSteps:steps}});
 assert.equal(falseNegative.verificationStatus,'failed');
});
test('reject arbitrary scripts and malformed steps',()=>{
 assert.throws(()=>validateBrowserSteps([{action:'evaluate',selector:'body',value:'process.exit()'}]));
 assert.throws(()=>validateBrowserSteps([{action:'count',selector:'body',count:-1}]));
});
