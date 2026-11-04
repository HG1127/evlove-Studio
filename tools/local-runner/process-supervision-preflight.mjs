import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertObservedProcessStartup} from './process-observation.mjs';

const directory=process.env.EVOLUTION_OBSERVED_PROCESS_EVIDENCE;
if(!directory||!process.argv[1])throw Error('Observed process startup binding is absent');
const entrypointSha256=createHash('sha256').update(readFileSync(process.argv[1])).digest('hex');
if(entrypointSha256!==process.env.EVOLUTION_OBSERVED_ENTRYPOINT_SHA256)throw Error('Observed entrypoint hash differs');
// The parent writes its start record immediately after spawning. Only a not-yet-created
// journal is allowed a short wait; corrupt or conflicting records are never retried.
for(let attempt=0;;attempt++){
 try{
  await assertObservedProcessStartup(directory,{pid:process.pid,
   supervisorPid:Number(process.env.EVOLUTION_OBSERVED_SUPERVISOR_PID),
   supervisorStartTicks:process.env.EVOLUTION_OBSERVED_SUPERVISOR_START_TICKS,
   entrypointSha256,deadlineUtc:process.env.EVOLUTION_EXECUTION_DEADLINE_UTC});
  break;
 }catch(error){
  if(error.code!=='ENOENT'||attempt>=20)throw error;
  await new Promise(resolve=>setTimeout(resolve,50));
 }
}
