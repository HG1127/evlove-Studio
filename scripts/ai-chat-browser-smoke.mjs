import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
const scratch=await mkdtemp(path.join(temporaryRoot,'evolution-ai-chat-'));
if(path.dirname(scratch)!==temporaryRoot||!path.basename(scratch).startsWith('evolution-ai-chat-'))throw new Error('Unexpected fixture directory');
const fixtureKey='synthetic-only-fixture-key';
let nextProbeError=false;
const model=process.env.AI_CHAT_SMOKE_MODEL?.trim()||'main-flow-fixture';
const artifact='<html><body>Literal <think>{"literal":true}</think>\n```json\n{"literal":"must remain"}\n```\nEnd;</body></html>';
const artifactHash=createHash('sha256').update(artifact,'utf8').digest('hex');
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
    `export {testByokConnection,callByokStructured} from ${source('src/features/evolve/ai/providers/byok.ts')};`,
    `export {CopilotAiResultSchema,BuildCandidateAiResultSchema,jsonSchemas} from ${source('packages/contracts/src/index.ts')};`,
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
      assert.equal(req.url,'/v1/chat/completions');
      assert.equal(body.model,model);
      assert.equal(req.headers.authorization,'Bearer '+fixtureKey);
      const format=body.response_format?.type??'none';
      const prompt=body.messages[1].content;
      const scenario=/Scenario: ([a-z_]+)/.exec(prompt)?.[1]??'ok';
      requests.push({path:req.url,format,model:body.model,scenario});
      if(format==='json_schema'){
        res.writeHead(400);res.end(JSON.stringify({error:{message:'json_schema unsupported',param:'response_format'}}));return;
      }
      if(format==='none'){
        res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'ok'}}],...(nextProbeError?{error:{message:'Rejected '+fixtureKey}}:{})}));return;
      }
      assert.equal(format,'json_object');
      assert.match(body.messages[0].content,/JSON Schema/);
      if(scenario.startsWith('candidate_')){
        const candidate={artifacts:[{sourceArtifactId:'synthetic-source',name:'candidate.html',mimeType:'text/html',content:artifact}],summary:'Synthetic Candidate'};
        const json=JSON.stringify(candidate);
        const content=scenario==='candidate_wrapped'?'<think>Intermediate {"wrong":"reasoning"}.</think>\n```json\n'+json+'\n```':scenario==='candidate_incomplete'?json.slice(0,-8):json;
        res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}]}));return;
      }
      const content=JSON.stringify({answer:'native browser Chat passed',suggestedAction:'none',evidence:[]});
      const message={content:[{type:'text',text:content.slice(0,16)},{type:'output_text',text:content.slice(16)}],...(scenario==='refusal'?{refusal:'Synthetic refusal'}:{})};
      const finish_reason=['length','content_filter','tool_calls'].includes(scenario)?scenario:'stop';
      if(scenario==='body_error')nextProbeError=true;
      res.end(JSON.stringify({choices:[{finish_reason,message}],usage:{completion_tokens:24000},...(scenario==='body_error'?{error:{message:'Rejected '+fixtureKey}}:{})}));
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
    if(['GET','HEAD','OPTIONS'].includes(request.method())||request.url().startsWith(providerBase+'/chat/completions'))return route.continue();
    appWrites.push({method:request.method(),path:new URL(request.url()).pathname});
    return route.abort('blockedbyclient');
  });
  const page=await context.newPage();
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(appOrigin,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(async({providerBase,fixtureKey,model,artifact})=>{
    const api=await import('/fixture.js');
    const connection={...api.createProviderConnection('custom'),label:'Synthetic Chat fixture',apiKey:fixtureKey,baseUrl:providerBase+'/chat/completions',defaultModel:model,models:[model]};
    api.saveProviderConnections([connection]);
    api.saveAiRoutingPolicy({mode:'single',operationRoutes:{},defaultRoute:{connectionId:connection.id,model,fallbackConnectionIds:[]},requireIndependentEvaluator:false,fallbackToDemo:false});
    const route=api.resolveOperationConnection('copilot');
    if(!route)throw new Error('Synthetic route unresolved');
    const health=await api.testByokConnection(route.resolved);
    const task=await api.runEvolveAi('copilot',{command:'Synthetic task; no original files',artifacts:[]},undefined,undefined,{forceRefresh:true,requireLive:true});
    const candidateHashes=[];
    for(const scenario of ['candidate_plain','candidate_wrapped']){
      const candidate=await api.runEvolveAi('build-candidate',{command:'Scenario: '+scenario,artifacts:[]},undefined,undefined,{forceRefresh:true,requireLive:true});
      if(candidate.artifacts[0].content!==artifact)throw new Error('Candidate literal bytes changed');
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(candidate.artifacts[0].content));
      candidateHashes.push(Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join(''));
    }
    const incomplete=await api.callByokStructured({resolved:route.resolved,system:'Synthetic only',user:'Scenario: candidate_incomplete',schema:api.jsonSchemas.buildCandidate,parser:api.BuildCandidateAiResultSchema,schemaRetries:0}).catch(error=>error);
    if(!(incomplete instanceof Error))throw new Error('Incomplete Candidate accepted');
    const rejected=[];
    for(const scenario of ['length','content_filter','tool_calls','refusal','body_error']){
      const error=await api.callByokStructured({resolved:route.resolved,system:'Synthetic only',user:'Scenario: '+scenario,schema:{name:'copilot',schema:{type:'object'}},parser:api.CopilotAiResultSchema}).catch(error=>error);
      if(!(error instanceof Error))throw new Error('Nonfinal scenario accepted: '+scenario);
      if(error.message.includes(fixtureKey)||error.stack.includes(fixtureKey))throw new Error('Synthetic key escaped error boundary');
      rejected.push(scenario);
    }
    const unhealthy=await api.testByokConnection(route.resolved).catch(error=>error);
    if(!(unhealthy instanceof Error)||unhealthy.message.includes(fixtureKey))throw new Error('Failed body accepted by health probe');
    return {health:health.text,task,routeModel:route.model,rejected,failedHealthRejected:true,candidateHashes,incompleteCandidateRejected:true};
  },{providerBase,fixtureKey,model,artifact});
  assert.equal(result.health,'ok');
  assert.deepEqual(result.task,{answer:'native browser Chat passed',suggestedAction:'none',evidence:[]});
  assert.equal(result.routeModel,model);
  assert.deepEqual(requests.map(item=>item.format),['none','json_schema','json_object',...Array(8).fill('json_object'),'none']);
  assert.deepEqual(result.rejected,['length','content_filter','tool_calls','refusal','body_error']);
  assert.equal(result.failedHealthRejected,true);
  assert.deepEqual(result.candidateHashes,[artifactHash,artifactHash]);
  assert.equal(result.incompleteCandidateRejected,true);
  assert.deepEqual(appWrites,[]);
  assert.deepEqual(pageErrors,[]);
  assert.deepEqual(fixtureErrors,[]);
  const receipt={status:'PASS',transport:'Actual Chromium + CORS + native local HTTP fixture',source:'Actual registry/health/runEvolveAi modules bundled into an isolated fixture page',result,requests,appWrites,pageErrors,fixtureErrors,realProvider:false,originalFilesSent:false,realMissionAccepted:false};
  if(process.env.AI_CHAT_SMOKE_RECEIPT)await writeFile(process.env.AI_CHAT_SMOKE_RECEIPT,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
}finally{
  await context?.close();
  await closeBrowser();
  await close(provider);
  await close(app);
  if(path.dirname(scratch)!==temporaryRoot||!path.basename(scratch).startsWith('evolution-ai-chat-'))throw new Error('Refusing fixture cleanup outside temporary root');
  await rm(scratch,{recursive:true,force:true});
}