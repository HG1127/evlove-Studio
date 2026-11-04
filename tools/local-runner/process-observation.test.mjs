import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inspectObservedNodeProcess,probeWindowsProcess,assertObservedProcessStartup} from './process-observation.mjs';

const execute=promisify(execFile);
async function fixture(extra=[]){
 await mkdir(resolve('artifacts'),{recursive:true});
 const dir=await mkdtemp(resolve('artifacts/process-observation-fixture-'));
 const start={schemaVersion:'local-node-process-event-v1',kind:'started',at:'2026-01-01T00:00:00Z',pid:123,
  supervisorPid:456,processStartTicks:'638000000000000001',supervisorStartTicks:'638000000000000002',
  deadlineUtc:'2026-01-01T00:30:00Z',entrypointSha256:'a'.repeat(64),automaticRestart:false};
 await writeFile(join(dir,'events.jsonl'),[start,...extra.map(row=>({...start,at:'2026-01-01T00:01:00Z',...row}))].map(JSON.stringify).join('\n')+'\n');
 return {dir,start};
}
const present=async identity=>({state:'present',identity});
test('a fresh matching OS identity establishes live execution even after its deadline',async()=>{
 const {dir}=await fixture();
 const value=await inspectObservedNodeProcess(dir,{probeProcess:present,now:()=>Date.parse('2026-01-01T01:00:00Z')});
 assert.equal(value.state,'live');assert.equal(value.deadlineExpired,true);assert.equal(value.automaticRestart,false);
 assert.equal(value.providerOutcome,'unassessed');assert.equal('passed' in value,false);
});
test('PID reuse and a missing supervisor establish stopped/unknown, without replay',async()=>{
 const {dir}=await fixture();let reads=0;
 const value=await inspectObservedNodeProcess(dir,{probeProcess:async identity=>{
  reads++;return identity.pid===123?{state:'present',identity:{...identity,startTicks:'638000000000000099'}}:{state:'missing'};
 }});
 assert.equal(reads,2);assert.equal(value.state,'stopped-without-terminal-receipt');
 assert.equal(value.child,'reused');assert.equal(value.providerOutcome,'unknown');assert.equal(value.automaticRestart,false);
});
test('missing children with live supervisors are allowed to finish writing their terminal receipt',async()=>{
 const {dir}=await fixture();
 const value=await inspectObservedNodeProcess(dir,{probeProcess:async identity=>identity.pid===123?{state:'missing'}:present(identity)});
 assert.equal(value.state,'awaiting-terminal-receipt');
});
test('access failures, stale heartbeats and malformed OS replies cannot establish stopped execution',async()=>{
 const {dir}=await fixture([{kind:'heartbeat'}]);
 for(const probe of [async()=>{throw Error('denied');},async()=>({state:'unknown'}),async()=>({state:'missing',untrusted:true})]){
  const value=await inspectObservedNodeProcess(dir,{probeProcess:probe});assert.equal(value.state,'unverified');
 }
});
test('a local exit receipt establishes process exit, never a provider or acceptance result',async()=>{
 const {dir}=await fixture([{kind:'exited',exitCode:0}]);
 const value=await inspectObservedNodeProcess(dir,{probeProcess:()=>{throw Error('must not probe a completed run');}});
 assert.equal(value.state,'exited');assert.equal(value.exitCode,0);assert.equal(value.providerOutcome,'unassessed');
 assert.equal('passed' in value,false);
});
test('mixed identities, reordered records, partial writes and incomplete terminal records fail closed',async()=>{
 for(const extra of [[{kind:'heartbeat',pid:999}],[{kind:'heartbeat',processStartTicks:'638000000000000099'}],
  [{kind:'heartbeat',at:'2025-12-31T23:59:59Z'}],[{kind:'exited'}],[{kind:'exited',exitCode:0},{kind:'heartbeat'}]]){
  const {dir}=await fixture(extra);await assert.rejects(inspectObservedNodeProcess(dir,{probeProcess:present}));
 }
 const {dir}=await fixture();await writeFile(join(dir,'events.jsonl'),'{"kind":');
 await assert.rejects(inspectObservedNodeProcess(dir,{probeProcess:present}));
});

test('startup binds current PID, supervisor creation time, entrypoint hash and original deadline',async()=>{
 const {dir,start}=await fixture(),expected={pid:start.pid,supervisorPid:start.supervisorPid,
  supervisorStartTicks:start.supervisorStartTicks,entrypointSha256:start.entrypointSha256,deadlineUtc:start.deadlineUtc};
 const ports={probeProcess:present,now:()=>Date.parse(start.at)};
 assert.equal((await assertObservedProcessStartup(dir,expected,ports)).state,'live');
 for(const override of [{pid:789},{supervisorPid:789},{supervisorStartTicks:'638000000000000099'},
  {entrypointSha256:'b'.repeat(64)},{deadlineUtc:'2026-01-01T00:31:00Z'}]){
  await assert.rejects(assertObservedProcessStartup(dir,{...expected,...override},ports));
 }
 await assert.rejects(assertObservedProcessStartup(dir,expected,{probeProcess:async()=>({state:'missing'}),now:ports.now}));
 let reads=0;
 await assert.rejects(assertObservedProcessStartup(dir,expected,{probeProcess:present,
  now:()=>Date.parse(reads++?start.deadlineUtc:start.at)}));
});

const windows={skip:process.platform!=='win32',timeout:25000};
test('real supervised Node receives literal arguments and retains a verifiable exit receipt',windows,async()=>{
 const {dir}=await fixture(),entry=join(dir,'child.mjs'),evidence=join(dir,'observed'),literal='one space "quote" ; $()';
 await writeFile(entry,'console.log(JSON.stringify({argv:process.argv.slice(2),proxyFlag:process.execArgv.includes("--use-env-proxy")}));');
 await execute('pwsh',['-NoProfile','-File',resolve('tools/local-runner/observe-node-process.ps1'),'-EntryPoint',entry,
  '-EvidenceDirectory',evidence,'-DeadlineUtc',new Date(Date.now()+15000).toISOString(),'-UseEnvironmentProxy',
  '-RequireProcessObservation',
  '-EntryPointArguments',literal],{windowsHide:true,timeout:20000});
 assert.deepEqual(JSON.parse(await readFile(join(evidence,'stdout.log'),'utf8')),{argv:[literal],proxyFlag:true});
 const status=await inspectObservedNodeProcess(evidence);
 assert.equal(status.state,'exited');assert.equal(status.exitCode,0);assert.equal(status.automaticRestart,false);
 assert.equal(JSON.stringify(status).includes(literal),false);
});
test('unbound preflight refuses to execute the entrypoint',windows,async()=>{
 const {dir}=await fixture(),entry=join(dir,'unobserved.mjs'),marker=join(dir,'must-not-run');
 await writeFile(entry,`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');`);
 await assert.rejects(execute(process.execPath,['--import',new URL('./process-supervision-preflight.mjs',import.meta.url).href,entry],
  {timeout:10000,env:{...process.env,EVOLUTION_OBSERVED_PROCESS_EVIDENCE:''}}));
 await assert.rejects(readFile(marker));
});
test('real supervisor loss preserves a live child; subsequent child loss is unknown without a false exit receipt',windows,async()=>{
 const {dir}=await fixture(),entry=join(dir,'child.mjs'),evidence=join(dir,'observed');
 await writeFile(entry,'setInterval(()=>{},1000);');
 const proc=spawn('pwsh',['-NoProfile','-File',resolve('tools/local-runner/observe-node-process.ps1'),'-EntryPoint',entry,
  '-EvidenceDirectory',evidence,'-DeadlineUtc',new Date(Date.now()+20000).toISOString()],{windowsHide:true,stdio:'ignore'});
 const exited=new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('exit',resolve);});
 let binding;
 try{
  for(let i=0;i<60;i++){
   try{const row=JSON.parse((await readFile(join(evidence,'events.jsonl'),'utf8')).trim().split('\n')[0]);
    binding={pid:row.pid,startTicks:row.processStartTicks};break;}catch{}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(binding);assert.equal((await inspectObservedNodeProcess(evidence)).state,'live');
  proc.kill();await exited;
  const orphan=await inspectObservedNodeProcess(evidence);assert.equal(orphan.state,'live');assert.equal(orphan.supervisor,'missing');
  assert.equal((await probeWindowsProcess(binding)).state,'present');process.kill(binding.pid);
  const stopped=await inspectObservedNodeProcess(evidence);
  assert.equal(stopped.state,'stopped-without-terminal-receipt');assert.equal(stopped.providerOutcome,'unknown');
  assert.equal(stopped.automaticRestart,false);
 }finally{
  if(proc.exitCode===null)proc.kill();
  if(binding){const current=await probeWindowsProcess(binding);
   if(current.state==='present'&&current.identity.startTicks===binding.startTicks)process.kill(binding.pid);}
 }
});
