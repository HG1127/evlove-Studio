import {readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {z} from 'zod';

const execute=promisify(execFile);
const Identity=z.object({pid:z.number().int().positive(),startTicks:z.string().regex(/^\d{16,20}$/)}).strict();
const Probe=z.discriminatedUnion('state',[
 z.object({state:z.literal('present'),identity:Identity}).strict(),
 z.object({state:z.literal('missing')}).strict(),
 z.object({state:z.literal('unknown')}).strict(),
]);
const Event=z.object({schemaVersion:z.literal('local-node-process-event-v1'),
 kind:z.enum(['started','heartbeat','execution-deadline-reached','exited','supervision-failed']),
 at:z.iso.datetime({offset:true}),pid:Identity.shape.pid,supervisorPid:Identity.shape.pid,
 processStartTicks:Identity.shape.startTicks,supervisorStartTicks:Identity.shape.startTicks,
 deadlineUtc:z.iso.datetime({offset:true}),automaticRestart:z.literal(false).optional(),
 entrypointSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),exitCode:z.number().int().optional(),
});

/** Only OS identity is read. No arguments, environment, credentials or process output are collected. */
export async function probeWindowsProcess(raw){
 const identity=Identity.parse(raw);
 if(process.platform!=='win32')return {state:'unknown'};
 // The only interpolation is a validated positive integer; no shell is used.
 const command=`try {$p=[Diagnostics.Process]::GetProcessById(${identity.pid});$ticks=$p.StartTime.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture);@{state='present';identity=@{pid=$p.Id;startTicks=$ticks}}|ConvertTo-Json -Compress} catch {if($_.Exception -is [ArgumentException] -or $_.Exception.InnerException -is [ArgumentException]){'{"state":"missing"}'}else{exit 1}}`;
 try{
  const {stdout}=await execute('pwsh',['-NoProfile','-NonInteractive','-Command',command],
   {windowsHide:true,timeout:5000,maxBuffer:2048});
  return Probe.parse(JSON.parse(stdout));
 }catch{return {state:'unknown'};}
}

/** A stale heartbeat or lost tool handle never establishes death and never permits replay.
 * The probe port must make a fresh OS read; access errors must return unknown, never missing. */
export async function inspectObservedNodeProcess(directory,{probeProcess=probeWindowsProcess,now=()=>Date.now()}={}){
 const path=join(directory,'events.jsonl');
 if(statSync(path).size>8*1024*1024)throw Error('Process journal exceeds the observation limit');
 const bytes=readFileSync(path),rows=bytes.toString('utf8').trim().split(/\r?\n/).map(line=>Event.parse(JSON.parse(line)));
 const first=rows[0],last=rows.at(-1);
 if(first.kind!=='started'||!first.entrypointSha256||first.automaticRestart!==false)throw Error('Missing process start binding');
 let previous=-Infinity,terminal=false;
 for(const [index,row] of rows.entries()){
  if(terminal||index>0&&row.kind==='started'||row.pid!==first.pid||row.supervisorPid!==first.supervisorPid
   ||row.processStartTicks!==first.processStartTicks||row.supervisorStartTicks!==first.supervisorStartTicks
   ||row.deadlineUtc!==first.deadlineUtc||Date.parse(row.at)<previous)throw Error('Process journal binding/order differs');
  previous=Date.parse(row.at);terminal=['exited','supervision-failed'].includes(row.kind);
 }
 const observedAt=now();
 const result={schemaVersion:'local-node-process-observation-v1',observedAt:new Date(observedAt).toISOString(),
  journalSha256:createHash('sha256').update(bytes).digest('hex'),entrypointSha256:first.entrypointSha256,
  pid:first.pid,processStartTicks:first.processStartTicks,supervisorPid:first.supervisorPid,
  supervisorStartTicks:first.supervisorStartTicks,deadlineUtc:first.deadlineUtc,lastEventAt:last.at,
  deadlineExpired:observedAt>=Date.parse(first.deadlineUtc),automaticRestart:false,providerOutcome:'unassessed'};
 if(terminal){
  if(last.exitCode===undefined)throw Error('Terminal event lacks an exit code');
  return {...result,state:last.kind==='exited'?'exited':'supervision-failed',exitCode:last.exitCode};
 }
 const classify=async identity=>{
  let value;try{value=Probe.parse(await probeProcess(Object.freeze(identity)));}catch{return 'unknown';}
  return value.state==='present'?(value.identity.pid===identity.pid&&value.identity.startTicks===identity.startTicks?'matching':'reused'):value.state;
 };
 const [child,supervisor]=await Promise.all([
  classify({pid:first.pid,startTicks:first.processStartTicks}),
  classify({pid:first.supervisorPid,startTicks:first.supervisorStartTicks}),
 ]);
 const state=child==='matching'?'live':child==='unknown'?'unverified':supervisor==='matching'
  ?'awaiting-terminal-receipt':supervisor==='unknown'?'unverified':'stopped-without-terminal-receipt';
 return {...result,state,child,supervisor,providerOutcome:state==='stopped-without-terminal-receipt'?'unknown':'unassessed'};
}

/** Bind startup to the current child and its supervisor before a trusted executor can do I/O. */
export async function assertObservedProcessStartup(directory,raw,ports){
 const expected=z.object({pid:Identity.shape.pid,supervisorPid:Identity.shape.pid,
  supervisorStartTicks:Identity.shape.startTicks,entrypointSha256:z.string().regex(/^[a-f0-9]{64}$/),
  deadlineUtc:z.iso.datetime({offset:true})}).strict().parse(raw);
 const value=await inspectObservedNodeProcess(directory,ports);
 if(value.state!=='live'||value.supervisor!=='matching'||value.deadlineExpired||value.pid!==expected.pid
  ||value.supervisorPid!==expected.supervisorPid||value.supervisorStartTicks!==expected.supervisorStartTicks
  ||value.entrypointSha256!==expected.entrypointSha256||Date.parse(value.deadlineUtc)!==Date.parse(expected.deadlineUtc)
  ||(ports?.now??Date.now)()>=Date.parse(expected.deadlineUtc)){
  throw Error('Current process lacks a live, matching supervision binding');
 }
 return value;
}
