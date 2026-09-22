import JSZip from "jszip";
import { Sandbox, type NetworkPolicy, type SandboxRegion } from "@vercel/sandbox";
import {
  SandboxBrowserHealthSchema,
  SandboxHealthSchema,
  SandboxPolicyCapabilitiesSchema,
  SandboxValidationRequestSchema,
  SandboxValidationResultSchema,
  SandboxTargetBatchResponseSchema,
  type SandboxCommand,
  type SandboxBrowserHealth,
  type SandboxHealth,
  type SandboxPolicyCapabilities,
  type SandboxTargetBatchResponse,
  type SandboxValidationRequest,
  type SandboxValidationResult,
  type SandboxStepResult,
  type TargetRunResult,
  type TestCase,
} from "@evolution/contracts";

const ROOT="/vercel/sandbox";
const MAX_LOG_CHARS=20_000;
const UNIVERSAL_RUNTIME_IMAGE="vercel/sandbox/universal:latest";
const SANDBOX_MIN_VCPUS=1;
const SANDBOX_MAX_VCPUS=4;
const SANDBOX_DEFAULT_VCPUS=2;
const SANDBOX_MAX_TIMEOUT_MS=30*60_000;
const SANDBOX_MAX_COMMAND_TIMEOUT_MS=15*60_000;
const SANDBOX_MAX_ARCHIVE_FILES=2500;
const SANDBOX_MAX_FILE_BYTES=20*1024*1024;
const SANDBOX_MAX_EXTRACTED_BYTES=100*1024*1024;
const BROWSER_RUNTIME_NAME="evolution-browser-pw163-v1";
const BROWSER_RUNTIME_VERSION="pw-1.63.0-v1";
const BROWSER_SNAPSHOT_TTL_MS=7*24*60*60*1000;
const BROWSER_PORT=4173;

let browserSnapshotPromise:Promise<string>|undefined;

export function getVercelSandboxPolicyCapabilities():SandboxPolicyCapabilities{
  return SandboxPolicyCapabilitiesSchema.parse({
    codeReady:true,
    runtimeImage:UNIVERSAL_RUNTIME_IMAGE,
    browserRuntimeVersion:BROWSER_RUNTIME_VERSION,
    playwrightVersion:"1.63.0",
    ephemeral:true,
    persistent:false,
    network:{
      defaultPolicy:"deny-all",
      installAllowlist:true,
      runtimeAllowlist:true,
      browserExternalRequests:"blocked",
    },
    resources:{
      minVcpus:SANDBOX_MIN_VCPUS,
      maxVcpus:SANDBOX_MAX_VCPUS,
      defaultVcpus:SANDBOX_DEFAULT_VCPUS,
      maxSandboxTimeoutMs:SANDBOX_MAX_TIMEOUT_MS,
      maxCommandTimeoutMs:SANDBOX_MAX_COMMAND_TIMEOUT_MS,
    },
    archive:{
      maxFiles:SANDBOX_MAX_ARCHIVE_FILES,
      maxFileBytes:SANDBOX_MAX_FILE_BYTES,
      maxExtractedBytes:SANDBOX_MAX_EXTRACTED_BYTES,
      crc32Validation:true,
      reservedPath:".evolution/",
    },
    logs:{
      maxCharsPerStream:MAX_LOG_CHARS,
      truncationEnabled:true,
    },
    artifactBinding:{
      sha256RequiredForCandidates:true,
      hashReverifiedBeforeExecution:true,
    },
    preview:{
      defaultPort:BROWSER_PORT,
      healthCheck:true,
      browserSteps:true,
      browserSnapshot:true,
    },
  });
}

const STATIC_SERVER_SCRIPT=String.raw`
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(process.argv[2]);
const port=Number(process.argv[3]||4173);
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".ico":"image/x-icon",".woff":"font/woff",".woff2":"font/woff2"};
const server=http.createServer((req,res)=>{
  const raw=decodeURIComponent((req.url||"/").split("?")[0]);
  const safe=raw.replace(/\\/g,"/").split("/").filter((part)=>part&&part!=="."&&part!=="..").join("/");
  let file=path.join(root,safe||"index.html");
  try{
    if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,"index.html");
    if(!fs.existsSync(file))file=path.join(root,"index.html");
    if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404);res.end("Not found");return;}
    res.writeHead(200,{"Content-Type":types[path.extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-store"});
    fs.createReadStream(file).pipe(res);
  }catch(error){res.writeHead(500);res.end(String(error));}
});
server.listen(port,"0.0.0.0",()=>console.log("EVOLUTION_PREVIEW_READY "+port));
`;

const BROWSER_RUNNER_SCRIPT=String.raw`
import fs from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "../browser/node_modules/playwright/index.mjs";
const cases=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const baseUrl=process.argv[3];
const baseOrigin=new URL(baseUrl).origin;
const browser=await chromium.launch({headless:true});
const results=[];
for(const testCase of cases){
  const started=Date.now();
  const trace=[];const errors=[];const blocked=[];const screenshots=[];
  const context=await browser.newContext({serviceWorkers:"block",acceptDownloads:false,viewport:{width:1440,height:960}});
  try{
    await context.route("**/*",route=>{
      const url=route.request().url();
      try{
        const parsed=new URL(url);
        if(parsed.origin===baseOrigin||parsed.protocol==="data:"||parsed.protocol==="blob:")return route.continue();
      }catch{}
      blocked.push(url);return route.abort();
    });
    const page=await context.newPage();
    page.setDefaultTimeout(7000);
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto(baseUrl,{waitUntil:"domcontentloaded",timeout:15000});
    trace.push({id:"open",stage:"browser-preview",status:"pass",summary:"真实 Preview 已在 Chromium 打开"});
    let failed;
    for(const [index,step] of (testCase.browserSteps||[]).entries()){
      try{
        const locator=page.locator(step.selector);
        if(step.action==="click")await locator.click();
        if(step.action==="fill")await locator.fill(step.value||"");
        if(step.action==="visible"&&!await locator.isVisible())throw new Error("元素不可见："+step.selector);
        if(step.action==="text"&&!(await locator.innerText()).includes(step.value||""))throw new Error("文本断言未通过："+step.selector);
        if(step.action==="count"&&await locator.count()!==step.count)throw new Error("数量断言未通过："+step.selector);
        trace.push({id:"step-"+index,stage:"browser-step",status:"pass",summary:step.action+" "+step.selector});
      }catch(error){
        failed=String(error);
        trace.push({id:"step-"+index,stage:"browser-step",status:"fail",summary:step.action+" "+step.selector,detail:failed});
        break;
      }
    }
    for(const viewport of [{name:"desktop",width:1440,height:900},{name:"mobile",width:390,height:844}]){
      await page.setViewportSize({width:viewport.width,height:viewport.height});
      const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+2,title:document.title}));
      trace.push({id:"viewport-"+viewport.width,stage:"layout",status:layout.overflow?"fail":"pass",summary:viewport.width+"px "+(layout.overflow?"存在横向溢出":"无横向溢出"),detail:layout.title});
      if(layout.overflow&&!failed)failed=viewport.width+"px 存在横向溢出";
      if(testCase.captureScreenshots){
        const bytes=await page.screenshot({type:"jpeg",quality:60,fullPage:false});
        if(bytes.length<=1500000){
          const artifactHash=createHash("sha256").update(bytes).digest("hex");
          screenshots.push({name:testCase.id+"-"+viewport.name+".jpg",width:viewport.width,height:viewport.height,dataUrl:"data:image/jpeg;base64,"+bytes.toString("base64"),artifactHash});
          trace.push({id:"screenshot-"+viewport.name,stage:"visual-evidence",status:"pass",summary:"已采集 "+viewport.name+" 真实截图",detail:artifactHash});
        }else{
          trace.push({id:"screenshot-"+viewport.name,stage:"visual-evidence",status:"warning",summary:"截图超过 1.5MB，未嵌入证据传输"});
        }
      }
    }
    const assertions=(testCase.browserSteps||[]).filter(step=>["visible","text","count"].includes(step.action)).length;
    const status=failed||errors.length?"failed":blocked.length||!assertions?"partial":"verified";
    results.push({testCaseId:testCase.id,verificationStatus:status,error:failed||errors[0],assertions,blockedResources:blocked.slice(0,20),screenshots,trace,latencyMs:Date.now()-started});
  }catch(error){
    results.push({testCaseId:testCase.id,verificationStatus:"failed",error:String(error),assertions:0,blockedResources:blocked.slice(0,20),trace,latencyMs:Date.now()-started});
  }finally{
    await context.close().catch(()=>{});
  }
}
await browser.close();
console.log(JSON.stringify({results}));
`;

function clipped(value:string){
  if(value.length<=MAX_LOG_CHARS)return value;
  return value.slice(0,MAX_LOG_CHARS)+"\n…[truncated]";
}

export function safeSandboxRelativePath(value:string){
  const normalized=value.replace(/\\/g,"/");
  if(!normalized||normalized.startsWith("/")||normalized.includes("\0"))throw new Error("Sandbox path 必须是安全相对路径");
  const parts=normalized.split("/");
  if(parts.some((part)=>!part||part==="."||part===".."))throw new Error("Sandbox path 包含非法路径段");
  return parts.join("/");
}

export function safeSandboxCwd(value:string,runtimeRoot=ROOT){
  const root=runtimeRoot.replace(/\\/g,"/").replace(/\/+$/,"");
  const normalized=value.replace(/\\/g,"/").replace(/\/+$/,"");
  if(normalized===ROOT||normalized===root)return root;
  if(normalized.startsWith(ROOT+"/")){
    const relative=normalized.slice(ROOT.length+1);
    return root+"/"+safeSandboxRelativePath(relative);
  }
  if(normalized.startsWith(root+"/")){
    const relative=normalized.slice(root.length+1);
    return root+"/"+safeSandboxRelativePath(relative);
  }
  if(normalized.startsWith("/"))throw new Error("Sandbox cwd 不允许跳出工作区");
  return root+"/"+safeSandboxRelativePath(normalized);
}

export function sandboxNetworkPolicy(domains:string[]):NetworkPolicy{
  const unique=[...new Set(domains.map((item)=>item.trim()).filter(Boolean))];
  return unique.length?{allow:unique}:"deny-all";
}

async function runStep(sandbox:Sandbox,command:SandboxCommand):Promise<SandboxStepResult>{
  const started=Date.now();
  const result=await sandbox.runCommand({
    cmd:command.command,
    args:command.args,
    cwd:safeSandboxCwd(command.cwd,sandbox.cwd),
    env:command.env,
    timeoutMs:command.timeoutMs,
  });
  const [stdout,stderr]=await Promise.all([result.stdout(),result.stderr()]);
  return {
    id:command.id,
    phase:command.phase,
    command:[command.command,...command.args].join(" "),
    exitCode:result.exitCode,
    durationMs:result.durationMs??Date.now()-started,
    stdout:clipped(stdout),
    stderr:clipped(stderr),
  };
}

async function waitForPreview(sandbox:Sandbox,args:{
  port:number;
  healthPath:string;
  timeoutMs:number;
}){
  const script=[
    "const port=Number(process.argv[1]);",
    "const path=process.argv[2];",
    "const deadline=Date.now()+Number(process.argv[3]);",
    "(async()=>{while(Date.now()<deadline){",
    "try{const r=await fetch('http://127.0.0.1:'+port+path);if(r.ok){console.log('READY');process.exit(0)}}catch{}",
    "await new Promise(r=>setTimeout(r,500));",
    "}console.error('preview timeout');process.exit(1)})()",
  ].join("");
  const result=await sandbox.runCommand("node",["-e",script,String(args.port),args.healthPath,String(args.timeoutMs)],{
    timeoutMs:args.timeoutMs+5_000,
  });
  return result.exitCode===0;
}

function isUnavailableError(error:unknown){
  const message=error instanceof Error?error.message:String(error);
  return /OIDC|credentials|VERCEL_OIDC_TOKEN|vercel link|sandbox.*not available|unauthori[sz]ed|forbidden/i.test(message);
}

async function ensureBrowserRuntimeSnapshot(){
  if(browserSnapshotPromise)return browserSnapshotPromise;
  browserSnapshotPromise=(async()=>{
    const base=await Sandbox.getOrCreate({
      name:BROWSER_RUNTIME_NAME,
      image:UNIVERSAL_RUNTIME_IMAGE,
      timeout:10*60_000,
      resources:{vcpus:SANDBOX_DEFAULT_VCPUS},
      networkPolicy:"deny-all",
      persistent:true,
      tags:{product:"evolution-os",purpose:"browser-runtime",version:BROWSER_RUNTIME_VERSION},
    });
    if(base.currentSnapshotId)return base.currentSnapshotId;

    await base.updateNetworkPolicy("allow-all");
    const mkdir=await base.runCommand("mkdir",["-p",".evolution/browser",".evolution/runtime"],{timeoutMs:10_000});
    if(mkdir.exitCode!==0)throw new Error("Browser Runtime 目录初始化失败");
    const npm=await base.runCommand("npm",["install","--prefix",".evolution/browser","playwright@1.63.0"],{timeoutMs:120_000});
    if(npm.exitCode!==0)throw new Error("Playwright Runtime 安装失败："+clipped(await npm.stderr()));
    const browser=await base.runCommand("node",[".evolution/browser/node_modules/playwright/cli.js","install","--with-deps","chromium"],{timeoutMs:240_000});
    if(browser.exitCode!==0)throw new Error("Chromium Runtime 安装失败："+clipped(await browser.stderr()));
    await base.writeFiles([
      {path:".evolution/runtime/static-server.mjs",content:STATIC_SERVER_SCRIPT},
      {path:".evolution/runtime/browser-runner.mjs",content:BROWSER_RUNNER_SCRIPT},
    ]);
    await base.updateNetworkPolicy("deny-all");
    const smoke=await base.runCommand("node",["-e",
      "import('./.evolution/browser/node_modules/playwright/index.mjs').then(async m=>{const b=await m.chromium.launch({headless:true});const p=await b.newPage();await p.setContent('<p id=ok>OK</p>');if(await p.locator('#ok').innerText()!=='OK')process.exit(2);await b.close()})",
    ],{timeoutMs:30_000});
    if(smoke.exitCode!==0)throw new Error("Chromium Runtime 启动失败："+clipped(await smoke.stderr()));
    const snapshot=await base.snapshot({expiration:BROWSER_SNAPSHOT_TTL_MS});
    return snapshot.snapshotId;
  })().catch((error)=>{
    browserSnapshotPromise=undefined;
    throw error;
  });
  return browserSnapshotPromise;
}

type PreviewPlan={
  command:string;
  args:string[];
  cwd:string;
  env:Record<string,string>;
  label:string;
};

function packageScriptInvocation(manager:string,name:string,extraArgs:string[]=[]){
  if(manager==="pnpm")return{command:"corepack",args:["pnpm","run",name,...(extraArgs.length?["--",...extraArgs]:[])]};
  if(manager==="yarn")return{command:"corepack",args:["yarn","run",name,...extraArgs]};
  if(manager==="bun")return{command:"bun",args:["run",name,...(extraArgs.length?["--",...extraArgs]:[])]};
  return{command:"npm",args:["run",name,...(extraArgs.length?["--",...extraArgs]:[])]};
}

async function detectStaticPreviewDir(sandbox:Sandbox,cwd:string){
  const probe=await sandbox.runCommand({
    cmd:"node",
    args:[
      "-e",
      "const fs=require('fs'),p=require('path');for(const d of process.argv.slice(1)){if(fs.existsSync(p.join(d,'index.html'))){console.log(d);break}}",
      "dist","build","out",
    ],
    cwd:safeSandboxCwd(cwd,sandbox.cwd),
    timeoutMs:10_000,
  });
  if(probe.exitCode!==0)return undefined;
  const value=(await probe.stdout()).trim().split(/\r?\n/).at(-1)?.trim();
  return value&&["dist","build","out"].includes(value)?value:undefined;
}

async function previewPlanFor(sandbox:Sandbox,args:{manager:string;cwd:string;pkg:PackageJsonShape}):Promise<PreviewPlan|undefined>{
  const staticDir=await detectStaticPreviewDir(sandbox,args.cwd);
  if(staticDir)return{
    command:"node",
    args:[sandbox.cwd+"/.evolution/runtime/static-server.mjs",staticDir,String(BROWSER_PORT)],
    cwd:args.cwd,
    env:{PORT:String(BROWSER_PORT),HOST:"0.0.0.0"},
    label:"static-output",
  };
  const scripts=args.pkg.scripts??{};
  if(typeof scripts.preview==="string"){
    const invocation=packageScriptInvocation(args.manager,"preview",["--host","0.0.0.0","--port",String(BROWSER_PORT)]);
    return{...invocation,cwd:args.cwd,env:{PORT:String(BROWSER_PORT),HOST:"0.0.0.0"},label:"preview-script"};
  }
  if(typeof scripts.dev==="string"){
    const invocation=packageScriptInvocation(args.manager,"dev",["--host","0.0.0.0","--port",String(BROWSER_PORT)]);
    return{...invocation,cwd:args.cwd,env:{PORT:String(BROWSER_PORT),HOST:"0.0.0.0"},label:"dev-script"};
  }
  if(typeof scripts.start==="string"){
    const invocation=packageScriptInvocation(args.manager,"start");
    return{...invocation,cwd:args.cwd,env:{PORT:String(BROWSER_PORT),HOST:"0.0.0.0"},label:"start-script"};
  }
  return undefined;
}

async function startCodebasePreview(sandbox:Sandbox,args:{manager:string;cwd:string;pkg:PackageJsonShape}){
  const plan=await previewPlanFor(sandbox,args);
  if(!plan)return{healthy:false as const,reason:"工程没有可识别的静态输出或 preview/dev/start 脚本"};
  await sandbox.runCommand({
    cmd:plan.command,
    args:plan.args,
    cwd:safeSandboxCwd(plan.cwd,sandbox.cwd),
    env:plan.env,
    detached:true,
    timeoutMs:30_000,
  });
  const healthy=await waitForPreview(sandbox,{port:BROWSER_PORT,healthPath:"/",timeoutMs:30_000});
  return healthy
    ? {healthy:true as const,label:plan.label,internalUrl:"http://127.0.0.1:"+BROWSER_PORT+"/",externalUrl:sandbox.domain(BROWSER_PORT)}
    : {healthy:false as const,reason:"Preview 未在 30 秒内健康启动",label:plan.label};
}

type BrowserCaseEvidence={
  testCaseId:string;
  verificationStatus:"verified"|"partial"|"unverified"|"failed";
  error?:string;
  assertions:number;
  blockedResources:string[];
  latencyMs:number;
  screenshots?:Array<{name:string;width:number;height:number;dataUrl:string;artifactHash:string}>;
  trace:Array<{id:string;stage:string;status:"pass"|"fail"|"warning"|"info";summary:string;detail?:string}>;
};

function validateSandboxBrowserCases(testCases:TestCase[]){
  for(const testCase of testCases){
    for(const step of testCase.browserSteps??[]){
      if(step.selector.length>500)throw new Error("Browser selector 超过 500 字符");
      if((step.action==="fill"||step.action==="text")&&typeof step.value!=="string")throw new Error("Browser Step 缺少 value");
      if(step.action==="count"&&(!Number.isInteger(step.count)||Number(step.count)<0))throw new Error("Browser count 缺少合法数量");
    }
  }
}

async function executeSandboxBrowserCases(sandbox:Sandbox,testCases:TestCase[],internalUrl:string){
  validateSandboxBrowserCases(testCases);
  const file=".evolution/runtime/browser-cases.json";
  await sandbox.writeFiles([{path:file,content:JSON.stringify(testCases.map((testCase)=>({
    id:testCase.id,
    browserSteps:testCase.browserSteps??[],
    captureScreenshots:testCase.executionMode==="visual-review",
  })))}]);
  const result=await sandbox.runCommand("node",[
    ".evolution/runtime/browser-runner.mjs",
    sandbox.cwd+"/"+file,
    internalUrl,
  ],{timeoutMs:Math.min(180_000,Math.max(30_000,testCases.length*25_000))});
  if(result.exitCode!==0)throw new Error("Browser Steps Runtime 失败："+clipped(await result.stderr()));
  const lines=(await result.stdout()).trim().split(/\r?\n/).filter(Boolean);
  const parsed=JSON.parse(lines.at(-1)??"{}") as {results?:BrowserCaseEvidence[]};
  if(!Array.isArray(parsed.results))throw new Error("Browser Steps Runtime 未返回结果");
  return parsed.results;
}

export async function runVercelSandboxValidation(
  input:SandboxValidationRequest,
):Promise<SandboxValidationResult>{
  const request=SandboxValidationRequestSchema.parse(input);
  const startedAt=new Date().toISOString();
  const steps:SandboxStepResult[]=[];
  let sandbox:(Sandbox&AsyncDisposable)|undefined;
  let previewUrlObserved:string|undefined;
  let previewHealthy:boolean|undefined;

  try{
    sandbox=await Sandbox.create({
      name:request.id?("evo-"+request.id.replace(/[^a-zA-Z0-9-_]/g,"-").slice(0,48)):undefined,
      image:UNIVERSAL_RUNTIME_IMAGE,
      timeout:request.timeoutMs,
      resources:{vcpus:request.vcpus},
      ports:request.preview?[request.preview.port]:undefined,
      networkPolicy:"deny-all",
      region:request.region as SandboxRegion|undefined,
      tags:{product:"evolution-os",purpose:"validation"},
      persistent:false,
    });

    await sandbox.writeFiles(request.files.map((file)=>({
      path:safeSandboxRelativePath(file.path),
      content:file.content,
    })));

    const regular=request.commands.filter((command)=>command.phase!=="e2e");
    for(const command of regular){
      await sandbox.updateNetworkPolicy(command.phase==="install"
        ? sandboxNetworkPolicy(request.installNetworkDomains)
        : sandboxNetworkPolicy(request.runtimeNetworkDomains));
      const step=await runStep(sandbox,command);
      steps.push(step);
      if(step.exitCode!==0){
        return SandboxValidationResultSchema.parse({
          status:"failed",sandboxName:sandbox.name,region:sandbox.region,steps,startedAt,
          finishedAt:new Date().toISOString(),
          error:command.phase+" command failed: "+command.id,
        });
      }
    }

    if(request.preview){
      await sandbox.updateNetworkPolicy(sandboxNetworkPolicy(request.runtimeNetworkDomains));
      await sandbox.runCommand({
        cmd:request.preview.command,
        args:request.preview.args,
        cwd:safeSandboxCwd(request.preview.cwd,sandbox.cwd),
        env:request.preview.env,
        detached:true,
        timeoutMs:Math.max(request.preview.startupTimeoutMs,30_000),
      });
      previewHealthy=await waitForPreview(sandbox,{
        port:request.preview.port,
        healthPath:request.preview.healthPath,
        timeoutMs:request.preview.startupTimeoutMs,
      });
      if(!previewHealthy){
        return SandboxValidationResultSchema.parse({
          status:"failed",sandboxName:sandbox.name,region:sandbox.region,
          previewHealthy:false,steps,startedAt,finishedAt:new Date().toISOString(),
          error:"Preview did not become healthy",
        });
      }
      previewUrlObserved=sandbox.domain(request.preview.port);
    }

    for(const command of request.commands.filter((item)=>item.phase==="e2e")){
      await sandbox.updateNetworkPolicy(sandboxNetworkPolicy(request.runtimeNetworkDomains));
      const env=request.preview
        ? {...command.env,EVOLUTION_PREVIEW_URL:"http://127.0.0.1:"+request.preview.port}
        : command.env;
      const step=await runStep(sandbox,{...command,env});
      steps.push(step);
      if(step.exitCode!==0){
        return SandboxValidationResultSchema.parse({
          status:"failed",sandboxName:sandbox.name,region:sandbox.region,
          previewUrlObserved,previewHealthy,steps,startedAt,finishedAt:new Date().toISOString(),
          error:"E2E command failed: "+command.id,
        });
      }
    }

    return SandboxValidationResultSchema.parse({
      status:"verified",
      sandboxName:sandbox.name,
      region:sandbox.region,
      previewUrlObserved,
      previewHealthy,
      steps,
      startedAt,
      finishedAt:new Date().toISOString(),
    });
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return SandboxValidationResultSchema.parse({
      status:isUnavailableError(error)?"unavailable":"failed",
      steps,startedAt,finishedAt:new Date().toISOString(),error:message,
    });
  }finally{
    if(sandbox){
      try{await sandbox.stop();}catch{/* cleanup is best effort */}
    }
  }
}


type PackageJsonShape={
  scripts?:Record<string,string>;
  packageManager?:string;
};

function archivePathDepth(value:string){
  return value.split("/").filter(Boolean).length;
}

function parentPath(value:string){
  const parts=value.split("/");
  parts.pop();
  return parts.join("/");
}

function textFromBytes(bytes:Uint8Array){
  return new TextDecoder().decode(bytes);
}

async function sha256Bytes(bytes:Uint8Array){
  const input=new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest=await crypto.subtle.digest("SHA-256",input.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((value)=>value.toString(16).padStart(2,"0")).join("");
}

function packageManagerFor(files:Set<string>,root:string,pkg:PackageJsonShape){
  const at=(name:string)=>root?root+"/"+name:name;
  const declared=pkg.packageManager?.split("@")[0]?.toLowerCase();
  if(declared==="pnpm"||files.has(at("pnpm-lock.yaml")))return "pnpm";
  if(declared==="yarn"||files.has(at("yarn.lock")))return "yarn";
  if(declared==="bun"||files.has(at("bun.lockb"))||files.has(at("bun.lock")))return "bun";
  return "npm";
}

function scriptCommand(manager:string,name:string,cwd:string):SandboxCommand{
  if(manager==="pnpm")return{id:"script-"+name,phase:name.includes("e2e")?"e2e":name==="build"?"build":"test",command:"corepack",args:["pnpm","run",name],cwd,env:{CI:"1"},timeoutMs:name.includes("e2e")?300_000:180_000};
  if(manager==="yarn")return{id:"script-"+name,phase:name.includes("e2e")?"e2e":name==="build"?"build":"test",command:"corepack",args:["yarn","run",name],cwd,env:{CI:"1"},timeoutMs:name.includes("e2e")?300_000:180_000};
  if(manager==="bun")return{id:"script-"+name,phase:name.includes("e2e")?"e2e":name==="build"?"build":"test",command:"bun",args:["run",name],cwd,env:{CI:"1"},timeoutMs:name.includes("e2e")?300_000:180_000};
  return{id:"script-"+name,phase:name.includes("e2e")?"e2e":name==="build"?"build":"test",command:"npm",args:["run",name],cwd,env:{CI:"1"},timeoutMs:name.includes("e2e")?300_000:180_000};
}

function installCommand(manager:string,cwd:string,files:Set<string>,root:string,pkg:PackageJsonShape):SandboxCommand{
  const at=(name:string)=>root?root+"/"+name:name;
  if(manager==="pnpm")return{id:"install",phase:"install",command:"corepack",args:["pnpm","install","--frozen-lockfile"],cwd,env:{CI:"1"},timeoutMs:300_000};
  if(manager==="yarn"){
    const major=Number(pkg.packageManager?.match(/^yarn@(\d+)/)?.[1]??"1");
    return{id:"install",phase:"install",command:"corepack",args:["yarn","install",major>=2?"--immutable":"--frozen-lockfile"],cwd,env:{CI:"1"},timeoutMs:300_000};
  }
  if(manager==="bun")return{id:"install",phase:"install",command:"bun",args:["install","--frozen-lockfile"],cwd,env:{CI:"1"},timeoutMs:300_000};
  return{id:"install",phase:"install",command:"npm",args:[files.has(at("package-lock.json"))?"ci":"install"],cwd,env:{CI:"1"},timeoutMs:300_000};
}

function testIntent(testCase:TestCase){
  const text=[testCase.title,testCase.input,...testCase.expected,...testCase.tags].join(" ");
  return{
    build:/\b(build|compile|bundle|type.?check)\b|构建|编译|类型检查/i.test(text),
    test:/\b(test|spec|unit|integration|e2e)\b|测试|用例|集成/i.test(text),
    e2e:/\be2e\b|end.?to.?end|端到端|浏览器/i.test(text),
    browser:Boolean(testCase.browserSteps?.length),
  };
}

function resultFromSandbox(args:{
  testCase:TestCase;
  artifactHash:string;
  steps:SandboxStepResult[];
  packageRoot:string;
  manager:string;
  buildRan:boolean;
  testRan:boolean;
  e2eRan:boolean;
  error?:string;
}):TargetRunResult{
  const intent=testIntent(args.testCase);
  const failed=args.steps.find((step)=>step.exitCode!==0
    && (step.phase!=="e2e"||args.testCase.evidenceScope==="product-behavior"||intent.e2e));
  const log=args.steps.map((step)=>[
    "["+step.phase+"] "+step.command+" -> exit "+step.exitCode,
    step.stdout.trim()?step.stdout.trim():"",
    step.stderr.trim()?step.stderr.trim():"",
  ].filter(Boolean).join("\n")).join("\n\n");
  if(failed||args.error){
    const reason=args.error??(failed?.phase+" command failed");
    return{
      testCaseId:args.testCase.id,
      output:"SANDBOX EXECUTION FAILED\n"+reason+(log?"\n\n"+log:""),
      latencyMs:args.steps.reduce((sum,item)=>sum+(item.durationMs??0),0),
      cost:0,
      artifactHash:args.artifactHash,
      verificationStatus:"failed",
      error:reason,
      trace:args.steps.map((step)=>({id:"sandbox-"+step.id,stage:"sandbox-"+step.phase,summary:step.command,status:step.exitCode===0?"pass":"fail",detail:"Vercel Sandbox · "+args.manager+" · "+args.packageRoot})),
    };
  }

  let verificationStatus:TargetRunResult["verificationStatus"]="partial";
  let proof="已在隔离 Sandbox 完成真实依赖安装";
  if(args.testCase.evidenceScope==="implementation"){
    const requestedSatisfied=(!intent.build||args.buildRan)&&(!intent.test||args.testRan||args.e2eRan);
    const anyExecution=args.buildRan||args.testRan||args.e2eRan;
    verificationStatus=requestedSatisfied&&anyExecution?"verified":"partial";
    proof=verificationStatus==="verified"
      ?"实现级 Build/Test 证据已真实执行并通过"
      :"工程可安装，但当前脚本不足以完全证明该实现级验收项";
  }else if(intent.browser){
    verificationStatus="unverified";
    proof="工程 Build/Test 已真实执行，但本题包含指定 Browser Steps；当前 Sandbox 还没有执行这些逐步浏览器动作";
  }else if(args.e2eRan){
    verificationStatus="partial";
    proof="工程自带 E2E 脚本已通过，但未证明该项目专属 TestCase 与脚本逐项绑定";
  }

  return{
    testCaseId:args.testCase.id,
    output:[
      "VERCEL SANDBOX EVIDENCE",
      "Artifact SHA-256: "+args.artifactHash,
      "Package root: "+args.packageRoot,
      "Package manager: "+args.manager,
      proof,
      log,
    ].filter(Boolean).join("\n\n"),
    latencyMs:args.steps.reduce((sum,item)=>sum+(item.durationMs??0),0),
    cost:0,
    artifactHash:args.artifactHash,
    verificationStatus,
    trace:[
      {id:"sandbox-artifact",stage:"sandbox-artifact",summary:"冻结 ZIP 已按 SHA-256 绑定进入 Vercel Sandbox",status:"pass",detail:args.artifactHash},
      ...args.steps.map((step)=>({id:"sandbox-"+step.id,stage:"sandbox-"+step.phase,summary:step.command,status:step.exitCode===0?"pass" as const:"fail" as const,detail:"Vercel Sandbox · "+args.manager+" · "+args.packageRoot})),
    ],
  };
}

function resultFromBrowserEvidence(args:{
  testCase:TestCase;
  browser:BrowserCaseEvidence;
  artifactHash:string;
  steps:SandboxStepResult[];
  packageRoot:string;
  manager:string;
  previewUrlObserved?:string;
}):TargetRunResult{
  const e2eFailure=args.steps.find((step)=>step.phase==="e2e"&&step.exitCode!==0);
  const verificationStatus:TargetRunResult["verificationStatus"]=
    args.browser.verificationStatus==="verified"&&e2eFailure
      ?"partial"
      : args.browser.verificationStatus;
  const log=args.steps.map((step)=>[
    "["+step.phase+"] "+step.command+" -> exit "+step.exitCode,
    step.stdout.trim()?step.stdout.trim():"",
    step.stderr.trim()?step.stderr.trim():"",
  ].filter(Boolean).join("\n")).join("\n\n");
  const browserSummary=[
    "Browser assertions: "+args.browser.assertions,
    args.browser.blockedResources.length
      ?"Blocked external resources: "+args.browser.blockedResources.join("；")
      :"Blocked external resources: none",
    e2eFailure?"Project E2E also reported a failure; exact Browser Steps are retained as separate evidence.":"",
  ].filter(Boolean).join("\n");
  return{
    testCaseId:args.testCase.id,
    output:[
      "VERCEL SANDBOX BROWSER EVIDENCE",
      "Artifact SHA-256: "+args.artifactHash,
      "Package root: "+args.packageRoot,
      "Package manager: "+args.manager,
      args.previewUrlObserved?"Observed Preview URL: "+args.previewUrlObserved:"",
      browserSummary,
      log,
    ].filter(Boolean).join("\n\n"),
    latencyMs:args.browser.latencyMs+args.steps.reduce((sum,item)=>sum+(item.durationMs??0),0),
    cost:0,
    artifactHash:args.artifactHash,
    ...(args.browser.screenshots?.length?{screenshots:args.browser.screenshots}:{}),
    verificationStatus,
    ...(args.browser.error?{error:args.browser.error}:{}),
    trace:[
      {id:"sandbox-artifact",stage:"sandbox-artifact",summary:"冻结 ZIP 已按 SHA-256 绑定进入 Vercel Sandbox",status:"pass",detail:args.artifactHash},
      ...(args.previewUrlObserved?[{id:"sandbox-preview",stage:"preview",summary:"真实 Preview 已启动",status:"pass" as const,detail:args.previewUrlObserved}]:[]),
      ...args.steps.map((step)=>({id:"sandbox-"+step.id,stage:"sandbox-"+step.phase,summary:step.command,status:step.exitCode===0?"pass" as const:"fail" as const,detail:"Vercel Sandbox · "+args.manager+" · "+args.packageRoot})),
      ...args.browser.trace,
    ],
  };
}

export async function runVercelSandboxCodebaseValidation(args:{
  id?:string;
  archive:Uint8Array;
  expectedSha256?:string;
  testCases:TestCase[];
}):Promise<SandboxTargetBatchResponse>{
  const started=Date.now();
  const artifactHash=await sha256Bytes(args.archive);
  if(args.expectedSha256&&artifactHash.toLowerCase()!==args.expectedSha256.toLowerCase()){
    return SandboxTargetBatchResponseSchema.parse({
      artifactHash,
      scriptsRun:[],
      results:args.testCases.map((testCase)=>({
        testCaseId:testCase.id,
        output:"SANDBOX BLOCKED：冻结 Artifact SHA-256 与请求绑定值不一致。",
        latencyMs:Date.now()-started,cost:0,artifactHash,verificationStatus:"failed",
        error:"artifact hash mismatch",trace:[],
      })),
    });
  }

  const zip=await JSZip.loadAsync(args.archive,{checkCRC32:true});
  const entries=Object.values(zip.files).filter((entry)=>!entry.dir&&!/(^|\/)(?:node_modules|\.git)(?:\/|$)/.test(entry.name));
  if(!entries.length)throw new Error("ZIP 中没有可执行文件");
  if(entries.length>SANDBOX_MAX_ARCHIVE_FILES)throw new Error("ZIP 文件数超过 Sandbox 上限 "+SANDBOX_MAX_ARCHIVE_FILES);
  const extracted:Array<{path:string;content:Uint8Array}>=[];
  let total=0;
  for(const entry of entries){
    const path=safeSandboxRelativePath(entry.name);
    if(path===".evolution"||path.startsWith(".evolution/"))throw new Error("ZIP 使用了系统保留目录 .evolution/，已阻止执行");
    const content=await entry.async("uint8array");
    total+=content.byteLength;
    if(content.byteLength>SANDBOX_MAX_FILE_BYTES)throw new Error("单文件超过 Sandbox 20MB 上限："+path);
    if(total>SANDBOX_MAX_EXTRACTED_BYTES)throw new Error("ZIP 解包后超过 Sandbox 100MB 上限");
    extracted.push({path,content});
  }

  const paths=new Set(extracted.map((item)=>item.path));
  const packageFiles=extracted.filter((item)=>/(^|\/)package\.json$/.test(item.path))
    .sort((a,b)=>archivePathDepth(a.path)-archivePathDepth(b.path));
  const packageEntry=packageFiles[0];
  if(!packageEntry){
    const results=args.testCases.map((testCase)=>({
      testCaseId:testCase.id,
      output:"UNVERIFIED：当前 Hybrid Sandbox Runner 已接通，但该 ZIP 未发现 package.json；本轮暂只支持 Node/JS 工程自动 Build/Test。",
      latencyMs:Date.now()-started,cost:0,artifactHash,verificationStatus:"unverified" as const,trace:[],
    }));
    return SandboxTargetBatchResponseSchema.parse({results,scriptsRun:[],artifactHash});
  }

  let pkg:PackageJsonShape;
  try{pkg=JSON.parse(textFromBytes(packageEntry.content)) as PackageJsonShape;}
  catch{throw new Error("package.json 无法解析");}
  const root=parentPath(packageEntry.path);
  const cwd=root?ROOT+"/"+root:ROOT;
  const manager=packageManagerFor(paths,root,pkg);
  const scripts=pkg.scripts??{};
  const scriptsToRun:string[]=[];
  if(typeof scripts.build==="string")scriptsToRun.push("build");
  if(typeof scripts.test==="string"&&!/no test specified/i.test(scripts.test))scriptsToRun.push("test");
  const needsBehavior=args.testCases.some((testCase)=>testCase.evidenceScope==="product-behavior"||testCase.executionMode==="visual-review"||Boolean(testCase.browserSteps?.length));
  const browserCases=args.testCases.filter((testCase)=>testCase.executionMode==="visual-review"||Boolean(testCase.browserSteps?.length));
  const e2eName=needsBehavior
    ? (typeof scripts["test:e2e"]==="string"?"test:e2e":typeof scripts.e2e==="string"?"e2e":typeof scripts.integration==="string"?"integration":undefined)
    : undefined;
  const needsBrowserRuntime=browserCases.length>0||Boolean(e2eName);

  let browserSnapshotId:string|undefined;
  let browserRuntimeError:string|undefined;
  if(needsBrowserRuntime){
    try{browserSnapshotId=await ensureBrowserRuntimeSnapshot();}
    catch(error){browserRuntimeError=error instanceof Error?error.message:String(error);}
  }

  let sandbox:(Sandbox&AsyncDisposable)|undefined;
  const steps:SandboxStepResult[]=[];
  let preview:Awaited<ReturnType<typeof startCodebasePreview>>|undefined;
  let browserEvidence:BrowserCaseEvidence[]=[];
  let e2eAttempted=false;
  try{
    const baseName=args.id?args.id.replace(/[^a-zA-Z0-9-_]/g,"-").slice(0,34):"target";
    const name="evo-"+baseName+"-"+crypto.randomUUID().slice(0,8);
    sandbox=browserSnapshotId
      ? await Sandbox.create({
        name,
        source:{type:"snapshot",snapshotId:browserSnapshotId},
        timeout:10*60_000,
        resources:{vcpus:SANDBOX_DEFAULT_VCPUS},
        ports:[BROWSER_PORT],
        networkPolicy:"deny-all",
        tags:{product:"evolution-os",purpose:"hybrid-browser-target"},
        persistent:false,
      })
      : await Sandbox.create({
        name,
        image:UNIVERSAL_RUNTIME_IMAGE,
        timeout:10*60_000,
        resources:{vcpus:SANDBOX_DEFAULT_VCPUS},
        ports:needsBehavior?[BROWSER_PORT]:undefined,
        networkPolicy:"deny-all",
        tags:{product:"evolution-os",purpose:"hybrid-target"},
        persistent:false,
      });
    await sandbox.writeFiles(extracted.map((file)=>({path:file.path,content:file.content})));

    await sandbox.updateNetworkPolicy(sandboxNetworkPolicy([
      "registry.npmjs.org","*.npmjs.org","registry.yarnpkg.com",
      "github.com","codeload.github.com","*.githubusercontent.com",
    ]));
    const install=await runStep(sandbox,installCommand(manager,cwd,paths,root,pkg));
    steps.push(install);
    if(install.exitCode===0){
      await sandbox.updateNetworkPolicy("deny-all");
      for(const script of scriptsToRun){
        const step=await runStep(sandbox,scriptCommand(manager,script,cwd));
        steps.push(step);
        if(step.exitCode!==0)break;
      }
    }

    const baseFailure=steps.find((step)=>step.exitCode!==0);
    if(!baseFailure&&needsBehavior&&browserSnapshotId){
      try{preview=await startCodebasePreview(sandbox,{manager,cwd,pkg});}
      catch(error){preview={healthy:false as const,reason:error instanceof Error?error.message:String(error),label:"preview-runtime"};}

      if(e2eName){
        e2eAttempted=true;
        const command=scriptCommand(manager,e2eName,cwd);
        const step=await runStep(sandbox,{
          ...command,
          phase:"e2e",
          env:{
            ...command.env,
            ...(preview?.healthy?{EVOLUTION_PREVIEW_URL:preview.internalUrl}:{}),
          },
        });
        steps.push(step);
      }

      if(browserCases.length){
        if(preview?.healthy){
          try{browserEvidence=await executeSandboxBrowserCases(sandbox,browserCases,preview.internalUrl);}
          catch(error){
            const message=error instanceof Error?error.message:String(error);
            browserEvidence=browserCases.map((testCase)=>({
              testCaseId:testCase.id,verificationStatus:"unverified",error:message,assertions:0,
              blockedResources:[],latencyMs:0,
              trace:[{id:"browser-runtime",stage:"browser-runtime",status:"warning",summary:"Browser Runtime 未完成",detail:message}],
            }));
          }
        }else{
          const mappedPreview=Boolean(preview&&"label" in preview&&preview.label);
          const message=preview?.reason??"没有可用 Preview";
          browserEvidence=browserCases.map((testCase)=>({
            testCaseId:testCase.id,
            verificationStatus:mappedPreview?"failed":"unverified",
            error:mappedPreview?message:undefined,
            assertions:0,blockedResources:[],latencyMs:0,
            trace:[{id:"sandbox-preview",stage:"preview",status:mappedPreview?"fail":"warning",summary:message}],
          }));
        }
      }
    }else if(browserCases.length){
      const message=baseFailure
        ? "Build/Test 未通过，未进入浏览器验证"
        : browserRuntimeError??"Browser Runtime 尚未可用";
      browserEvidence=browserCases.map((testCase)=>({
        testCaseId:testCase.id,
        verificationStatus:baseFailure?"failed":"unverified",
        error:baseFailure?message:undefined,
        assertions:0,blockedResources:[],latencyMs:0,
        trace:[{id:"browser-runtime",stage:"browser-runtime",status:baseFailure?"fail":"warning",summary:message}],
      }));
    }

    const buildRan=steps.some((step)=>step.id==="script-build"&&step.exitCode===0);
    const testRan=steps.some((step)=>step.id==="script-test"&&step.exitCode===0);
    const e2eRan=steps.some((step)=>step.phase==="e2e"&&step.exitCode===0);
    const baseError=steps.find((step)=>step.phase!=="e2e"&&step.exitCode!==0)?.phase;
    const browserById=new Map(browserEvidence.map((item)=>[item.testCaseId,item]));
    const results=args.testCases.map((testCase)=>{
      const browser=browserById.get(testCase.id);
      if(browser)return resultFromBrowserEvidence({
        testCase,browser,artifactHash,steps,packageRoot:root||".",manager,
        previewUrlObserved:preview?.healthy?preview.externalUrl:undefined,
      });
      return resultFromSandbox({
        testCase,artifactHash,steps,packageRoot:root||".",manager,buildRan,testRan,e2eRan,
        error:baseError?baseError+" failed":undefined,
      });
    });
    const scriptsRun=[...scriptsToRun,...(e2eAttempted&&e2eName?[e2eName]:[])];
    const browserStepsExecuted=browserEvidence.reduce((sum,item)=>sum+item.trace.filter((trace)=>trace.stage==="browser-step").length,0);
    return SandboxTargetBatchResponseSchema.parse({
      results,packageRoot:root||".",packageManager:manager,scriptsRun,
      artifactHash,sandboxRegion:sandbox.region,
      previewUrlObserved:preview?.healthy?preview.externalUrl:undefined,
      previewHealthy:needsBehavior?Boolean(preview?.healthy):undefined,
      browserStepsExecuted,
      browserRuntime:needsBrowserRuntime?(browserSnapshotId?"snapshot":"unavailable"):"not-needed",
    });
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const results=args.testCases.map((testCase)=>({
      testCaseId:testCase.id,
      output:"SANDBOX EXECUTION ERROR\n"+message,
      latencyMs:Date.now()-started,cost:0,artifactHash,
      verificationStatus:isUnavailableError(error)?"unverified" as const:"failed" as const,
      error:message,
      trace:steps.map((step)=>({id:"sandbox-"+step.id,stage:"sandbox-"+step.phase,summary:step.command,status:step.exitCode===0?"pass" as const:"fail" as const})),
    }));
    return SandboxTargetBatchResponseSchema.parse({
      results,scriptsRun:[...scriptsToRun,...(e2eAttempted&&e2eName?[e2eName]:[])],artifactHash,
      previewUrlObserved:preview?.healthy?preview.externalUrl:undefined,
      previewHealthy:needsBehavior?Boolean(preview?.healthy):undefined,
      browserStepsExecuted:browserEvidence.reduce((sum,item)=>sum+item.trace.filter((trace)=>trace.stage==="browser-step").length,0),
      browserRuntime:needsBrowserRuntime?(browserSnapshotId?"snapshot":"unavailable"):"not-needed",
    });
  }finally{
    if(sandbox){try{await sandbox.stop();}catch{/* cleanup is best effort */}}
  }
}

export async function checkVercelSandboxHealth():Promise<SandboxHealth>{
  const started=Date.now();
  let sandbox:(Sandbox&AsyncDisposable)|undefined;
  try{
    sandbox=await Sandbox.create({
      image:UNIVERSAL_RUNTIME_IMAGE,
      timeout:30_000,
      resources:{vcpus:SANDBOX_MIN_VCPUS},
      networkPolicy:"deny-all",
      tags:{product:"evolution-os",purpose:"health-check"},
      persistent:false,
    });
    const [node,npm]=await Promise.all([
      sandbox.runCommand("node",["--version"],{timeoutMs:10_000}),
      sandbox.runCommand("npm",["--version"],{timeoutMs:10_000}),
    ]);
    if(node.exitCode!==0||npm.exitCode!==0)throw new Error("Sandbox runtime commands failed");
    return SandboxHealthSchema.parse({
      ready:true,
      message:"Vercel Sandbox 已就绪",
      latencyMs:Date.now()-started,
      nodeVersion:(await node.stdout()).trim(),
      npmVersion:(await npm.stdout()).trim(),
      region:sandbox.region,
      policy:getVercelSandboxPolicyCapabilities(),
    });
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return SandboxHealthSchema.parse({
      ready:false,
      message:isUnavailableError(error)
        ?"Vercel Sandbox 尚未授权。本地请先执行 vercel link + vercel env pull；Vercel 部署环境使用 OIDC。"
        :"Vercel Sandbox 检测失败："+message,
      latencyMs:Date.now()-started,
      policy:getVercelSandboxPolicyCapabilities(),
    });
  }finally{
    if(sandbox){
      try{await sandbox.stop();}catch{/* cleanup is best effort */}
    }
  }
}

export async function checkVercelSandboxBrowserHealth():Promise<SandboxBrowserHealth>{
  const started=Date.now();
  let sandbox:(Sandbox&AsyncDisposable)|undefined;
  try{
    const snapshotId=await ensureBrowserRuntimeSnapshot();
    sandbox=await Sandbox.create({
      source:{type:"snapshot",snapshotId},
      timeout:90_000,
      resources:{vcpus:SANDBOX_MIN_VCPUS},
      ports:[BROWSER_PORT],
      networkPolicy:"deny-all",
      tags:{product:"evolution-os",purpose:"browser-health-check"},
      persistent:false,
    });

    await sandbox.writeFiles([{
      path:"health/index.html",
      content:"<!doctype html><html><meta charset='utf-8'><body><button id='save' onclick=\"document.querySelector('#status').textContent='已保存'\">保存</button><p id='status'>等待</p></body></html>",
    }]);
    await sandbox.runCommand({
      cmd:"node",
      args:[sandbox.cwd+"/.evolution/runtime/static-server.mjs","health",String(BROWSER_PORT)],
      cwd:sandbox.cwd,
      detached:true,
      timeoutMs:30_000,
    });
    const previewHealthy=await waitForPreview(sandbox,{port:BROWSER_PORT,healthPath:"/",timeoutMs:20_000});
    if(!previewHealthy)throw new Error("Browser Preview 健康检查失败");

    const testCase:TestCase={
      id:"browser-health",
      title:"Browser Runtime interaction health",
      input:"Click save and verify status text",
      expected:["已保存"],
      tags:["browser-health"],
      hidden:false,
      criterionIds:[],
      executionMode:"external-runner",
      evidenceScope:"product-behavior",
      browserSteps:[
        {action:"click",selector:"#save"},
        {action:"text",selector:"#status",value:"已保存"},
      ],
    };
    const evidence=await executeSandboxBrowserCases(
      sandbox,
      [testCase],
      "http://127.0.0.1:"+BROWSER_PORT+"/",
    );
    const browser=evidence[0];
    if(!browser||browser.verificationStatus!=="verified"){
      throw new Error("Browser Steps 自检失败："+(browser?.error??browser?.verificationStatus??"missing result"));
    }

    return SandboxBrowserHealthSchema.parse({
      ready:true,
      message:"Vercel Browser Runtime + Preview + Browser Steps 已就绪",
      latencyMs:Date.now()-started,
      playwrightVersion:"1.63.0",
      browser:"chromium",
      snapshotCached:true,
      previewHealthy:true,
      browserStepsVerified:true,
      browserStepsExecuted:browser.trace.filter((trace)=>trace.stage==="browser-step").length,
      region:sandbox.region,
    });
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    return SandboxBrowserHealthSchema.parse({
      ready:false,
      message:isUnavailableError(error)
        ?"Vercel Browser Runtime 尚未授权"
        :"Vercel Browser Runtime 检测失败："+message,
      latencyMs:Date.now()-started,
      playwrightVersion:"1.63.0",
      browser:"chromium",
      snapshotCached:false,
      previewHealthy:false,
      browserStepsVerified:false,
      browserStepsExecuted:0,
    });
  }finally{
    if(sandbox){try{await sandbox.stop();}catch{/* cleanup is best effort */}}
  }
}
