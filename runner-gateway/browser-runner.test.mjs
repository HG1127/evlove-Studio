import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {executeBrowserTest,closeBrowser,validateBrowserSteps,getBrowser} from './browser-runner.mjs';
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

function fixture(body,style=''){
 return {name:'typed.html',content:'<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>'+style+'</style></head><body>'+body+'</body></html>'};
}
async function runSteps(artifact,browserSteps){return executeBrowserTest({artifact,testCase:{id:'typed',browserSteps}});}
test('typed validation accepts the closed protocol without mutating defaults',()=>{
 const steps=[
  {action:'scroll-into-view',selector:'#target'},
  {action:'in-viewport',selector:'#target'},
  {action:'attribute',selector:'#target',name:'data-mode',value:'A [x]'},
  {action:'checked',selector:'#toggle',checked:false},
  {action:'scroll-position',selector:'html',min:-10,max:100,axis:'x'},
  {action:'computed-style',selector:'#target',property:'opacity',mode:'literal',value:'0.5'},
  {action:'computed-style',selector:'#target',property:'width',mode:'numeric-range',min:0,max:10000000},
  {action:'computed-style',selector:'#target',property:'transform',mode:'identity-transform'},
  {action:'computed-style',selector:'#target',property:'width',mode:'parent-relative',relativeTo:'#parent',min:0,max:1},
  {action:'copy-text',selector:'#copy',value:'exact'},
 ];
 const before=JSON.stringify(steps);assert.equal(validateBrowserSteps(steps),steps);assert.equal(JSON.stringify(steps),before);
 assert.doesNotThrow(()=>validateBrowserSteps(Array.from({length:24},()=>({action:'visible',selector:'body'}))));
});
test('typed validation rejects unsupported fields, nonfinite/range errors and supplied scripts',()=>{
 const cases=[null,{},[],{action:'evaluate',selector:'body'},
  {action:'click',selector:'body',script:'alert(1)'},
  {action:'scroll-into-view',selector:'body',value:'javascript:alert(1)'},
  {action:'in-viewport',selector:'body',ratio:1.1},{action:'in-viewport',selector:'body',expected:'false'},
  {action:'attribute',selector:'body',name:'onclick',value:'x'},{action:'attribute',selector:'body',name:'data-X',value:'x'},
  {action:'attribute',selector:'body',name:'class',value:'x',regex:true},
  {action:'checked',selector:'input',checked:1},
  {action:'scroll-position',selector:'body',min:0,max:1},{action:'scroll-position',selector:'html',min:2,max:1},
  {action:'scroll-position',selector:'html',min:-Infinity,max:1},{action:'scroll-position',selector:'html',min:0,max:10000001},
  {action:'computed-style',selector:'body',property:'color',mode:'literal',value:'red'},
  {action:'computed-style',selector:'body',property:'opacity',mode:'literal',value:' 0.5'},
  {action:'computed-style',selector:'body',property:'opacity',mode:'literal',value:'0x1'},
  {action:'computed-style',selector:'body',property:'opacity',mode:'numeric-range',min:0,max:1.01},
  {action:'computed-style',selector:'body',property:'display',mode:'numeric-range',min:0,max:1},
  {action:'computed-style',selector:'body',property:'width',mode:'identity-transform'},
  {action:'computed-style',selector:'body',property:'transform',mode:'identity-transform',tolerance:0.11},
  {action:'computed-style',selector:'body',property:'width',mode:'parent-relative',relativeTo:' ',min:0,max:1},
  {action:'computed-style',selector:'body',property:'width',mode:'parent-relative',relativeTo:'body',min:0,max:2},
  {action:'computed-style',selector:'body',property:'width',mode:'literal',value:''},
  {action:'copy-text',selector:'button',value:'x',readClipboard:true},
 ];
 for(const step of cases)assert.throws(()=>validateBrowserSteps([step]),JSON.stringify(step));
 assert.throws(()=>validateBrowserSteps(Array.from({length:25},()=>({action:'visible',selector:'body'}))));
 assert.throws(()=>validateBrowserSteps([{action:'attribute',selector:'body',name:'data-'+ 'a'.repeat(60),value:'x'}]));
 assert.throws(()=>validateBrowserSteps([{action:'copy-text',selector:'button',value:'x'.repeat(65537)}]));
});
test('scroll action moves once; viewport and position observe the resulting navigation',async()=>{
 const result=await runSteps(fixture('<div style="height:1500px"></div><div id="target" style="height:100px">target</div>'),[
  {action:'in-viewport',selector:'#target',expected:false},
  {action:'scroll-position',selector:'html',min:0,max:0},
  {action:'scroll-into-view',selector:'#target'},
  {action:'in-viewport',selector:'#target',ratio:1},
  {action:'scroll-position',selector:'html',min:500,max:2000},
 ]);
 assert.equal(result.verificationStatus,'verified',result.error);assert.equal(JSON.parse(result.output).assertions,4);
 assert.equal(result.trace.filter(t=>t.summary==='scroll-into-view #target').length,1);
});
test('broken navigation is not repaired by an in-viewport assertion',async()=>{
 const result=await runSteps(fixture('<button id="nav">Navigate</button><div style="height:1600px"></div><div id="target">target</div>'),[
  {action:'click',selector:'#nav'},{action:'in-viewport',selector:'#target'},
 ]);
 assert.equal(result.verificationStatus,'failed');assert.equal(result.trace.filter(t=>t.summary==='click #nav').length,1);
 assert.equal(result.trace.filter(t=>t.summary==='in-viewport #target').length,0);
});
test('broken navigation is not repaired by a scroll-position assertion',async()=>{
 const result=await runSteps(fixture('<button id="nav">Navigate</button><div style="height:1600px"></div><div id="target">target</div>'),[
  {action:'click',selector:'#nav'},{action:'scroll-position',selector:'html',min:1000,max:2000},
 ]);
 assert.equal(result.verificationStatus,'failed');assert.equal(result.trace.filter(t=>t.summary==='scroll-position html').length,0);
});
test('delayed typed observations settle without replaying a click',async()=>{
 const result=await runSteps(fixture('<button id="go">Go</button><input id="toggle" type="checkbox"><div id="parent" style="width:100px"><div id="bar" style="width:0;opacity:0;transform:translateY(8px)"></div></div><span id="state" data-state="idle"></span><script>let clicks=0;document.querySelector("#go").onclick=()=>{clicks++;setTimeout(()=>{document.querySelector("#state").setAttribute("data-state","A  B [x]. "+clicks);document.querySelector("#toggle").checked=true;document.querySelector("#bar").style.cssText="width:100px;opacity:1;transform:none"},180)}</script>'),[
  {action:'click',selector:'#go'},
  {action:'attribute',selector:'#state',name:'data-state',value:'A  B [x]. 1'},
  {action:'attribute',selector:'#state',name:'data-state',mode:'contains',value:'B [x].'},
  {action:'checked',selector:'#toggle',checked:true},
  {action:'computed-style',selector:'#bar',property:'opacity',mode:'numeric-range',min:1,max:1},
  {action:'computed-style',selector:'#bar',property:'transform',mode:'identity-transform'},
  {action:'computed-style',selector:'#bar',property:'width',mode:'numeric-range',min:100,max:100},
  {action:'computed-style',selector:'#bar',property:'width',mode:'parent-relative',relativeTo:'#parent',min:1,max:1},
 ]);
 assert.equal(result.verificationStatus,'verified',result.error);assert.equal(JSON.parse(result.output).assertions,7);
 assert.equal(result.trace.filter(t=>t.summary==='click #go').length,1);
});
test('effective opacity includes ordinary ancestors and ShadowRoot hosts',async()=>{
 const result=await runSteps(fixture('<div style="opacity:.5"><div id="child" style="opacity:.5">child</div><div id="host" style="opacity:.5"></div></div><script>document.querySelector("#host").attachShadow({mode:"open"}).innerHTML="<div id=shadow style=opacity:.5>shadow</div>"</script>'),[
  {action:'computed-style',selector:'#child',property:'opacity',mode:'literal',value:'0.25'},
  {action:'computed-style',selector:'#shadow',property:'opacity',mode:'numeric-range',min:0.125,max:0.125},
 ]);
 assert.equal(result.verificationStatus,'verified',result.error);
});
test('opacity hidden by an ancestor cannot be verified from the child opacity',async()=>{
 const result=await runSteps(fixture('<div style="opacity:0"><span id="child" style="opacity:1">child</span></div>'),[
  {action:'computed-style',selector:'#child',property:'opacity',mode:'numeric-range',min:1,max:1},
 ]);assert.equal(result.verificationStatus,'failed');
});
test('identity transform normalizes none and 2D/3D matrices; literal style remains literal',async()=>{
 const result=await runSteps(fixture('<div id="none"></div><div id="two" style="transform:matrix(1,0,0,1,0,0)"></div><div id="three" style="transform:matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)"></div>'),[
  ...['#none','#two','#three'].map(selector=>({action:'computed-style',selector,property:'transform',mode:'identity-transform',tolerance:0})),
  {action:'computed-style',selector:'#none',property:'display',mode:'literal',value:'block'},
  {action:'computed-style',selector:'#none',property:'visibility',mode:'literal',value:'visible'},
  {action:'computed-style',selector:'#two',property:'transform',mode:'literal',value:'matrix(1, 0, 0, 1, 0, 0)'},
 ]);assert.equal(result.verificationStatus,'verified',result.error);
});
test('a nonidentity transform fails its observation instead of being normalized away',async()=>{
 const result=await runSteps(fixture('<div id="target" style="transform:translateY(8px)">target</div>'),[
  {action:'computed-style',selector:'#target',property:'transform',mode:'identity-transform'},
 ]);assert.equal(result.verificationStatus,'failed');
});
test('relative width samples border boxes and requires a unique reference',async()=>{
 const artifact=fixture('<div class="parent" style="box-sizing:border-box;width:100px;padding:10px"><div id="target" style="width:40px"></div></div>');
 const good=await runSteps(artifact,[{action:'computed-style',selector:'#target',property:'width',mode:'parent-relative',relativeTo:'.parent',min:.4,max:.4}]);
 assert.equal(good.verificationStatus,'verified',good.error);
 const bad=await runSteps(fixture('<div class="parent"></div><div class="parent"></div><div id="target"></div>'),[
  {action:'computed-style',selector:'#target',property:'width',mode:'parent-relative',relativeTo:'.parent',min:0,max:1},
 ]);assert.equal(bad.verificationStatus,'failed');
});
test('zero relative denominator and unsupported CSS measurements remain UNVERIFIED',async()=>{
 const zero=await runSteps(fixture('<div id="parent" style="width:0"><div id="target" style="width:0"></div></div>'),[
  {action:'computed-style',selector:'#target',property:'width',mode:'parent-relative',relativeTo:'#parent',min:0,max:1},
 ]);assert.equal(zero.verificationStatus,'unverified',zero.error);
 const missing=await runSteps(fixture('<div id="target"></div><script>window.DOMMatrixReadOnly=undefined</script>'),[
  {action:'computed-style',selector:'#target',property:'transform',mode:'identity-transform'},
 ]);assert.equal(missing.verificationStatus,'verified','main-world DOMMatrix replacement cannot remove native isolated capability: '+missing.error);
 const nonPx=await runSteps(fixture('<span id="target">inline width auto</span>'),[
  {action:'computed-style',selector:'#target',property:'width',mode:'numeric-range',min:0,max:100},
 ]);assert.equal(nonPx.verificationStatus,'unverified',nonPx.error);
});
test('wrong literal attribute and checked state remain failed; absent attribute is not an empty value',async()=>{
 const artifact=fixture('<input id="toggle" type="checkbox"><div id="state" data-state="A  B [x]."></div>');
 const good=await runSteps(artifact,[{action:'checked',selector:'#toggle',checked:false}]);assert.equal(good.verificationStatus,'verified',good.error);
 for(const step of [
  {action:'attribute',selector:'#state',name:'data-state',value:'A B [x].'},
  {action:'attribute',selector:'#state',name:'data-state',mode:'contains',value:'[.*]'},
  {action:'attribute',selector:'#state',name:'data-missing',value:''},
  {action:'checked',selector:'#toggle',checked:true},
 ]){const bad=await runSteps(artifact,[step]);assert.equal(bad.verificationStatus,'failed');}
});
test('scroll alone remains partial; viewport zero ratio means positive intersection',async()=>{
 const artifact=fixture('<div style="height:1500px"></div><div id="target" style="height:100px">target</div>');
 const actionOnly=await runSteps(artifact,[{action:'scroll-into-view',selector:'#target'}]);assert.equal(actionOnly.verificationStatus,'partial');
 const offscreen=await runSteps(artifact,[{action:'in-viewport',selector:'#target',ratio:0,expected:false}]);assert.equal(offscreen.verificationStatus,'verified',offscreen.error);
});
test('copy-text preflight is UNVERIFIED before launch, click, or any clipboard operation',async()=>{
 await closeBrowser();const original=process.env.BROWSER_CHANNEL;process.env.BROWSER_CHANNEL='__must_not_launch_for_clipboard__';
 try{
  const result=await runSteps(fixture('<button id="copy">copy</button><script>throw new Error("must never load")</script>'),[
   {action:'click',selector:'#copy'},{action:'copy-text',selector:'#copy',value:'exact'},
  ]);
  assert.equal(result.verificationStatus,'unverified');assert.match(result.error,/copy-text capability UNVERIFIED/);
  assert.equal(result.trace.length,0);assert.equal(result.screenshots.length,0);assert.equal(JSON.parse(result.output).assertions,0);
  await assert.rejects(()=>runSteps(artifact,[{action:'copy-text',selector:'#copy',value:'x'},{action:'unknown',selector:'body'}]));
 }finally{if(original===undefined)delete process.env.BROWSER_CHANNEL;else process.env.BROWSER_CHANNEL=original;}
});
test('normal actions receive immutable clipboard guards without reading the desktop clipboard',async()=>{
 const result=await runSteps(fixture('<div id="status"></div><script>const nav=Object.getOwnPropertyDescriptor(navigator,"clipboard");const proto=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator),"clipboard");const exec=Object.getOwnPropertyDescriptor(Document.prototype,"execCommand");document.querySelector("#status").textContent=String(nav.configurable===false&&proto.configurable===false&&exec.configurable===false&&exec.writable===false&&Object.isFrozen(navigator.clipboard))</script>'),[
  {action:'text',selector:'#status',value:'true'},
 ]);assert.equal(result.verificationStatus,'verified',result.error);
});
test('a click requesting copy touches only the inert guard and remains UNVERIFIED',async()=>{
 // The guard is installed before this synthetic script. Calling its replacement
 // is not a native read/write: the native getter and methods are never invoked.
 const result=await runSteps(fixture('<button id="copy">copy</button><span id="status"></span><script>document.querySelector("#copy").onclick=()=>navigator.clipboard.writeText("synthetic only").catch(()=>{document.querySelector("#status").textContent="denied"})</script>'),[
  {action:'click',selector:'#copy'},{action:'text',selector:'#status',value:'denied'},
 ]);assert.equal(result.verificationStatus,'unverified',result.error);
});

test('blank child frames inherit clipboard guards without invoking native methods',async()=>{
 const result=await runSteps(fixture('<iframe id="child"></iframe><span id="status"></span><script>const child=document.querySelector("#child").contentWindow;document.querySelector("#status").textContent=String(child.__runnerClipboardGuardReady===true&&Object.getOwnPropertyDescriptor(child.navigator,"clipboard").configurable===false&&Object.getOwnPropertyDescriptor(child.Document.prototype,"execCommand").configurable===false)</script>'),[
  {action:'text',selector:'#status',value:'true'},
 ]);assert.equal(result.verificationStatus,'verified',result.error);
});
test('legacy copy and cut only reach disabled replacements and remain UNVERIFIED',async()=>{
 for(const command of [' COPY ','cut']){
  const result=await runSteps(fixture('<button id="copy">copy</button><script>document.querySelector("#copy").onclick=()=>document.execCommand('+JSON.stringify(command)+')</script>'),[
   {action:'click',selector:'#copy'},
  ]);assert.equal(result.verificationStatus,'unverified',result.error);
 }
});
test('clipboard denial setup failure is UNVERIFIED before loading HTML',async()=>{
 const instance=await getBrowser();const original=instance.newContext;
 instance.newContext=async function(...args){const context=await original.apply(this,args);context.grantPermissions=async()=>{throw new Error('synthetic capability unavailable')};return context;};
 try{
  const result=await runSteps(fixture('<script>throw new Error("must not load")</script>'),[{action:'visible',selector:'body'}]);
  assert.equal(result.verificationStatus,'unverified',result.error);assert.equal(result.trace.length,0);assert.equal(result.screenshots.length,0);
 }finally{instance.newContext=original;}
});
test('the 45s context deadline interrupts observation and never replays an action',async()=>{
 // Compress only the existing 45000ms context timer for this synthetic test.
 // Other browser/action timers retain their real values; production is unchanged.
 const original=globalThis.setTimeout;let deadlines=0;
 globalThis.setTimeout=(callback,delay,...args)=>{if(delay===45000)deadlines++;return original(callback,delay===45000?1200:delay,...args);};
 try{
  const result=await runSteps(delayedArtifact('document.querySelector("#status").textContent="done";'),[
   {action:'click',selector:'#go'},{action:'visible',selector:'#result'},
  ]);
  assert.equal(deadlines,1);assert.equal(result.verificationStatus,'unverified',result.error);assert.match(result.output,/执行超时/);
  assert.equal(result.trace.filter(t=>t.summary==='click #go').length,1);assert.equal(result.trace.filter(t=>t.summary==='visible #result').length,0);
  assert.ok(result.latencyMs<6000);
 }finally{globalThis.setTimeout=original;}
});

test('effective opacity follows an assigned slot and its shadow ancestors',async()=>{
 const artifact=fixture('<div id="host"><span id="slotted" slot="content" style="opacity:1">child</span></div><script>document.querySelector("#host").attachShadow({mode:"open"}).innerHTML="<div style=opacity:0><slot name=content></slot></div>"</script>');
 const falseVisible=await runSteps(artifact,[{action:'computed-style',selector:'#slotted',property:'opacity',mode:'numeric-range',min:1,max:1}]);
 assert.equal(falseVisible.verificationStatus,'failed','shadow ancestor opacity must not become a false 1');
 const hidden=await runSteps(artifact,[{action:'computed-style',selector:'#slotted',property:'opacity',mode:'literal',value:'0'}]);
 assert.equal(hidden.verificationStatus,'verified',hidden.error);
});

test('independent observation rejects forged main-world opacity and CSS getters',async()=>{
 const artifact=fixture('<div id="target" style="opacity:0">hidden</div><script>window.getComputedStyle=()=>({opacity:"1",getPropertyValue:()=>"1"});Object.defineProperty(Node.prototype,"parentElement",{get:()=>null,configurable:true})</script>');
 const result=await runSteps(artifact,[{action:'computed-style',selector:'#target',property:'opacity',mode:'numeric-range',min:1,max:1}]);
 assert.equal(result.verificationStatus,'failed','artifact getter must not forge physical opacity');
});
test('independent observation rejects forged main-world scroll position',async()=>{
 const artifact=fixture('<div style="height:2000px">no navigation</div><script>Object.defineProperty(window,"scrollY",{get:()=>1000,configurable:true})</script>');
 const result=await runSteps(artifact,[{action:'scroll-position',selector:'html',min:1000,max:1000}]);
 assert.equal(result.verificationStatus,'failed','artifact getter must not forge physical scroll');
});

test('independent observation preserves real CSS and shadow ancestry despite hostile prototypes',async()=>{
 const artifact=fixture('<div style="opacity:.5"><div id="host"></div></div><script>document.querySelector("#host").attachShadow({mode:"open"}).innerHTML="<span id=target style=opacity:.5>target</span>";window.getComputedStyle=()=>{throw new Error("forged CSS")};Document.prototype.querySelectorAll=()=>[];Element.prototype.querySelectorAll=()=>[];Element.prototype.getRootNode=()=>document;Object.defineProperty(Node.prototype,"parentElement",{get:()=>null,configurable:true});Object.defineProperty(Element.prototype,"shadowRoot",{get:()=>null,configurable:true})</script>');
 const result=await runSteps(artifact,[{action:'computed-style',selector:'#target',property:'opacity',mode:'numeric-range',min:.25,max:.25}]);
 assert.equal(result.verificationStatus,'verified',result.error);assert.equal(JSON.parse(result.output).fixedObservationRealm,'chromium-cdp-isolated-v1');
});
test('independent observation rejects forged geometry and transform constructors',async()=>{
 const geometry=fixture('<div id="parent" style="width:100px"><div id="target" style="width:20px"></div></div><script>Element.prototype.getBoundingClientRect=()=>({width:100,height:100,x:0,y:0,left:0,top:0,right:100,bottom:100})</script>');
 const width=await runSteps(geometry,[{action:'computed-style',selector:'#target',property:'width',mode:'parent-relative',relativeTo:'#parent',min:1,max:1}]);
 assert.equal(width.verificationStatus,'failed',width.error);
 const transform=fixture('<div id="target" style="transform:translateY(8px)">target</div><script>window.DOMMatrixReadOnly=class {constructor(){Object.assign(this,{m11:1,m12:0,m13:0,m14:0,m21:0,m22:1,m23:0,m24:0,m31:0,m32:0,m33:1,m34:0,m41:0,m42:0,m43:0,m44:1})}}</script>');
 const matrix=await runSteps(transform,[{action:'computed-style',selector:'#target',property:'transform',mode:'identity-transform'}]);
 assert.equal(matrix.verificationStatus,'failed',matrix.error);
});
test('independent observation preserves native width and matrix when main APIs return fake zero',async()=>{
 const artifact=fixture('<div id="parent" style="width:100px"><div id="target" style="width:100px;transform:none">target</div></div><script>Element.prototype.getBoundingClientRect=()=>({width:0,height:0});window.DOMMatrixReadOnly=()=>{throw new Error("forged constructor")};window.getComputedStyle=()=>({opacity:"0",getPropertyValue:()=>"0px"})</script>');
 const result=await runSteps(artifact,[
  {action:'computed-style',selector:'#target',property:'width',mode:'numeric-range',min:100,max:100},
  {action:'computed-style',selector:'#target',property:'width',mode:'parent-relative',relativeTo:'#parent',min:1,max:1},
  {action:'computed-style',selector:'#target',property:'transform',mode:'identity-transform'},
 ]);assert.equal(result.verificationStatus,'verified',result.error);
});
test('independent observation reads physical scroll despite a forged main getter',async()=>{
 const artifact=fixture('<div style="height:2000px">real navigation</div><script>window.scrollTo(0,1000);Object.defineProperty(window,"scrollY",{get:()=>0,configurable:true})</script>');
 const result=await runSteps(artifact,[{action:'scroll-position',selector:'html',min:1000,max:1000}]);
 assert.equal(result.verificationStatus,'verified',result.error);
});
test('independent viewport observation rejects forged intersection and geometry without scrolling',async()=>{
 const artifact=fixture('<div style="height:1600px"></div><div id="target" style="height:100px">below</div><script>Element.prototype.getBoundingClientRect=()=>({width:100,height:100,top:0,left:0,bottom:100,right:100});window.IntersectionObserver=class {constructor(callback){this.callback=callback}observe(){this.callback([{intersectionRatio:1}])}disconnect(){}}</script>');
 const result=await runSteps(artifact,[{action:'in-viewport',selector:'#target',ratio:1}]);
 assert.equal(result.verificationStatus,'failed',result.error);assert.equal(result.trace.filter(t=>t.summary==='in-viewport #target').length,0);
});
test('independent viewport observes true native intersection through hostile main APIs',async()=>{
 const artifact=fixture('<div id="target" style="height:100px">inside</div><script>Element.prototype.getBoundingClientRect=()=>({width:100,height:100,top:5000,left:0,bottom:5100,right:100});window.IntersectionObserver=class {constructor(callback){this.callback=callback}observe(){this.callback([{intersectionRatio:0}])}disconnect(){}}</script>');
 const result=await runSteps(artifact,[{action:'in-viewport',selector:'#target',ratio:1}]);
 assert.equal(result.verificationStatus,'verified',result.error);
});
async function withCDPHook(hook,run){
 const instance=await getBrowser();const original=instance.newContext;
 instance.newContext=async function(...args){const context=await original.apply(this,args);await hook(context);return context;};
 try{return await run();}finally{instance.newContext=original;}
}
test('independent CDP capability is mandatory before artifact load and never falls back',async()=>{
 const artifact=fixture('<script>throw new Error("must not load")</script>');
 for(const mode of ['missing','create-failed','default-realm']){
  const result=await withCDPHook(async context=>{
   if(mode==='missing'){context.newCDPSession=async()=>{throw new Error('CDP unavailable')};return;}
   const original=context.newCDPSession;
   context.newCDPSession=async function(...args){
    const session=await original.apply(this,args);
    if(mode==='create-failed'){const send=session.send;session.send=function(method,params){if(method==='Page.createIsolatedWorld')return Promise.reject(new Error('No isolated world'));return send.call(this,method,params)};}
    else{const on=session.on;session.on=function(name,listener){return on.call(this,name,name==='Runtime.executionContextCreated'?event=>listener({...event,context:{...event.context,auxData:{...event.context.auxData,isDefault:true}}}):listener)};}
    return session;
   };
  },()=>runSteps(artifact,[{action:'computed-style',selector:'html',property:'opacity',mode:'literal',value:'1'}]));
  assert.equal(result.verificationStatus,'unverified',mode+': '+result.error);assert.equal(result.trace.length,0);assert.equal(result.screenshots.length,0);
 }
});
test('independent CDP transport loss is UNVERIFIED; later complete mismatch clears transient absence',async()=>{
 for(const permanent of [true,false]){
  const result=await withCDPHook(async context=>{
   const original=context.newCDPSession;
   context.newCDPSession=async function(...args){
    const session=await original.apply(this,args);const send=session.send;let reads=0;
    session.send=function(method,params){
     if(method==='Runtime.callFunctionOn'&&params.arguments?.[0]?.value?.action==='computed-style'&&(permanent||reads++===0))return Promise.reject(new Error('Synthetic CDP loss'));
     return send.call(this,method,params);
    };
    return session;
   };
  },()=>runSteps(fixture('<div id="target" style="opacity:0">hidden</div>'),[{action:'computed-style',selector:'#target',property:'opacity',mode:'literal',value:'1'}]));
  assert.equal(result.verificationStatus,permanent?'unverified':'failed',result.error);
 }
});
test('independent CSS queries support css prefix and shadow roots but reject unsupported engines',async()=>{
 const artifact=fixture('<div id="target" style="opacity:1">target</div>');
 const css=await runSteps(artifact,[{action:'computed-style',selector:'css=#target',property:'opacity',mode:'literal',value:'1'}]);assert.equal(css.verificationStatus,'verified',css.error);
 const unsupported=await runSteps(artifact,[{action:'computed-style',selector:'text=target',property:'opacity',mode:'literal',value:'1'}]);assert.equal(unsupported.verificationStatus,'unverified',unsupported.error);
 const missing=await runSteps(artifact,[{action:'in-viewport',selector:'#missing',expected:false}]);assert.equal(missing.verificationStatus,'failed','missing elements cannot satisfy negative viewport');
});

test('legacy paste and platform clipboard command aliases reach only the inert guard',async()=>{
 // Execute only the immutable replacement installed before artifact code. The
 // delegate is never called for these commands; no native paste/read is invoked.
 for(const command of ['paste','PasteAndMatchStyle','pasteGlobalSelection','insertFromClipboard']){
  const result=await runSteps(fixture('<button id="paste">paste</button><script>document.querySelector("#paste").onclick=()=>document.execCommand('+JSON.stringify(command)+')</script>'),[{action:'click',selector:'#paste'}]);
  assert.equal(result.verificationStatus,'unverified',result.error);
 }
});

test('clipboard guard uses captured intrinsics despite hostile String RegExp and Function prototypes',async()=>{
 // Run only after the hardened guard exists. Do not reproduce the historical
 // unsafe delegate: this assertion calls its replacement and never a native copy.
 const artifact=fixture('<button id="copy">copy</button><script>document.querySelector("#copy").onclick=()=>document.execCommand("COPY");RegExp.prototype.test=()=>false;Function.prototype.call=function(){throw new Error("forged call")};window.String=()=>"bold";Reflect.apply=()=>{throw new Error("forged apply")}</script>');
 const result=await runSteps(artifact,[{action:'click',selector:'#copy'}]);
 assert.equal(result.verificationStatus,'unverified',result.error);
});
