/**
 * Run ONLY after the authorized project owner has pulled a new Vercel
 * development environment to .env.vercel.local.
 *
 * This tool refuses expired/mis-scoped JWTs, never prints secrets, and merges
 * ONLY VERCEL_OIDC_TOKEN into the existing .env.local. It will not run login,
 * create a project, or modify any Mission / Vercel resource.
 *
 * node scripts/merge-vercel-oidc.mjs            // dry run
 * node scripts/merge-vercel-oidc.mjs --apply    // explicit update
 */
import {readFile,writeFile,rename,unlink} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const source=new URL("../.env.vercel.local",import.meta.url);
const destination=new URL("../.env.local",import.meta.url);
const link=new URL("../.vercel/project.json",import.meta.url);

function getToken(text){
  const hits=[...text.matchAll(/^\s*(?:export\s+)?VERCEL_OIDC_TOKEN\s*=\s*(.*?)\s*$/gm)];
  if(hits.length!==1)throw Error("Expected one VERCEL_OIDC_TOKEN in downloaded environment");
  const token=hits[0][1].trim().replace(/^(["'])(.*)\1$/,"$2");
  if(!/^[A-Za-z0-9._-]+$/.test(token)||token.split(".").length!==3){
    throw Error("Downloaded OIDC token is not a JWT");
  }
  return token;
}
function verifiedScope(token,project,now=Date.now()){
  const payload=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8"));
  if(!Number.isFinite(payload.exp)||payload.exp*1000<=now+300000){
    throw Error("Downloaded OIDC token is expired or too close to expiration");
  }
  if(payload.nbf&&payload.nbf*1000>now+60000)throw Error("Downloaded OIDC token not yet valid");
  if(payload.project_id!==project.projectId||payload.owner_id!==project.orgId){
    throw Error("Downloaded OIDC scope does not match this already linked Project/Team");
  }
  return new Date(payload.exp*1000).toISOString();
}
export function mergeOnlyOidc(original,token){
  const rx=/^(?:export\s+)?VERCEL_OIDC_TOKEN\s*=.*$/gm;
  const matches=[...original.matchAll(rx)];
  if(matches.length>1)throw Error("Existing env has duplicate OIDC keys");
  const eol=original.includes("\r\n")?"\r\n":"\n";
  const newLine="VERCEL_OIDC_TOKEN="+token;
  // The line regex stops before the existing CR in CRLF files; do not add a second CR.
  if(matches.length===1)return original.replace(rx,newLine);
  return original+(original.endsWith("\n")?"":eol)+newLine+eol;
}
async function main(){
  const known=new Set(["--apply"]);
  if(process.argv.slice(2).some(arg=>!known.has(arg)))throw Error("Only --apply flag is supported");
  const project=JSON.parse(await readFile(link,"utf8"));
  if(!project.projectId||!project.orgId)throw Error("Existing Vercel Project link is absent/incomplete");
  const [fetched,current]=await Promise.all([readFile(source,"utf8"),readFile(destination,"utf8")]);
  const token=getToken(fetched);
  const exp=verifiedScope(token,project);
  const merged=mergeOnlyOidc(current,token);
  console.log("Scope/expiration check passed for the currently linked Vercel Project.");
  console.log("OIDC expiration (UTC): "+exp);
  console.log("Only the existing VERCEL_OIDC_TOKEN setting is eligible for replacement; other configuration remains unchanged.");
  if(!process.argv.includes("--apply")){
    console.log("DRY_RUN: no file was changed. Re-run with --apply to update .env.local.");
    return;
  }
  if(merged===current){console.log("OIDC was already current. No change.");return;}
  // Make the single-key update atomic. The downloaded file remains untracked;
  // remove it manually when no longer needed. No backup/token is emitted to logs.
  const temporary=new URL("../.env.local.oidc-"+randomUUID()+".tmp",import.meta.url);
  try{
    await writeFile(temporary,merged,{mode:0o600,flag:"wx"});
    await rename(temporary,destination);
  }catch(error){
    await unlink(temporary).catch(()=>{});
    throw error;
  }
  console.log("Updated only VERCEL_OIDC_TOKEN. Restart the local Nitro/Vite process and rerun passive authorization status.");
}
if(process.argv[1]&&resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()){
  main().catch(error=>{
    console.error("OIDC merge failed: "+(error instanceof Error?error.message:String(error)));
    process.exitCode=1;
  });
}
