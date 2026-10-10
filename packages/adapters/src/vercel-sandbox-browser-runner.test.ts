import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createServer,type Server} from "node:http";
import {createRequire} from "node:module";
import {mkdtemp,mkdir,writeFile,symlink,unlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve,relative,isAbsolute,basename} from "node:path";
import {createHash} from "node:crypto";
import {TestCaseSchema,type EvolveProject,type TestCase} from "@evolution/contracts";
import {normalizeEvalSuiteForProject} from "@evolution/core";
import {VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT,sandboxBrowserCommandTimeoutMs} from "./vercel-sandbox-browser-runner";

const html='<!doctype html><html><meta name="viewport" content="width=device-width"><body><input id="input"><button id="go">Go</button><p id="status">idle</p><div id="result" style="display:none">ready</div><div id="never" style="display:none">never</div><div id="rows"></div><pre id="literal">prefix A  B [x]. ^$.*+?()[]{}|\\ suffix</pre><p id="pattern">xAy</p><script>let changes=0;function update(){changes++;setTimeout(()=>{document.querySelector("#status").textContent="ready "+changes;document.querySelector("#result").style.display="block";document.querySelector("#rows").innerHTML="<span class=row>one</span>";},180)}document.querySelector("#input").addEventListener("input",update);document.querySelector("#go").addEventListener("click",update);</script></body></html>';
const searchHtml='<!doctype html><html><meta name="viewport" content="width=device-width"><style>.search-hidden{display:none}</style><body><input id="search"><span id="searchCount">2 页</span><article class="slide-card" id="slide-2" data-search="intro">Intro</article><article class="slide-card" id="slide-3" data-search="intro end">End</article><script>const search=document.querySelector("#search");search.addEventListener("input",()=>{const query=search.value;setTimeout(()=>{let visible=0;document.querySelectorAll(".slide-card").forEach(card=>{const ok=!query||card.dataset.search.includes(query);card.classList.toggle("search-hidden",!ok);if(ok)visible++});document.querySelector("#searchCount").textContent=query?visible+" 页命中":"2 页";},180)});</script></body></html>';
const searchProject={
 sourceArtifacts:[{id:"html",role:"target",extension:"html",textContent:searchHtml}],
 acceptanceRubric:[{id:"PROTECT-ALL",title:"保护搜索",requirement:"搜索和清除可用",validationMethod:"semantic-judge",protectedConstraint:true,artifactIds:["html"],evidenceExpected:["搜索可用"]}],
} as unknown as EvolveProject;
const searchCase=TestCaseSchema.parse({id:"search",title:"保护搜索",input:"检查搜索",expected:["搜索和清除可用"],hidden:true,criterionIds:["PROTECT-ALL"],executionMode:"external-runner"});
const searchSteps=normalizeEvalSuiteForProject(searchProject,[],[searchCase]).hiddenCases[0]!.browserSteps!;

type Step={action:"fill"|"click"|"text"|"visible"|"count";selector:string;value?:string;count?:number};
const fill:Step={action:"fill",selector:"#input",value:"query"};
const click:Step={action:"click",selector:"#go"};
const cases=[
 {id:"delayed-text",steps:[fill,{action:"text",selector:"#status",value:"ready 1"}],status:"verified"},
 {id:"delayed-count",steps:[click,{action:"count",selector:".row",count:1}],status:"verified"},
 {id:"delayed-visible",steps:[fill,{action:"visible",selector:"#result"}],status:"verified"},
 {id:"wrong-text",steps:[fill,{action:"text",selector:"#status",value:"ready 2"}],status:"failed"},
 {id:"wrong-count",steps:[click,{action:"count",selector:".row",count:2}],status:"failed"},
 {id:"wrong-visible",steps:[click,{action:"visible",selector:"#never"}],status:"failed"},
 {id:"literal-text",steps:[{action:"text",selector:"#literal",value:"A  B [x]. ^$.*+?()[]{}|\\"}],status:"verified"},
 {id:"wrong-whitespace",steps:[{action:"text",selector:"#literal",value:"A B"}],status:"failed"},
 {id:"wrong-pattern",steps:[{action:"text",selector:"#pattern",value:"x.y"}],status:"failed"},
 {id:"render-only",steps:[],status:"partial"},
] satisfies Array<{id:string;steps:Step[];status:string}>;
type Result={testCaseId:string;verificationStatus:string;latencyMs:number;error?:string;assertions:number;trace:Array<{id:string;status:string;summary:string}>};
const run=promisify(execFile);
let server:Server|undefined;
let root:string|undefined;
let results:Result[]=[];
const searchResults:Result[]=[];
const tempParent=resolve(tmpdir());

beforeAll(async()=>{
 root=await mkdtemp(join(tempParent,"evolution-sandbox-assertions-"));
 const runtime=join(root,"runtime");
 const browserModules=join(root,"browser","node_modules");
 await mkdir(runtime,{recursive:true});
 await mkdir(browserModules,{recursive:true});
 // Execute the actual versioned trusted script with its installed Playwright.
 // No cloud Sandbox, model, user Artifact or protected session is involved.
 const require=createRequire(import.meta.url);
 const playwrightRequire=createRequire(require.resolve("@playwright/test/package.json"));
 await symlink(dirname(playwrightRequire.resolve("playwright/package.json")),join(browserModules,"playwright"),process.platform==="win32"?"junction":"dir");
 const script=join(runtime,"browser-runner.mjs");
 await writeFile(script,VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT,"utf8");
 const fixtures:Record<string,string>={
  "/":html,"/search-good":searchHtml,"/search-slow":searchHtml.replace(",180)",",6000)"),
  "/search-hides-all":searchHtml.replace("card.dataset.search.includes(query)","false"),
  "/search-broken-clear":searchHtml.replace("!query||card.dataset.search.includes(query)","!!query&&card.dataset.search.includes(query)"),
 };
 server=createServer((req,res)=>{const reply=()=>{res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});res.end(fixtures[req.url??"/"]??html);};if(req.url==="/search-slow")setTimeout(reply,8000);else reply();});
 await new Promise<void>(resolveListen=>server!.listen(0,"127.0.0.1",resolveListen));
 const address=server.address();
 if(!address||typeof address==="string")throw new Error("No owned fixture HTTP listener");
 const environment:NodeJS.ProcessEnv={TEMP:root,TMP:root,NODE_OPTIONS:"--max-old-space-size=512"};
 for(const name of ["PATH","SystemRoot","USERPROFILE","LOCALAPPDATA","APPDATA","COMSPEC","HOME","PLAYWRIGHT_BROWSERS_PATH"]){
  if(process.env[name]!==undefined)environment[name]=process.env[name];
 }
 const parsedCases=cases.map(item=>TestCaseSchema.parse({
  id:item.id,title:item.id,input:"Synthetic asynchronous HTML",expected:["literal browser state"],
  hidden:true,executionMode:"external-runner",evidenceScope:"product-behavior",browserSteps:item.steps,
 }));
 const observe=async(inputCases:TestCase[],pathname:string)=>{
  const input=join(runtime,"browser-cases.json");
  await writeFile(input,JSON.stringify(inputCases),"utf8");
  const {stdout,stderr}=await run(process.execPath,[script,input,"http://127.0.0.1:"+address.port+pathname],{
   cwd:root,env:environment,timeout:sandboxBrowserCommandTimeoutMs(inputCases),maxBuffer:4*1024*1024,windowsHide:true,
  });
  if(stderr.trim())throw new Error("Unexpected trusted browser process error: "+stderr.slice(0,2000));
  const observed:Result[]=JSON.parse(stdout).results;
  if(!Array.isArray(observed)||observed.length!==inputCases.length)throw new Error("Incomplete generated runner results");
  return observed;
 };
 results=await observe(parsedCases,"/");
 for(const pathname of ["/search-good","/search-hides-all","/search-broken-clear","/search-slow"]){
  searchResults.push(...await observe([{...searchCase,id:pathname,browserSteps:searchSteps}],pathname));
 }
 const evidenceDir=process.env.EVOLUTION_BROWSER_ASSERTION_EVIDENCE_DIR;
 if(evidenceDir){
  await mkdir(evidenceDir,{recursive:true});
  await writeFile(join(evidenceDir,"generated-browser-results.json"),JSON.stringify({
   scriptSha256:createHash("sha256").update(VERCEL_SANDBOX_BROWSER_RUNNER_SCRIPT).digest("hex"),
   fixtureSha256:createHash("sha256").update(html).digest("hex"),
   searchFixtureSha256:createHash("sha256").update(searchHtml).digest("hex"),
   cases:parsedCases,results,searchSteps,searchResults,
   scope:"Actual trusted Sandbox script with local Chromium and synthetic HTTP fixtures; not cloud/Mission acceptance",
  },null,2),"utf8");
 }
},240000);

afterAll(async()=>{
 if(server)await new Promise<void>((resolveClose,reject)=>server!.close(error=>error?reject(error):resolveClose()));
 if(root){
  const target=resolve(root),child=relative(tempParent,target);
  if(!child||child.startsWith("..")||isAbsolute(child)||!basename(target).startsWith("evolution-sandbox-assertions-"))throw new Error("Unsafe fixture cleanup target");
  await unlink(join(target,"browser","node_modules","playwright")).catch(error=>{if(error.code!=="ENOENT")throw error;});
  await rm(target,{recursive:true,force:true});
 }
},60000);

describe("generated Sandbox browser assertion readiness",()=>{
 for(const item of cases){
  it(item.id,()=>{
   const result=results.find(value=>value.testCaseId===item.id)!;
   expect(result).toBeDefined();
   expect(result.verificationStatus,result.error).toBe(item.status);
   if(item.status==="verified"){
    const steps=result.trace.filter(step=>step.id.startsWith("step-"));
    expect(steps).toHaveLength(item.steps.length);
    expect(steps.every(step=>step.status==="pass")).toBe(true);
    expect(result.assertions).toBe(1);
   }
   if(item.status==="failed")expect(result.trace.some(step=>step.id.startsWith("step-")&&step.status==="fail")).toBe(true);
   if(item.steps.some(step=>step.action==="fill"||step.action==="click")){
    expect(result.trace.filter(step=>step.summary==="fill #input"||step.summary==="click #go")).toHaveLength(1);
   }
  });
 }
 for(const [pathname,status] of [["/search-good","verified"],["/search-hides-all","failed"],["/search-broken-clear","failed"],["/search-slow","verified"]]){
  it(pathname,()=>{
   const result=searchResults.find(value=>value.testCaseId===pathname)!;
   expect(result).toBeDefined();
   expect(result.verificationStatus,result.error).toBe(status);
   if(status==="verified"){
    if(pathname==="/search-slow")expect(result.latencyMs).toBeGreaterThan(30_000);
    const steps=result.trace.filter(step=>step.id.startsWith("step-"));
    expect(steps).toHaveLength(searchSteps.length);
    expect(steps.every(step=>step.status==="pass")).toBe(true);
    expect(result.assertions).toBe(searchSteps.filter(step=>["text","count","visible"].includes(step.action)).length);
   }else expect(result.trace.some(step=>step.id.startsWith("step-")&&step.status==="fail")).toBe(true);
  });
 }
});

describe("bounded Sandbox browser command budgets",()=>{
 it("budgets all 15 generated transitions instead of a fixed 30-second case",()=>{
  expect(searchSteps).toHaveLength(15);
  expect(sandboxBrowserCommandTimeoutMs([{browserSteps:searchSteps}])).toBe(150_000);
 });
 it("preserves the existing empty minimum and hard batch ceiling",()=>{
  expect(sandboxBrowserCommandTimeoutMs([])).toBe(30_000);
  expect(sandboxBrowserCommandTimeoutMs(Array.from({length:12},()=>({browserSteps:searchSteps})))).toBe(180_000);
 });
});
