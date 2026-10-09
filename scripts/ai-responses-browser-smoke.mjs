import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {build} from 'vite';
import {getBrowser,closeBrowser} from '../runner-gateway/browser-runner.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const temporaryRoot=path.resolve(tmpdir());
const scratch=await mkdtemp(path.join(temporaryRoot,'evolution-ai-responses-'));
if(path.dirname(scratch)!==temporaryRoot||!path.basename(scratch).startsWith('evolution-ai-responses-'))throw new Error('Unexpected fixture directory');
const fixtureKey='synthetic-only-fixture-key';
const model='main-flow-fixture';
const requests=[];
const appWrites=[];
const pageErrors=[];
const fixtureErrors=[];
let app;
let provider;
let context;

const listen=server=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const close=server=>server?.listening?new Promise(resolve=>server.close(resolve)):Promise.resolve();
try{
  const source=filename=>JSON.stringify(path.resolve(root,filename).replaceAll('\\','/'));
  const entry=path.join(scratch,'entry.mjs');
  await writeFile(entry,[
    `export {createProviderConnection,saveProviderConnections,saveAiRoutingPolicy,resolveOperationConnection} from ${source('src/features/evolve/ai/providers/registry.ts')};`,
    `export {testByokConnection} from ${source('src/features/evolve/ai/providers/byok.ts')};`,
    `export {runEvolveAi} from ${source('src/features/evolve/ai/service.ts')};`,
  ].join('\n'));
  const config=ts.readConfigFile(path.join(root,'tsconfig.app.json'),ts.sys.readFile);
  if(config.error)throw new Error('Cannot read fixture source aliases');
  const alias=Object.entries(config.config.compilerOptions.paths).map(([find,targets])=>({
    find:find.replace(/\/\*$/,''),replacement:path.resolve(root,targets[0].replace(/\/\*$/,'')),
  }));
  await build({
    root,configFile:false,logLevel:'warn',resolve:{alias},
    define:{'import.meta.env':JSON.stringify({MODE:'test',PROD:false,DEV:false})},
    build:{lib:{entry,formats:['es'],fileName:()=> 'fixture.js'},outDir:path.join(scratch,'bundle'),emptyOutDir:true,minify:false},
  });
  const bundle=await readFile(path.join(scratch,'bundle','fixture.js'));
  app=createServer((req,res)=>{
    if(req.url==='/fixture.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle);return;}
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><h1>Synthetic model routing fixture</h1></body></html>');
  });
  await listen(app);
  const appOrigin='http://127.0.0.1:'+app.address().port;
  provider=createServer(async(req,res)=>{
    res.setHeader('Access-Control-Allow-Origin',appOrigin);
    res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');
    res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
    res.setHeader('Content-Type','application/json');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    try{
      const chunks=[];
      for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(req.url,'/v1/responses');
      assert.equal(body.model,model);
      assert.equal(req.headers.authorization,'Bearer '+fixtureKey);
      const format=body.text?.format?.type??'none';
      requests.push({path:req.url,format,model:body.model,store:body.store});
      if(format==='json_schema'){
        res.writeHead(400);res.end(JSON.stringify({error:{message:'json_schema unsupported',param:'text.format'}}));return;
      }
      if(format==='none'){res.end(JSON.stringify({output_text:'ok'}));return;}
      assert.equal(format,'json_object');
      assert.equal(body.store,false);
      assert.match(body.input[0].content[0].text,/JSON Schema/);
      assert.match(body.input[1].content[0].text,/Synthetic task/);
      res.end(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:'{"answer":'}]},{content:[{type:'output_text',text:'"native browser path passed"}'}]}]}));
    }catch(error){
      fixtureErrors.push(error instanceof Error?error.message:String(error));
      res.writeHead(500);res.end(JSON.stringify({error:{message:'Synthetic fixture assertion failed'}}));
    }
  });
  await listen(provider);
  const providerBase='http://127.0.0.1:'+provider.address().port+'/v1';
  const browser=await getBrowser();
  context=await browser.newContext();
  await context.route('**/*',async route=>{
    const request=route.request();
    if(['GET','HEAD','OPTIONS'].includes(request.method())||request.url().startsWith(providerBase+'/responses'))return route.continue();
    appWrites.push({method:request.method(),path:new URL(request.url()).pathname});
    return route.abort('blockedbyclient');
  });
  const page=await context.newPage();
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(appOrigin,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async({providerBase,fixtureKey,model})=>{
    const api=await import('/fixture.js');
    const connection={...api.createProviderConnection('custom'),label:'Synthetic Responses fixture',apiKey:fixtureKey,baseUrl:providerBase+'/responses',defaultModel:model,models:[model]};
    api.saveProviderConnections([connection]);
    api.saveAiRoutingPolicy({mode:'single',operationRoutes:{},defaultRoute:{connectionId:connection.id,model,fallbackConnectionIds:[]},requireIndependentEvaluator:false,fallbackToDemo:false});
    const route=api.resolveOperationConnection('copilot');
    if(!route)throw new Error('Synthetic route unresolved');
    const health=await api.testByokConnection(route.resolved);
    const task=await api.runEvolveAi('copilot',{command:'Synthetic task; no original files',artifacts:[]},undefined,undefined,{forceRefresh:true,requireLive:true});
    return {health:health.text,task,routeModel:route.model};
  },{providerBase,fixtureKey,model});
  assert.equal(result.health,'ok');
  assert.deepEqual(result.task,{answer:'native browser path passed',suggestedAction:'none',evidence:[]});
  assert.equal(result.routeModel,model);
  assert.deepEqual(requests.map(item=>item.format),['none','json_schema','json_object']);
  assert.deepEqual(appWrites,[]);
  assert.deepEqual(pageErrors,[]);
  assert.deepEqual(fixtureErrors,[]);
  const receipt={status:'PASS',transport:'Actual Chromium + CORS + native local HTTP fixture',source:'Actual registry/health/runEvolveAi modules bundled into an isolated fixture page',result,requests,appWrites,pageErrors,fixtureErrors,realProvider:false,originalFilesSent:false,realMissionAccepted:false};
  if(process.env.AI_RESPONSES_SMOKE_RECEIPT)await writeFile(process.env.AI_RESPONSES_SMOKE_RECEIPT,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
}finally{
  await context?.close();
  await closeBrowser();
  await close(provider);
  await close(app);
  if(path.dirname(scratch)!==temporaryRoot||!path.basename(scratch).startsWith('evolution-ai-responses-'))throw new Error('Refusing fixture cleanup outside temporary root');
  await rm(scratch,{recursive:true,force:true});
}