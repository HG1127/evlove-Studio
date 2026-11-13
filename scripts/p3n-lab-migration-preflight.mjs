/**
 * P3-N offline Lab-only migration history preflight.
 * NEVER connects to Supabase, alters migration records, invokes CLI db push,
 * reads credentials or mutates source migrations.
 *
 * The remote snapshot is read-only evidence for already-applied SQL. Additional
 * newer local files are reported as pending; they are never claimed as applied.
 */
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,readFile,readdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const LAB_REF="jnlbqgpezenmpksyklme";
const MIGRATION_NAME=/^(\d{14})_([a-z][a-z0-9_]*)\.sql$/;
const SHA256=/^[a-f0-9]{64}$/;
const SCRIPT_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const SNAPSHOT="docs/architecture/2026-11-13-p3n-lab-migration-snapshot.json";
const deny=(message)=>{throw new Error("P3N_LAB_MIGRATION_PREFLIGHT_BLOCKED: "+message);};
const hash=(bytes)=>createHash("sha256").update(bytes).digest("hex");

/** Remove at most one trailing LF added by the local file writer. */
export function normalizedSql(bytes){
  const data=Buffer.from(bytes);
  return data.length&&data[data.length-1]===10?data.subarray(0,data.length-1):data;
}
function validateVersionedRow(row){
  if(!row||typeof row!=="object"||typeof row.name!=="string"||!/^[a-z][a-z0-9_]*$/.test(row.name)
    ||typeof row.version!=="string"||!/^\d{14}$/.test(row.version)
    ||row.statementCount!==1||!Number.isSafeInteger(row.bytes)||row.bytes<=0
    ||typeof row.sha256!=="string"||!SHA256.test(row.sha256)){
    deny("Invalid remote statement fingerprint or migration version.");
  }
}

export async function verifyLabMigrationSnapshot({projectRoot=SCRIPT_ROOT,snapshotPath=join(projectRoot,SNAPSHOT),now=new Date()}={}){
  const raw=await readFile(snapshotPath,"utf8");
  let snap;
  try{snap=JSON.parse(raw);}catch{deny("Snapshot JSON cannot be parsed.");}
  if(snap?.schemaVersion!=="evolve-lab-migration-snapshot-v1"
    ||snap.labProjectRef!==LAB_REF||!Array.isArray(snap.migrations)||!snap.migrations.length){
    deny("Snapshot does not identify the exact independent Lab project.");
  }
  const capture=Date.parse(snap.capturedDate+"T00:00:00Z");
  if(!Number.isFinite(capture)||!Number.isFinite(now.getTime())
    ||capture>now.getTime()+24*60*60*1000||now.getTime()-capture>48*60*60*1000){
    deny("Read-only remote snapshot is older than 48h; refresh against the exact Lab before release.");
  }
  const localDirectory=join(projectRoot,"supabase","migrations");
  const localFiles=(await readdir(localDirectory)).filter(file=>file.endsWith(".sql")).sort();
  const remote=snap.migrations;
  if(localFiles.length<remote.length){
    deny("One or more SQL files already recorded in Lab are missing locally.");
  }
  const seenRemoteVersions=new Set(),seenRemoteNames=new Set(),plan=[];
  for(let i=0;i<remote.length;i++){
    const row=remote[i];validateVersionedRow(row);
    if(seenRemoteVersions.has(row.version)||seenRemoteNames.has(row.name)){
      deny("Duplicate migration versions or names in the Lab snapshot.");
    }
    seenRemoteVersions.add(row.version);seenRemoteNames.add(row.name);
    if(i>0&&remote[i-1].version>=row.version)deny("Remote migration versions are not strictly increasing.");
    const file=localFiles[i],matched=MIGRATION_NAME.exec(file);
    if(!matched||matched[2]!==row.name){
      deny("Local migration order or name differs from recorded Lab order at position "+(i+1)+".");
    }
    if(i>0&&localFiles[i-1].slice(0,14)>=matched[1]){
      deny("Local applied migration filenames are not strictly increasing.");
    }
    const normalized=normalizedSql(await readFile(join(localDirectory,file)));
    if(normalized.length!==row.bytes||hash(normalized)!==row.sha256){
      deny("SQL statement content does not match applied Lab migration: "+row.name);
    }
    plan.push({name:row.name,localFile:file,localVersion:matched[1],remoteVersion:row.version,
      exactStoredBytes:row.bytes,remoteStatementSha256:row.sha256,
      labStagingFile:row.version+"_"+row.name+".sql"});
  }
  const pendingMigrations=[];
  let previousVersion=remote.at(-1).version;
  for(const file of localFiles.slice(remote.length)){
    const match=MIGRATION_NAME.exec(file);
    if(!match)deny("Pending migration filename is invalid: "+file);
    const [,version,name]=match;
    if(version<=previousVersion)deny("Pending migration versions must be strictly newer than the Lab history.");
    if(seenRemoteNames.has(name))deny("Pending migration duplicates an already-applied name: "+name);
    if(seenRemoteVersions.has(version))deny("Pending migration duplicates an already-applied version: "+version);
    const normalized=normalizedSql(await readFile(join(localDirectory,file)));
    if(!normalized.length)deny("Pending migration is empty: "+name);
    pendingMigrations.push({name,localFile:file,localVersion:version,bytes:normalized.length,sha256:hash(normalized)});
    previousVersion=version;
  }
  return {
    projectRef:LAB_REF,captureDate:snap.capturedDate,total:plan.length,
    versionMismatches:plan.filter(r=>r.localVersion!==r.remoteVersion).length,
    sourceSha256Verified:plan.length,mode:"read-only-offline",plan,pendingMigrations,
  };
}

/** TEMP overlay only: applied files receive remote versions; pending files retain local versions. */
export async function stageLabMigrationOverlay(options={}){
  const verified=await verifyLabMigrationSnapshot(options),root=options.projectRoot||SCRIPT_ROOT;
  const stage=await mkdtemp(join(tmpdir(),"evolve-p3n-lab-"));
  const migrations=join(stage,"supabase","migrations");
  await mkdir(migrations,{recursive:true});
  for(const row of verified.plan){
    const bytes=normalizedSql(await readFile(join(root,"supabase","migrations",row.localFile)));
    if(bytes.length!==row.exactStoredBytes||hash(bytes)!==row.remoteStatementSha256){
      deny("Source SQL changed during materialization: "+row.name);
    }
    await writeFile(join(migrations,row.labStagingFile),bytes,{flag:"wx"});
  }
  for(const row of verified.pendingMigrations){
    const bytes=normalizedSql(await readFile(join(root,"supabase","migrations",row.localFile)));
    if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)deny("Pending SQL changed during materialization: "+row.name);
    await writeFile(join(migrations,row.localFile),bytes,{flag:"wx"});
  }
  await writeFile(join(stage,"READ_ONLY_STAGING.txt"),
    "Lab-only offline migration filename overlay. No Supabase link or credentials.\n"
   +"This folder is not deployment authorization and must not be used for db push.\n"
   +"Refresh remote history and obtain explicit release authorization before any CLI operation.\n",{flag:"wx"});
  return {stagingDirectory:stage,stagedFiles:verified.total+verified.pendingMigrations.length,
    appliedFiles:verified.total,pendingMigrations:verified.pendingMigrations.map(x=>x.localFile),
    versionMismatches:verified.versionMismatches};
}

async function main(argv){
  if(argv.some(flag=>flag!=="--check"&&flag!=="--stage"))deny("Only --check or --stage are supported.");
  if(argv.includes("--check")&&argv.includes("--stage"))deny("Choose only one non-mutating mode.");
  if(argv.includes("--stage")){
    const result=await stageLabMigrationOverlay();
    console.log(JSON.stringify({status:"STAGED_OFFLINE_ONLY",...result}));
  }else{
    const result=await verifyLabMigrationSnapshot();
    console.log(JSON.stringify({
      status:result.pendingMigrations.length?"VERIFIED_WITH_PENDING_MIGRATIONS":"VERIFIED_OFFLINE_ONLY",
      projectRef:result.projectRef,captureDate:result.captureDate,total:result.total,
      sourceSha256Verified:result.sourceSha256Verified,versionMismatches:result.versionMismatches,
      pendingMigrations:result.pendingMigrations.map(x=>x.localFile),
      remoteMutation:false,deployAuthorized:false,
    }));
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).catch(error=>{
    console.error(error instanceof Error?error.message:"P3N_LAB_MIGRATION_PREFLIGHT_BLOCKED");
    process.exitCode=1;
  });
}
