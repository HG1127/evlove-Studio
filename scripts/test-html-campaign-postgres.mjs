import {spawn} from "node:child_process";
import {readFile,readdir} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";

// Deliberately cannot target a remote host, arbitrary database, or production Mission.
if(process.env.EVOLUTION_ALLOW_DISPOSABLE_PG_TEST!=="1")throw Error("Explicit disposable database opt-in required");
const binary=process.env.EVOLUTION_TEST_PSQL;
if(!binary||!process.env.PGPASSWORD)throw Error("Local psql path and ephemeral test password required");
const port=process.env.EVOLUTION_TEST_PG_PORT??"55439";
if(!/^\d{4,5}$/.test(port))throw Error("Invalid local audit port");
const args=["--no-psqlrc","--host=127.0.0.1","--port="+port,"--username=evolution_audit","--dbname=evolution_closed_loop_audit","--set=ON_ERROR_STOP=1","--tuples-only","--no-align"];
function query(sql,onChunk){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{windowsHide:true,env:process.env});let out="",err="";
    const timer=setTimeout(()=>{child.kill();reject(Error("Disposable database query timed out"));},90_000);
    child.stdout.on("data",chunk=>{out+=chunk;onChunk?.(out);});child.stderr.on("data",chunk=>{err+=chunk;});
    child.on("error",error=>{clearTimeout(timer);reject(error);});
    child.on("close",code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(err.slice(-5000)));});
    child.stdin.end(sql);
  });
}
assert.equal((await query("select current_database();")).trim(),"evolution_closed_loop_audit");
const existing=(await query("select count(*) from information_schema.tables where table_schema='public';")).trim();
assert.equal(existing,"0","Requires an empty disposable database; never reuse an existing application DB");
await query(await readFile("supabase/tests/disposable-platform.sql","utf8"));
for(const file of (await readdir("supabase/migrations")).filter(name=>name.endsWith(".sql")).sort()){
  await query(await readFile("supabase/migrations/"+file,"utf8"));
  console.log("MIGRATION_APPLIED",file);
}
await query(await readFile("supabase/tests/html_campaign_start_integration.sql","utf8"));
console.log("ROLLBACK_INTEGRATION_PASSED");
const suffix=randomUUID(),mission="tx-concurrency-"+suffix;
await query(`insert into public.missions(id,schema_version,stage,status,payload) values('${mission}','mission-v1','target','idle','{}');`);
const now=new Date().toISOString();
function rpc(id,key){
  const job={schemaVersion:"job-v1",id,missionId:mission,type:"campaign",status:"queued",idempotencyKey:key,
    createdAt:now,updatedAt:now,attempts:0,generation:1,priority:70,label:"isolated concurrency test"};
  return "select row_to_json(result) from public.create_evolution_html_campaign_control('"+JSON.stringify(job)+"'::jsonb,false) result;";
}
let releaseLock;
const lockHeld=new Promise(resolve=>{releaseLock=resolve;});
const first=query("begin;\n"+rpc("tx-a-"+suffix,"workflow-control:"+mission+":a")+"\n\\echo LOCK_HELD\nselect pg_sleep(2);\ncommit;",out=>{if(out.includes("LOCK_HELD"))releaseLock();});
await Promise.race([lockHeld,first.then(()=>{throw Error("First session did not expose its held transaction lock");})]);
const started=Date.now();
const second=await query(rpc("tx-b-"+suffix,"workflow-control:"+mission+":b"));
const elapsedMs=Date.now()-started;
const firstResult=await first;
const jsonLine=text=>text.split(/\r?\n/).find(line=>line.startsWith("{"));
assert.equal(JSON.parse(jsonLine(firstResult)).applied,true);
const blocked=JSON.parse(jsonLine(second));
assert.equal(blocked.applied,false);assert.equal(blocked.reason,"mission-active");
assert.ok(elapsedMs>=1000,"Second connection must wait for the first Mission transaction");
assert.equal((await query(`select count(*) from public.jobs where mission_id='${mission}';`)).trim(),"1");
console.log("TWO_CONNECTION_CONCURRENCY_PASSED",JSON.stringify({elapsedMs,jobs:1,secondDisposition:blocked.reason}));
console.log("POSTGRES_AUDIT_PASSED: real migrations, rollback fixture and simultaneous distinct-key admission");
