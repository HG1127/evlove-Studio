/**
 * P3-Q isolated Lab release fingerprint. No network, secrets, Git mutations, deployment,
 * database writes or model calls. Only --write updates ONE human-reviewable JSON receipt.
 */
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {lstat,readFile,writeFile} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {verifyLabMigrationSnapshot} from "./p3n-lab-migration-preflight.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const RECEIPT="docs/architecture/2026-11-13-p3q-lab-release-fingerprint.json";
const LAB={
  supabase:"jnlbqgpezenmpksyklme",
  vercelProject:"prj_BuJhKyI5fhoIVJRO3jEo6BzSIOhs",
  vercelTeam:"team_kK5GqMJNWpI0A7NmY6nnXgIQ",
  branch:"codex/artifact-evolution-governance-p0",
  oldPreviewCommit:"2ce15c250c5bccec9f45eb732f4395823159ac1b",
};
const safeExtensions=/\.(?:ts|tsx|js|mjs|json|md|sql|css|html|yaml|yml)$/i;
const allowedRoots=/^(?:apps|packages|src|workflows|scripts|supabase|docs)\//;
const dangerous=/(?:^|\/)(?:\.env(?:\..*)?|\.vercel|\.git|node_modules|dist|build|\.output|\.next|secrets?|credentials?|private[-_]?keys?|\.ssh)(?:\/|$)/i;
const err=(reason)=>{throw new Error("P3Q_LAB_RELEASE_BLOCKED: "+reason);};
const sha=(value)=>createHash("sha256").update(value).digest("hex");
const clean=(p)=>p.split("\\").join("/");
const cmp=(a,b)=>a.path.localeCompare(b.path,"en");
export function validateReleasePath(raw){
  if(typeof raw!=="string"||!raw||raw.includes("\0"))err("Invalid release candidate path.");
  const path=clean(raw);
  if(path.startsWith("/")||path.startsWith("./")||path.includes("..")||path.includes("//")
    ||dangerous.test(path)||!safeExtensions.test(path)
    ||!(allowedRoots.test(path)||["package.json","vercel.json","vitest.p3.config.ts"].includes(path))){
    err("Unexpected or unsafe worktree path.");
  }
  return path;
}
function git(root,args){
  try{return execFileSync("git",args,{cwd:root,encoding:"buffer",maxBuffer:2*1024*1024});}
  catch{err("Unable to read Git state; no candidate generated.");}
}
function pathsFromNul(bytes){return bytes.toString("utf8").split("\0").filter(Boolean);}
export async function fingerprintFiles(root,changedPaths){
  const paths=[...new Set(changedPaths.filter(p=>clean(p)!==RECEIPT).map(validateReleasePath))].sort();
  if(!paths.length||paths.length>250)err("Missing or excessive candidate changes.");
  const result=[];let totalBytes=0;
  for(const path of paths){
    const resolved=resolve(root,path);
    if(!resolved.startsWith(resolve(root)+"/")&&!resolved.startsWith(resolve(root)+"\\"))
      err("Release candidate escaped its worktree.");
    const stat=await lstat(resolved);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4*1024*1024)err("Unsafe candidate file type or size.");
    totalBytes+=stat.size;
    if(totalBytes>16*1024*1024)err("Total candidate exceeds review bound.");
    const bytes=await readFile(resolved);
    result.push({path,bytes:bytes.length,sha256:sha(bytes)});
  }
  return result.sort(cmp);
}
export function createLabReleaseFingerprint(args){
  const {branch,head,files,appliedMigrations,pendingMigrations,config}=args;
  if(branch!==LAB.branch||head!==LAB.oldPreviewCommit
    ||config?.git?.deploymentEnabled?.[LAB.branch]!==false
    ||config?.git?.deploymentEnabled?.["codex/custom-backend-models"]!==false){
    err("Incorrect worktree, baseline SHA, or Git deployment protection.");
  }
  if(!Array.isArray(files)||!files.length||!files.every(f=>typeof f.path==="string"
    &&Number.isSafeInteger(f.bytes)&&f.bytes>0&&/^[a-f0-9]{64}$/.test(f.sha256))){
    err("Candidate file fingerprints are missing or malformed.");
  }
  if(!Array.isArray(pendingMigrations)||pendingMigrations.length!==0||appliedMigrations!==28){
    err("Lab migration history is inconsistent: expected exactly 28 applied and zero pending.");
  }
  if(files.some((f,i)=>i>0&&files[i-1].path>=f.path))err("Candidate files are not unique and sorted.");
  const payload={
    schemaVersion:"evolve-p3q-lab-release-candidate-v1",
    authority:"REVIEW_ONLY_NOT_APPROVED",
    target:{supabaseLabProjectId:LAB.supabase,vercelProjectId:LAB.vercelProject,
      vercelTeamId:LAB.vercelTeam,environment:"preview",productionDeploymentAllowed:false},
    source:{branch,baselineCommit:head,files},
    database:{appliedAndVerifiedMigrations:appliedMigrations,pendingMigrations,
      migrationHistoryWriteAllowed:false},
    controls:{readOnlyReview:true,sourceFingerprintVerified:true,
      noCommitNoPushNoDeploy:true,realMiniMaxCallsAllowed:false},
  };
  return {...payload,aggregateSha256:sha(JSON.stringify(payload))};
}
export async function inspectLabReleaseCandidate({root=ROOT,now=new Date()}={}){
  const branch=git(root,["branch","--show-current"]).toString("utf8").trim();
  const head=git(root,["rev-parse","HEAD"]).toString("utf8").trim();
  const unmerged=git(root,["ls-files","--unmerged"]).toString("utf8").trim();
  if(unmerged)err("Unmerged Git paths block a candidate.");
  const staged=pathsFromNul(git(root,["diff","--cached","--name-only","-z"]));
  // This is a working-tree review fingerprint, not a Git commit artifact.
  // A partially staged index could produce different bytes in the eventual commit.
  if(staged.length)err("Staged index has changes; review a single frozen source state.");
  const paths=[
    ...pathsFromNul(git(root,["diff","--name-only","-z"])),
    ...pathsFromNul(git(root,["ls-files","--others","--exclude-standard","-z"])),
  ];
  const files=await fingerprintFiles(root,paths);
  const migrations=await verifyLabMigrationSnapshot({projectRoot:root,now});
  const cfg=JSON.parse(await readFile(join(root,"vercel.json"),"utf8"));
  return createLabReleaseFingerprint({
    branch,head,files,config:cfg,
    appliedMigrations:migrations.total,
    pendingMigrations:migrations.pendingMigrations.map(x=>x.localFile),
  });
}
export function compareLabReleaseFingerprint(existing,current){
  if(existing?.schemaVersion!=="evolve-p3q-lab-release-candidate-v1"
    ||existing?.aggregateSha256!==current.aggregateSha256
    ||JSON.stringify(existing)!==JSON.stringify(current)){
    err("Source, target or migration state has changed since review.");
  }
  return true;
}
async function main(argv){
  if(argv.length!==1||!["--write","--verify","--check"].includes(argv[0]))err("Use --write, --verify, or --check.");
  const now=new Date(),expected=await inspectLabReleaseCandidate({now});
  if(argv[0]==="--write"){
    await writeFile(join(ROOT,RECEIPT),JSON.stringify(expected,null,2)+"\n",{flag:"w"});
  }else if(argv[0]==="--verify"){
    let stored;
    try{stored=JSON.parse(await readFile(join(ROOT,RECEIPT),"utf8"));}catch{err("No valid offline candidate receipt exists.");}
    compareLabReleaseFingerprint(stored,expected);
  }
  console.log(JSON.stringify({
    outcome:argv[0]==="--write"?"REVIEW_RECEIPT_WRITTEN":argv[0]==="--verify"
      ?"SOURCE_MATCHES_OFFLINE_RECEIPT":"READ_ONLY_CANDIDATE_CHECKED",
    targetProject:LAB.vercelProject,previewOnly:true,files:expected.source.files.length,
    appliedMigrations:28,pendingMigrations:expected.database.pendingMigrations.length,
    sourceDigest:expected.aggregateSha256,approved:false,deployed:false,
  }));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main(process.argv.slice(2)).catch(error=>{
    console.error(error instanceof Error?error.message:"P3Q_LAB_RELEASE_BLOCKED");
    process.exitCode=1;
  });
}
