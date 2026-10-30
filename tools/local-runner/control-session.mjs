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
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const load=(path,schema)=>schema.parse(JSON.parse(readFileSync(path,'utf8')));
const pathOf=(directory,name)=>join(directory,name+'.json');
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
 return {binding,intent:intent??null,deadlineExpired,cancellationRequired:Boolean(intent)||deadlineExpired,
  status:intent||deadlineExpired?'cancellation-unconfirmed':'execution-unconfirmed',
  cancellationConfirmed:false,automaticRestart:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [command,directory,value,deadlineUtc,entrypointSha256]=process.argv.slice(2);
 if(command==='initialize')console.log(JSON.stringify(initializeControlSession(directory,JSON.parse(readFileSync(value,'utf8').replace(/^\uFEFF/,'')),{deadlineUtc,entrypointSha256})));
 else if(command==='intent')console.log(JSON.stringify(recordCancellationIntent(directory,value)));
 else if(command==='inspect')console.log(JSON.stringify(readControlSession(directory)));
 else throw Error('Expected initialize, intent or inspect; no execution/retry/cancel transport is provided');
}
