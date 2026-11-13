import {describe,it} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {validateReleasePath,fingerprintFiles,createLabReleaseFingerprint,
  compareLabReleaseFingerprint} from "./p3q-lab-release-fingerprint.mjs";

const LAB_BRANCH="codex/artifact-evolution-governance-p0";
const HEAD="2ce15c250c5bccec9f45eb732f4395823159ac1b";
const PENDING="20261113103000_mission_job_parent_and_delete_audit_security_invariants.sql";
const cfg={git:{deploymentEnabled:{[LAB_BRANCH]:false,"codex/custom-backend-models":false}}};
const payload={branch:LAB_BRANCH,head:HEAD,config:cfg,
  appliedMigrations:28,pendingMigrations:[]};
const sha=s=>createHash("sha256").update(s).digest("hex");

describe("P3-Q immutable Lab-only Preview fingerprint",()=>{
  it("binds the reviewed worktree, pinned Lab target, and all 28 applied migrations",()=>{
    const receipt=createLabReleaseFingerprint({...payload,
      files:[{path:"apps/backend/src/services/a.ts",bytes:5,sha256:sha("hello")}]});
    assert.equal(receipt.target.environment,"preview");
    assert.equal(receipt.target.productionDeploymentAllowed,false);
    assert.equal(receipt.database.appliedAndVerifiedMigrations,28);
    assert.deepEqual(receipt.database.pendingMigrations,[]);
    assert.equal(receipt.source.baselineCommit,HEAD);
    assert.equal(receipt.authority,"REVIEW_ONLY_NOT_APPROVED");
    assert.ok(receipt.aggregateSha256.match(/^[a-f0-9]{64}$/));
    assert.equal(compareLabReleaseFingerprint(receipt,receipt),true);
  });
  it("blocks wrong branches, altered Git deploy protection, and unexpected database state",()=>{
    const files=[{path:"apps/backend/src/services/a.ts",bytes:5,sha256:sha("hello")}];
    assert.throws(()=>createLabReleaseFingerprint({...payload,branch:"main",files}),/Incorrect worktree/);
    assert.throws(()=>createLabReleaseFingerprint({...payload,files,
      config:{git:{deploymentEnabled:{[LAB_BRANCH]:true,"codex/custom-backend-models":false}}}}),/deployment protection/);
    assert.throws(()=>createLabReleaseFingerprint({...payload,files,pendingMigrations:[PENDING]}),/migration history/);
    assert.throws(()=>createLabReleaseFingerprint({...payload,files,appliedMigrations:27}),/migration history/);
  });
  it("denies secrets, generated build output, path traversal and binary artifacts",()=>{
    for(const path of [".env","docs/.env.production","apps/backend/private-keys/a.pem",
      "apps/backend/node_modules/evil.ts","../secrets.txt",".output/index.js","apps/backend/x.exe"]){
      assert.throws(()=>validateReleasePath(path),/unsafe|Invalid/);
    }
    assert.equal(validateReleasePath("apps/backend/src/services/a.ts"),"apps/backend/src/services/a.ts");
  });
  it("hashes bytes without copying source, detects tampering, and excludes the generated receipt",async()=>{
    const root=await mkdtemp(join(tmpdir(),"p3q-release-test-"));
    try{
      const dir=join(root,"apps","backend","src","services");
      await mkdir(dir,{recursive:true});
      const f="apps/backend/src/services/a.ts";
      const synthetic="const apiKey = 'SYNTHETIC_NOT_A_REAL_SECRET';\n";
      await writeFile(join(dir,"a.ts"),synthetic);
      const first=await fingerprintFiles(root,[f,f,"docs/architecture/2026-11-13-p3q-lab-release-fingerprint.json"]);
      assert.equal(first.length,1);
      assert.equal(first[0].sha256,sha(synthetic));
      const receipt=createLabReleaseFingerprint({...payload,files:first});
      assert.equal(JSON.stringify(receipt).includes("SYNTHETIC_NOT_A_REAL_SECRET"),false);
      await writeFile(join(dir,"a.ts"),synthetic+"export {};\n");
      const next=createLabReleaseFingerprint({...payload,files:await fingerprintFiles(root,[f])});
      assert.throws(()=>compareLabReleaseFingerprint(receipt,next),/has changed/);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it("rejects duplicate and unsorted fingerprints",()=>{
    const b={path:"apps/backend/b.ts",bytes:1,sha256:sha("b")};
    const a={path:"apps/backend/a.ts",bytes:1,sha256:sha("a")};
    assert.throws(()=>createLabReleaseFingerprint({...payload,files:[b,a]}),/not unique and sorted/);
    assert.throws(()=>createLabReleaseFingerprint({...payload,files:[a,a]}),/not unique and sorted/);
  });
});
