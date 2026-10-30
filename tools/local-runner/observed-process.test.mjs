import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),root=process.cwd();
test('live output remains readable without closing or restarting the observed child',{skip:process.platform!=='win32',timeout:20000},async()=>{
 await mkdir(resolve('artifacts'),{recursive:true});const dir=await mkdtemp(resolve('artifacts/owned-process-live-fixture-')),entry=join(dir,'live.mjs'),out=join(dir,'evidence');
 await writeFile(entry,'console.log("live-fixture-started");setTimeout(()=>console.log("live-fixture-complete"),5000);');
 const proc=spawn('pwsh',['-NoProfile','-File',resolve('tools/local-runner/observe-node-process.ps1'),'-EntryPoint',entry,'-EvidenceDirectory',out,'-DeadlineUtc',new Date(Date.now()+14000).toISOString()],{cwd:root,stdio:'ignore'});
 const completed=new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('exit',code=>resolve(code));});
 let visible=false;
 try{
  for(let i=0;i<40;i++){
   try{visible=(await readFile(join(out,'stdout.log'),'utf8')).includes('live-fixture-started');}catch{}
   if(visible)break;await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(visible,true);assert.equal(proc.exitCode,null);
  await assert.rejects(exec('pwsh',['-NoProfile','-File',resolve('tools/local-runner/observe-node-process.ps1'),'-EntryPoint',entry,'-EvidenceDirectory',out,'-DeadlineUtc',new Date(Date.now()+10000).toISOString()],{cwd:root}));
  assert.equal(await completed,0);assert.match(await readFile(join(out,'stdout.log'),'utf8'),/live-fixture-complete/);
 }finally{if(proc.exitCode===null)proc.kill();}
});
test('Windows owned-process evidence retains failure and enforces an unchanged absolute deadline',{skip:process.platform!=='win32',timeout:30000},async()=>{
 await mkdir(resolve('artifacts'),{recursive:true});const dir=await mkdtemp(resolve('artifacts/owned-process-fixture-'));
 const launcher=resolve('tools/local-runner/observe-node-process.ps1');
 async function run(name,source,delay){
  const entry=join(dir,name+'.mjs'),out=join(dir,name);await writeFile(entry,source);
  await exec('pwsh',['-NoProfile','-File',launcher,'-EntryPoint',entry,'-EvidenceDirectory',out,'-DeadlineUtc',new Date(Date.now()+delay).toISOString()],{cwd:root,timeout:15000});
  return {rows:(await readFile(join(out,'events.jsonl'),'utf8')).trim().split(/\r?\n/).map(JSON.parse),out};
 }
 const failure=await run('failure','console.error("trusted-fixture");process.exit(17);',10000);
 assert.equal(failure.rows[0].kind,'started');assert.equal(failure.rows.at(-1).exitCode,17);assert.equal(failure.rows.at(-1).deadlineStop,false);
 assert.match(await readFile(join(failure.out,'stderr.log'),'utf8'),/trusted-fixture/);
 const deadline=await run('deadline','setInterval(()=>{},1000);',4000);
 assert.ok(deadline.rows.some(r=>r.kind==='heartbeat'));assert.equal(deadline.rows.at(-1).kind,'exited');assert.equal(deadline.rows.at(-1).deadlineStop,true);
 assert.ok(deadline.rows.every(r=>r.pid===deadline.rows[0].pid&&r.deadlineUtc===deadline.rows[0].deadlineUtc));
 assert.equal(deadline.rows.at(-1).automaticRestart,false);assert.throws(()=>process.kill(deadline.rows[0].pid,0));
 const invalid=join(dir,'invalid'),marker=join(dir,'should-not-run');
 const entry=join(dir,'never.mjs');await writeFile(entry,`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');`);
 await assert.rejects(exec('pwsh',['-NoProfile','-File',launcher,'-EntryPoint',entry,'-EvidenceDirectory',invalid,'-DeadlineUtc',new Date(Date.now()-1000).toISOString()],{cwd:root}));
 await assert.rejects(access(marker));await assert.rejects(access(invalid));
 const serialized=JSON.stringify([...failure.rows,...deadline.rows]);assert.ok(!serialized.includes('EnvironmentFiles'));assert.ok(!serialized.includes('trusted-fixture'));
});
