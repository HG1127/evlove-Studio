import {afterEach,describe,it} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {normalizedSql,stageLabMigrationOverlay,verifyLabMigrationSnapshot} from "./p3n-lab-migration-preflight.mjs";

const sandbox=[];
afterEach(async()=>{while(sandbox.length)await rm(sandbox.pop(),{recursive:true,force:true});});
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),"p3n-test-"));sandbox.push(dir);
  await mkdir(join(dir,"supabase","migrations"),{recursive:true});
  const files=[
    {version:"20260101000000",remoteVersion:"20261112010000",name:"initial",sql:"select 1;\n"},
    {version:"20260102000000",remoteVersion:"20261112020000",name:"followup",sql:"select 'hello';\n"},
  ];
  const migrations=[];
  for(const f of files){
    await writeFile(join(dir,"supabase","migrations",f.version+"_"+f.name+".sql"),f.sql);
    const norm=normalizedSql(Buffer.from(f.sql));
    migrations.push({version:f.remoteVersion,name:f.name,statementCount:1,bytes:norm.length,
      sha256:createHash("sha256").update(norm).digest("hex")});
  }
  const snapshotPath=join(dir,"remote-snapshot.json");
  const snap={schemaVersion:"evolve-lab-migration-snapshot-v1",labProjectRef:"jnlbqgpezenmpksyklme",
    capturedDate:"2026-11-13",migrations};
  await writeFile(snapshotPath,JSON.stringify(snap));
  return {dir,snapshotPath,snap,files,options:{projectRoot:dir,snapshotPath,now:new Date("2026-11-13T05:00:00Z")}};
}
describe("P3-N Lab migration offline SHA256 evidence guard",()=>{
  it("verifies exact applied SQL after only one trailing LF normalization",async()=>{
    const f=await fixture(),r=await verifyLabMigrationSnapshot(f.options);
    assert.equal(r.total,2);assert.equal(r.sourceSha256Verified,2);assert.equal(r.versionMismatches,2);
    assert.equal(r.mode,"read-only-offline");assert.equal(r.pendingMigrations.length,0);
    assert.equal(r.plan[0].labStagingFile,"20261112010000_initial.sql");
  });
  it("recognizes a newer pending migration without claiming it is already applied",async()=>{
    const f=await fixture(),name="20261113000000_parent_guard.sql",sql="select 42;\n";
    await writeFile(join(f.dir,"supabase","migrations",name),sql);
    const r=await verifyLabMigrationSnapshot(f.options);
    assert.equal(r.total,2);assert.deepEqual(r.pendingMigrations.map(x=>x.localFile),[name]);
    assert.equal(r.pendingMigrations[0].name,"parent_guard");
    const staged=await stageLabMigrationOverlay(f.options);sandbox.push(staged.stagingDirectory);
    const files=(await readdir(join(staged.stagingDirectory,"supabase","migrations"))).sort();
    assert.deepEqual(files,["20261112010000_initial.sql","20261112020000_followup.sql",name].sort());
    assert.equal(await readFile(join(staged.stagingDirectory,"supabase","migrations",name),"utf8"),"select 42;");
    assert.equal(await readFile(join(f.dir,"supabase","migrations",name),"utf8"),sql);
    assert.equal(staged.pendingMigrations[0],name);
  });
  it("rejects a modified SQL file, even if name and version remain the same",async()=>{
    const f=await fixture();
    await writeFile(join(f.dir,"supabase","migrations",f.files[0].version+"_initial.sql"),"select 999;\n");
    await assert.rejects(verifyLabMigrationSnapshot(f.options),/content does not match/);
  });
  it("rejects production project refs and unknown snapshot structure",async()=>{
    const f=await fixture();f.snap.labProjectRef="mlvevgdntlswxbyxmlum";
    await writeFile(f.snapshotPath,JSON.stringify(f.snap));
    await assert.rejects(verifyLabMigrationSnapshot(f.options),/exact independent Lab/);
  });
  it("rejects an old snapshot instead of trusting stale remote evidence",async()=>{
    const f=await fixture();
    await assert.rejects(verifyLabMigrationSnapshot({...f.options,now:new Date("2026-11-17T08:00:00Z")}),/older than 48h/);
  });
  it("rejects missing applied files, duplicate remote history versions, and changed order",async()=>{
    const f=await fixture();
    await rm(join(f.dir,"supabase","migrations",f.files[0].version+"_initial.sql"));
    await assert.rejects(verifyLabMigrationSnapshot(f.options),/missing locally/);
    await writeFile(join(f.dir,"supabase","migrations",f.files[0].version+"_initial.sql"),f.files[0].sql);
    f.snap.migrations[1].version=f.snap.migrations[0].version;
    await writeFile(f.snapshotPath,JSON.stringify(f.snap));
    await assert.rejects(verifyLabMigrationSnapshot(f.options),/Duplicate migration/);
    f.snap.migrations[1].version="20261112020000";f.snap.migrations.reverse();
    await writeFile(f.snapshotPath,JSON.stringify(f.snap));
    await assert.rejects(verifyLabMigrationSnapshot(f.options),/not strictly increasing|Local migration order/);
  });
  it("rejects stale, duplicate, or non-increasing pending migration versions",async()=>{
    const f=await fixture();
    await writeFile(join(f.dir,"supabase","migrations","20261112015000_too_old.sql"),"select 1;\n");
    await assert.rejects(verifyLabMigrationSnapshot(f.options),/strictly newer/);
  });
});
