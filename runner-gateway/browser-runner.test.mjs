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

// Actual asynchronous pages must be observed after their input/click handlers settle.
function delayedArtifact(effect){
 return {name:'delayed.html',content:'<!doctype html><html><meta name="viewport" content="width=device-width"><body><input id="input"><button id="go">Go</button><p id="status">idle</p><div id="result" style="display:none">ready</div><div id="rows"></div><script>let changes=0;function update(){changes++;setTimeout(()=>{'+effect+'},180)}document.querySelector("#input").addEventListener("input",update);document.querySelector("#go").addEventListener("click",update);</script></body></html>'};
}
test('readiness: waits for delayed text after fill without repeating the input',async()=>{
 const result=await executeBrowserTest({artifact:delayedArtifact('document.querySelector("#status").textContent="ready "+changes;'),testCase:{id:'delayed-text',browserSteps:[{action:'fill',selector:'#input',value:'query'},{action:'text',selector:'#status',value:'ready 1'}]}});
 assert.equal(result.verificationStatus,'verified',result.error);
 assert.equal(result.trace.filter(t=>t.summary==='fill #input').length,1);
 assert.equal(result.screenshots.length,2);
 assert.ok(result.screenshots.every(s=>s.artifactHash===result.artifactHash));
});
test('readiness: waits for delayed exact count after click',async()=>{
 const result=await executeBrowserTest({artifact:delayedArtifact('document.querySelector("#rows").innerHTML="<span class=row>one</span>";'),testCase:{id:'delayed-count',browserSteps:[{action:'click',selector:'#go'},{action:'count',selector:'.row',count:1}]}});
 assert.equal(result.verificationStatus,'verified',result.error);
 assert.equal(result.trace.filter(t=>t.summary==='click #go').length,1);
});
test('readiness: waits for a hidden result becoming visible',async()=>{
 const result=await executeBrowserTest({artifact:delayedArtifact('document.querySelector("#result").style.display="block";'),testCase:{id:'delayed-visible',browserSteps:[{action:'fill',selector:'#input',value:'query'},{action:'visible',selector:'#result'}]}});
 assert.equal(result.verificationStatus,'verified',result.error);
});
test('readiness: wrong delayed text stays failed and has no passing assertion trace',async()=>{
 const result=await executeBrowserTest({artifact:delayedArtifact('document.querySelector("#status").textContent="wrong";'),testCase:{id:'wrong-delayed-text',browserSteps:[{action:'fill',selector:'#input',value:'query'},{action:'text',selector:'#status',value:'ready'}]}});
 assert.equal(result.verificationStatus,'failed');
 assert.ok(result.error);
 assert.equal(result.trace.filter(t=>t.summary==='text #status').length,0);
 assert.equal(result.screenshots.length,0);
 assert.ok(result.latencyMs<20000);
});
test('readiness: wrong delayed count stays failed',async()=>{
 const result=await executeBrowserTest({artifact:delayedArtifact('document.querySelector("#rows").innerHTML="<span class=row>one</span><span class=row>two</span>";'),testCase:{id:'wrong-delayed-count',browserSteps:[{action:'click',selector:'#go'},{action:'count',selector:'.row',count:1}]}});
 assert.equal(result.verificationStatus,'failed');
 assert.equal(result.trace.filter(t=>t.summary==='count .row').length,0);
 assert.ok(result.latencyMs<20000);
});
test('readiness: a result which stays hidden cannot pass',async()=>{
 const result=await executeBrowserTest({artifact:delayedArtifact('document.querySelector("#status").textContent="done";'),testCase:{id:'still-hidden',browserSteps:[{action:'click',selector:'#go'},{action:'visible',selector:'#result'}]}});
 assert.equal(result.verificationStatus,'failed');
 assert.equal(result.trace.filter(t=>t.summary==='visible #result').length,0);
});
test('readiness: text keeps literal whitespace and metacharacters',async()=>{
 const artifact={name:'literal.html',content:'<!doctype html><html><meta name="viewport" content="width=device-width"><body><pre id="status">prefix A  B [x]. suffix</pre></body></html>'};
 const result=await executeBrowserTest({artifact,testCase:{id:'literal-text',browserSteps:[{action:'text',selector:'#status',value:'A  B [x].'}]}});
 assert.equal(result.verificationStatus,'verified',result.error);
});
test('readiness: text must not collapse meaningful whitespace',async()=>{
 const artifact={name:'literal.html',content:'<!doctype html><html><meta name="viewport" content="width=device-width"><body><pre id="status">A  B</pre></body></html>'};
 const result=await executeBrowserTest({artifact,testCase:{id:'wrong-whitespace',browserSteps:[{action:'text',selector:'#status',value:'A B'}]}});
 assert.equal(result.verificationStatus,'failed');
});
test('readiness: text metacharacters are literal rather than executable patterns',async()=>{
 const artifact={name:'literal.html',content:'<!doctype html><html><body><p id="status">xAy</p></body></html>'};
 const result=await executeBrowserTest({artifact,testCase:{id:'wrong-metacharacter',browserSteps:[{action:'text',selector:'#status',value:'x.y'}]}});
 assert.equal(result.verificationStatus,'failed');
});

function asyncSearchHtml(){
 return '<!doctype html><html><meta name="viewport" content="width=device-width"><style>.search-hidden{display:none}</style><body><input id="search"><span id="searchCount">2 页</span><article class="slide-card" id="slide-2" data-search="intro">Intro</article><article class="slide-card" id="slide-3" data-search="end">End</article><script>const search=document.querySelector("#search");search.addEventListener("input",()=>{const query=search.value;setTimeout(()=>{let visible=0;document.querySelectorAll(".slide-card").forEach(card=>{const ok=!query||card.dataset.search.includes(query);card.classList.toggle("search-hidden",!ok);if(ok)visible++});document.querySelector("#searchCount").textContent=query?visible+" 页命中":"2 页";},180)});</script></body></html>';
}
test('async protected search rejects a Candidate which hides every nonempty query',async()=>{
 const content=asyncSearchHtml();
 const steps=sourceGroundedHtmlProtectionSteps({sourceArtifacts:[{id:'html',role:'target',extension:'html',textContent:content}]},[{id:'PROTECT-ALL',artifactIds:['html']}],{id:'async-protect',executionMode:'external-runner'});
 assert.ok(steps?.length);
 const broken=content.replace('card.dataset.search.includes(query)','false');
 const result=await executeBrowserTest({artifact:{name:'guide.html',content:broken},testCase:{id:'async-protect',browserSteps:steps}});
 assert.equal(result.verificationStatus,'failed');
});
test('async protected search preserves a working delayed filter',async()=>{
 const content=asyncSearchHtml();
 const steps=sourceGroundedHtmlProtectionSteps({sourceArtifacts:[{id:'html',role:'target',extension:'html',textContent:content}]},[{id:'PROTECT-ALL',artifactIds:['html']}],{id:'async-protect',executionMode:'external-runner'});
 const result=await executeBrowserTest({artifact:{name:'guide.html',content},testCase:{id:'async-protect',browserSteps:steps}});
 assert.equal(result.verificationStatus,'verified',result.error);
});
test('readiness: text preserves every regex operator as a literal',async()=>{
 const literal='^$.*+?()[]{}|\\';
 const artifact={name:'literal.html',content:'<!doctype html><html><body><pre id="status">prefix '+literal+' suffix</pre></body></html>'};
 const result=await executeBrowserTest({artifact,testCase:{id:'all-literals',browserSteps:[{action:'text',selector:'#status',value:literal}]}});
 assert.equal(result.verificationStatus,'verified',result.error);
});
