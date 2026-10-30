import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {initializeControlSession,recordCancellationIntent,readControlSession,reconcileControlSession} from './control-session.mjs';
const exec=promisify(execFile);
const binding=deadlineUtc=>({schemaVersion:'local-control-binding-v1',missionId:'fixture-mission',jobId:'fixture-job',
 runId:'fixture-run',sourceCommit:'a'.repeat(40),deadlineUtc,entrypointSha256:'b'.repeat(64)});
async function directory(){await mkdir(resolve('artifacts'),{recursive:true});return mkdtemp(resolve('artifacts/control-intent-fixture-'));}
async function cancellationFixture(){
 const dir=await directory(),now=Date.now(),b=binding(new Date(now+1000).toISOString());
 initializeControlSession(dir,b,{...b,now});recordCancellationIntent(dir,'runtime-loss',now);
 return {dir,b,now:()=>now+1001};
}
const status=(jobStatus='running',runStatus='running')=>({job:{id:'fixture-job',missionId:'fixture-mission',
 status:jobStatus,metadata:{runId:'fixture-run'},secret:'never-persist'},workflow:{exists:true,status:runStatus},events:[]});

test('reconciliation persists exact authoritative terminal and never restarts or repeats cancel',async()=>{
 const {dir,now}=await cancellationFixture();let reads=0,cancels=0;
 const readStatus=async query=>{assert.deepEqual(query,{jobId:'fixture-job',runId:'fixture-run'});return status(++reads===1?'running':'cancelled',reads===1?'running':'cancelled');};
 const cancel=async scope=>{assert.deepEqual(scope,{missionId:'fixture-mission',jobId:'fixture-job',runId:'fixture-run'});cancels++;};
 const result=await reconcileControlSession(dir,{readStatus,cancel,now});
 assert.equal(result.terminalConfirmed,true);assert.equal(result.cancellationConfirmed,true);
 assert.equal(result.intent.reason,'runtime-loss');assert.equal(result.automaticRestart,false);
 await reconcileControlSession(dir,{readStatus,cancel,now});assert.equal(reads,2);assert.equal(cancels,1);
 assert.equal((await readFile(join(dir,'terminal-receipt.json'),'utf8')).includes('secret'),false);
});

test('unreachable and unknown cancel outcomes stay unconfirmed; recovery only reads',async()=>{
 const {dir,now}=await cancellationFixture();let cancels=0;
 const unavailable=()=>{throw Error('unreachable');};
 assert.equal((await reconcileControlSession(dir,{readStatus:unavailable,cancel:unavailable,now})).cancelAttempt,null);
 const cancel=()=>{cancels++;throw Error('unknown outcome');};
 let reads=0;
 await reconcileControlSession(dir,{readStatus:()=>++reads===1?status():unavailable(),cancel,now});
 const uncertain=await reconcileControlSession(dir,{readStatus:()=>status(),cancel,now});
 assert.equal(uncertain.terminalConfirmed,false);assert.equal(cancels,1);
 const recovered=await reconcileControlSession(dir,{readStatus:()=>status('cancelled','cancelled'),cancel,now});
 assert.equal(recovered.cancellationConfirmed,true);assert.equal(cancels,1);
});

test('workflow completion with waiting Job is not terminal; natural completion is not cancellation',async()=>{
 const {dir,now}=await cancellationFixture();
 assert.equal((await reconcileControlSession(dir,{readStatus:()=>status('waiting','completed'),now})).terminalConfirmed,false);
 const result=await reconcileControlSession(dir,{readStatus:()=>status('completed','completed'),now});
 assert.equal(result.terminalConfirmed,true);assert.equal(result.cancellationConfirmed,false);
});

test('legacy workflow-control Job requires canonical outputRef; conflicting or unrelated bindings fail closed',async()=>{
 const legacy=()=>{const raw=status('cancelled','cancelled');delete raw.job.metadata;
  Object.assign(raw.job,{type:'campaign',idempotencyKey:'workflow-control:fixture-mission',outputRef:'fixture-run'});return raw;};
 const {dir,now}=await cancellationFixture();
 assert.equal((await reconcileControlSession(dir,{readStatus:legacy,now})).cancellationConfirmed,true);
 for(const variant of ['type','key','ref','missing','conflict']){
  const fixture=await cancellationFixture(),raw=legacy();let cancels=0;
  if(variant==='type')raw.job.type='experiment';
  if(variant==='key')raw.job.idempotencyKey='unrelated';
  if(variant==='ref')raw.job.outputRef='other-run';
  if(variant==='missing')delete raw.job.outputRef;
  if(variant==='conflict')raw.job.metadata={runId:'other-run'};
  await assert.rejects(reconcileControlSession(fixture.dir,{readStatus:()=>raw,cancel:()=>{cancels++;},now:fixture.now}),/binding differs/);
  assert.equal(cancels,0);assert.equal(readControlSession(fixture.dir).terminalConfirmed,false);
 }
});

test('reconciliation rejects mismatched identity before cancel and corrupted terminal binding',async()=>{
 for(const field of ['id','missionId','runId']){
  const {dir,now}=await cancellationFixture();const raw=status();let cancels=0;
  if(field==='runId')raw.job.metadata.runId='other';else raw.job[field]='other';
  await assert.rejects(reconcileControlSession(dir,{readStatus:()=>raw,cancel:()=>{cancels++;},now}),/binding differs/);
  assert.equal(cancels,0);assert.equal(readControlSession(dir).cancelAttempt,null);
 }
 const {dir,now}=await cancellationFixture();await reconcileControlSession(dir,{readStatus:()=>status('failed','failed'),now});
 const file=join(dir,'terminal-receipt.json'),receipt=JSON.parse(await readFile(file,'utf8'));
 await writeFile(file,JSON.stringify({...receipt,bindingSha256:'c'.repeat(64)}));
 assert.throws(()=>readControlSession(dir),/binding differs/);
});
test('backend-unreachable intent remains bound, immutable and unconfirmed',async()=>{
 const dir=await directory(),now=Date.now(),b=binding(new Date(now+5000).toISOString());
 initializeControlSession(dir,b,{...b,now});
 const first=recordCancellationIntent(dir,'runtime-loss',now);
 assert.equal(first.cancellationConfirmed,false);
 assert.deepEqual(recordCancellationIntent(dir,'deadline',now+1000),first);
 assert.equal(readControlSession(dir,now).status,'cancellation-unconfirmed');
 assert.throws(()=>initializeControlSession(dir,b,{...b,now}),/EEXIST/);
 await writeFile(join(dir,'control-binding.json'),JSON.stringify({...b,runId:'different-run'}));
 assert.throws(()=>readControlSession(dir,now),/binding differs/);
});
test('lost controller at deadline stays unknown even if no intent was written',async()=>{
 const dir=await directory(),now=Date.now(),b=binding(new Date(now+1000).toISOString());
 initializeControlSession(dir,b,{...b,now});
 assert.equal(readControlSession(dir,now).status,'execution-unconfirmed');
 const result=readControlSession(dir,now+1001);
 assert.equal(result.cancellationRequired,true);assert.equal(result.intent,null);
 assert.equal(result.cancellationConfirmed,false);assert.equal(result.automaticRestart,false);
 assert.throws(()=>initializeControlSession(dir,{...b,token:'must-not-persist'},{...b,now}));
});
test('actual owned failure and deadline persist intent without a reachable control API',
 {skip:process.platform!=='win32',timeout:30000},async()=>{
 const dir=await directory(),launcher=resolve('tools/local-runner/observe-node-process.ps1');
 for(const [name,source,delay,reason] of [['failure','process.exit(17)',10000,'runtime-loss'],
   ['deadline','setInterval(()=>{},1000)',4500,'deadline']]){
  const entry=join(dir,name+'.mjs'),out=join(dir,name),deadlineUtc=new Date(Date.now()+delay).toISOString();
  await writeFile(entry,source);const b={...binding(deadlineUtc),entrypointSha256:createHash('sha256').update(source).digest('hex')};
  const bindingPath=join(dir,name+'-binding.json');await writeFile(bindingPath,JSON.stringify(b));
  await exec('pwsh',['-NoProfile','-File',launcher,'-EntryPoint',entry,'-EvidenceDirectory',out,
   '-DeadlineUtc',deadlineUtc,'-ControlBindingPath',bindingPath],{cwd:process.cwd(),timeout:18000});
  const result=readControlSession(out);assert.equal(result.intent.reason,reason);assert.deepEqual(result.binding,b);
  assert.equal(result.cancellationConfirmed,false);
  const rows=(await readFile(join(out,'events.jsonl'),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(rows.at(-1).kind,'exited');assert.equal(rows.at(-1).automaticRestart,false);
  assert.throws(()=>process.kill(rows[0].pid,0));
 }
});

test('owned backend termination and loss of its supervisor retain cancellation uncertainty',
 {skip:process.platform!=='win32',timeout:25000},async()=>{
 const dir=await directory(),launcher=resolve('tools/local-runner/observe-node-process.ps1');
 for(const kind of ['backend-killed','supervisor-killed']){
  const source='setInterval(()=>{},1000)',entry=join(dir,kind+'.mjs'),out=join(dir,kind);
  const deadlineUtc=new Date(Date.now()+15000).toISOString(),b={...binding(deadlineUtc),entrypointSha256:createHash('sha256').update(source).digest('hex')};
  const bindingPath=join(dir,kind+'-binding.json');await writeFile(entry,source);await writeFile(bindingPath,JSON.stringify(b));
  const proc=spawn('pwsh',['-NoProfile','-File',launcher,'-EntryPoint',entry,'-EvidenceDirectory',out,
   '-DeadlineUtc',deadlineUtc,'-ControlBindingPath',bindingPath],{cwd:process.cwd(),stdio:'ignore'});
  const ended=new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('exit',resolve);});let childPid;
  try{
   for(let i=0;i<70;i++){try{const first=JSON.parse((await readFile(join(out,'events.jsonl'),'utf8')).trim().split(/\r?\n/)[0]);childPid=first.pid;}catch{}if(childPid)break;await new Promise(r=>setTimeout(r,100));}
   assert.ok(childPid,'owned child start must be recorded');
   if(kind==='backend-killed'){process.kill(childPid);await ended;assert.equal(readControlSession(out).intent.reason,'runtime-loss');}
   else{proc.kill();await ended;const result=readControlSession(out,Date.parse(deadlineUtc)+1);
    assert.equal(result.status,'cancellation-unconfirmed');assert.equal(result.cancellationConfirmed,false);assert.equal(result.automaticRestart,false);}
  }finally{
   if(proc.exitCode===null)proc.kill();
   if(childPid)try{process.kill(childPid);}catch(error){if(error.code!=='ESRCH')throw error;}
  }
 }
});
