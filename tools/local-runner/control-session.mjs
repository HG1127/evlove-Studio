import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {z} from 'zod';
const id=z.string().min(1).max(240),hash=z.string().regex(/^[a-f0-9]{64}$/);
const Binding=z.object({schemaVersion:z.literal('local-control-binding-v1'),missionId:id,jobId:id,runId:id,
 sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),deadlineUtc:z.iso.datetime({offset:true}),entrypointSha256:hash}).strict();
const Intent=z.object({schemaVersion:z.literal('local-cancellation-intent-v1'),bindingSha256:hash,
 reason:z.enum(['deadline','runtime-loss','supervision-failed']),recordedAt:z.iso.datetime(),
 cancellationConfirmed:z.literal(false),automaticRestart:z.literal(false)}).strict();
const JobStatus=z.enum(['queued','running','waiting','completed','partial','failed','cancelled']);
const RunStatus=z.enum(['pending','running','completed','failed','cancelled']);
// Subset of /evolution/status: discard payloads/events; accept only explicit canonical Job -> Run bindings.
const Status=z.object({job:z.object({id,missionId:id,status:JobStatus,
 metadata:z.object({runId:id.optional()}).optional(),type:id.optional(),idempotencyKey:id.optional(),outputRef:id.optional()}),
 workflow:z.object({exists:z.literal(true),status:RunStatus})});
const Attempt=z.object({schemaVersion:z.literal('local-cancel-attempt-v1'),bindingSha256:hash,
 recordedAt:z.iso.datetime(),automaticRetry:z.literal(false)}).strict();
const Terminal=z.object({schemaVersion:z.literal('local-terminal-receipt-v1'),bindingSha256:hash,
 observedAt:z.iso.datetime(),jobStatus:z.enum(['completed','partial','failed','cancelled']),
 runStatus:z.enum(['completed','failed','cancelled']),automaticRestart:z.literal(false)}).strict();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const load=(path,schema)=>schema.parse(JSON.parse(readFileSync(path,'utf8')));
const pathOf=(directory,name)=>join(directory,name+'.json');
/** Validate a read against an explicit expected identity without creating execution/intent records. */
export function validateControlStatusBinding(raw,expected){
 const binding=Binding.pick({missionId:true,jobId:true,runId:true}).parse(expected),status=Status.parse(raw);
 const job=status.job,metadataRunId=job.metadata?.runId;
 const outputRunId=job.type==='campaign'&&job.idempotencyKey?.startsWith('workflow-control:')?job.outputRef:undefined;
 if(job.id!==binding.jobId||job.missionId!==binding.missionId
  ||!(metadataRunId||outputRunId)||[metadataRunId,outputRunId].some(runId=>runId&&runId!==binding.runId)){
  throw Error('Authoritative status binding differs');
 }
 return status;
}
function optionalRecord(directory,name,schema,binding){
 let value;try{value=load(pathOf(directory,name),schema);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(value&&value.bindingSha256!==digest(binding))throw Error(name+' binding differs');
 return value??null;
}
/** Local intent is independent of the observed backend, never an authoritative cancellation receipt. */
export function initializeControlSession(directory,raw,{deadlineUtc,entrypointSha256,now=Date.now()}){
 const binding=Binding.parse(raw),remaining=Date.parse(binding.deadlineUtc)-now;
 if(remaining<=0||remaining>1800000||Date.parse(binding.deadlineUtc)!==Date.parse(deadlineUtc)
   ||binding.entrypointSha256!==entrypointSha256)throw Error('Control binding does not match the owned execution window/file');
 writeFileSync(pathOf(directory,'control-binding'),JSON.stringify(binding)+'\n',{flag:'wx',mode:0o600});
 return readControlSession(directory,now);
}
export function recordCancellationIntent(directory,reason,now=Date.now()){
 const binding=load(pathOf(directory,'control-binding'),Binding);
 const intended=Intent.parse({schemaVersion:'local-cancellation-intent-v1',bindingSha256:digest(binding),reason,
  recordedAt:new Date(now).toISOString(),cancellationConfirmed:false,automaticRestart:false});
 try{writeFileSync(pathOf(directory,'cancellation-intent'),JSON.stringify(intended)+'\n',{flag:'wx',mode:0o600});}
 catch(error){if(error.code!=='EEXIST')throw error;}
 const stored=load(pathOf(directory,'cancellation-intent'),Intent);
 if(stored.bindingSha256!==digest(binding))throw Error('Cancellation intent belongs to another execution binding');
 return stored;
}
export function readControlSession(directory,now=Date.now()){
 const binding=load(pathOf(directory,'control-binding'),Binding);let intent;
 try{intent=load(pathOf(directory,'cancellation-intent'),Intent);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(intent&&intent.bindingSha256!==digest(binding))throw Error('Cancellation intent binding differs');
 const deadlineExpired=now>=Date.parse(binding.deadlineUtc);
 const terminal=optionalRecord(directory,'terminal-receipt',Terminal,binding);
 const cancelAttempt=optionalRecord(directory,'cancel-attempt',Attempt,binding);
 return {binding,intent:intent??null,deadlineExpired,cancellationRequired:Boolean(intent)||deadlineExpired,
  status:terminal?'terminal-confirmed':intent||deadlineExpired?'cancellation-unconfirmed':'execution-unconfirmed',
  terminal,cancelAttempt,terminalConfirmed:Boolean(terminal),
  cancellationConfirmed:terminal?.jobStatus==='cancelled'&&terminal?.runStatus==='cancelled',automaticRestart:false};
}
/** Trusted ports must read the requested authoritative Job/Run and govern cancel permission.
 * No transport, generation or restart is provided. Unknown cancel outcomes are never resent. */
export async function reconcileControlSession(directory,{readStatus,cancel,now=()=>Date.now()}){
 let session=readControlSession(directory,now());
 if(session.terminalConfirmed||!session.cancellationRequired)return session;
 if(!session.intent)recordCancellationIntent(directory,'deadline',now());
 const binding=session.binding,query=Object.freeze({jobId:binding.jobId,runId:binding.runId});
 const observe=async()=>{
  let raw;try{raw=await readStatus(query);}catch{return null;}
  return validateControlStatusBinding(raw,{missionId:binding.missionId,...query});
 };
 const persistTerminal=status=>{
  if(!status||!['completed','partial','failed','cancelled'].includes(status.job.status)
   ||!['completed','failed','cancelled'].includes(status.workflow.status))return false;
  const receipt=Terminal.parse({schemaVersion:'local-terminal-receipt-v1',bindingSha256:digest(binding),
   observedAt:new Date(now()).toISOString(),jobStatus:status.job.status,runStatus:status.workflow.status,automaticRestart:false});
  try{writeFileSync(pathOf(directory,'terminal-receipt'),JSON.stringify(receipt)+'\n',{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;}
  return true;
 };
 const before=await observe();
 if(persistTerminal(before)||!before||!cancel)return readControlSession(directory,now());
 const attempt=Attempt.parse({schemaVersion:'local-cancel-attempt-v1',bindingSha256:digest(binding),
  recordedAt:new Date(now()).toISOString(),automaticRetry:false});
 // Reserve before I/O. A crash or rejected/ambiguous POST consumes this local attempt.
 try{writeFileSync(pathOf(directory,'cancel-attempt'),JSON.stringify(attempt)+'\n',{flag:'wx',mode:0o600});}
 catch(error){if(error.code==='EEXIST')return readControlSession(directory,now());throw error;}
 try{await cancel(Object.freeze({missionId:binding.missionId,...query}));}catch{/* authoritative reread only */}
 persistTerminal(await observe());
 session=readControlSession(directory,now());
 return session;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command,directory,value,deadlineUtc,entrypointSha256]=process.argv.slice(2);
 if(command==='initialize')console.log(JSON.stringify(initializeControlSession(directory,JSON.parse(readFileSync(value,'utf8').replace(/^\uFEFF/,'')),{deadlineUtc,entrypointSha256})));
 else if(command==='intent')console.log(JSON.stringify(recordCancellationIntent(directory,value)));
 else if(command==='inspect')console.log(JSON.stringify(readControlSession(directory)));
 else throw Error('Expected initialize, intent or inspect; no execution/retry/cancel transport is provided');
}
