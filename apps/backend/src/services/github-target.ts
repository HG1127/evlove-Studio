import {
  GitRepositoryBindingSchema,
  GitTargetActionRequestSchema,
  GitTargetActionResponseSchema,
  GitTargetCapabilitiesSchema,
  type GitCheckSummary,
  type GitRepositoryBinding,
  type GitTargetActionRequest,
  type GitTargetActionResponse,
} from "@evolution/contracts";
import {getServerGitHubConfig,githubTargetConfigured,githubWebhookConfigured} from "../server-env";

type Json=Record<string,unknown>;

function configOrThrow(){
  const config=getServerGitHubConfig();
  if(!config.token){
    const error=new Error("GitHub Target 未配置 EVOLUTION_GITHUB_TOKEN");
    (error as Error&{code?:string}).code="GITHUB_TARGET_CREDENTIAL_REQUIRED";
    throw error;
  }
  if(!config.repoAllowlist.length){
    const error=new Error("GitHub Target 未配置 EVOLUTION_GITHUB_REPO_ALLOWLIST");
    (error as Error&{code?:string}).code="GITHUB_TARGET_ALLOWLIST_REQUIRED";
    throw error;
  }
  return config;
}

function fullName(repo:GitRepositoryBinding){return `${repo.owner}/${repo.repo}`;}

function assertAllowed(repo:GitRepositoryBinding){
  const config=configOrThrow();
  const key=fullName(repo).toLowerCase();
  if(!config.repoAllowlist.includes(key)){
    const error=new Error(`GitHub repository ${fullName(repo)} 不在 Server allowlist`);
    (error as Error&{code?:string}).code="GITHUB_TARGET_REPOSITORY_NOT_ALLOWED";
    throw error;
  }
  return config;
}

function safePath(path:string,prefix?:string){
  const clean=path.replace(/\\/g,"/").replace(/^\.\//,"");
  if(!clean||clean.startsWith("/")||clean.split("/").some((part)=>
    !part||part===".."||part==="."||part.includes(":")||[...part].some((char)=>char.charCodeAt(0)<32)
  )){
    throw new Error(`Unsafe Git path: ${path}`);
  }
  const base=prefix?.replace(/\\/g,"/").replace(/^\/+|\/+$/g,"");
  return base?`${base}/${clean}`:clean;
}

function safeBranchPart(value:string){
  return value.replace(/[^A-Za-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"item";
}

function branchRef(branch:string){return "heads/"+branch;}
function enc(value:string){return encodeURIComponent(value);}

async function githubRequest(repo:GitRepositoryBinding,path:string,init:RequestInit={}){
  const config=assertAllowed(repo);
  const response=await fetch(`${config.apiUrl}/repos/${enc(repo.owner)}/${enc(repo.repo)}/${path}`,{
    ...init,
    headers:{
      Accept:"application/vnd.github+json",
      Authorization:`Bearer ${config.token}`,
      "X-GitHub-Api-Version":"2022-11-28",
      "Content-Type":"application/json",
      ...(init.headers??{}),
    },
  });
  if(!response.ok){
    const detail=await response.text().catch(()=>"");
    const error=new Error(`GitHub API HTTP ${response.status}: ${detail.slice(0,600)}`);
    (error as Error&{status?:number}).status=response.status;
    throw error;
  }
  if(response.status===204)return undefined;
  return await response.json() as Json;
}

async function getRef(repo:GitRepositoryBinding,branch:string){
  return githubRequest(repo,`git/ref/${branchRef(branch).split("/").map(enc).join("/")}`) as Promise<Json>;
}

async function getCommit(repo:GitRepositoryBinding,sha:string){
  return githubRequest(repo,`git/commits/${enc(sha)}`) as Promise<Json>;
}

function objectString(value:unknown,key:string){
  if(typeof value!=="object"||!value)return undefined;
  const item=(value as Record<string,unknown>)[key];
  return typeof item==="string"?item:undefined;
}

function nestedString(value:unknown,first:string,second:string){
  if(typeof value!=="object"||!value)return undefined;
  const child=(value as Record<string,unknown>)[first];
  return objectString(child,second);
}

function checkSummary(payload:Json):GitCheckSummary{
  const runs=Array.isArray(payload.check_runs)?payload.check_runs as Json[]:[];
  let successful=0,failed=0,completed=0;
  const names:string[]=[];
  for(const run of runs){
    const name=objectString(run,"name");if(name)names.push(name);
    if(run.status==="completed"){
      completed++;
      if(["success","neutral","skipped"].includes(String(run.conclusion)))successful++;
      else failed++;
    }
  }
  const pending=Math.max(0,runs.length-completed);
  return {
    total:runs.length,completed,successful,failed,pending,
    status:failed?"failure":pending?"pending":runs.length?"success":"none",
    names,
  };
}

export function githubTargetCapabilities(){
  const configured=githubTargetConfigured();
  return GitTargetCapabilitiesSchema.parse({
    provider:"github",codeReady:true,configured,
    webhookConfigured:githubWebhookConfigured(),
    allowlistConfigured:getServerGitHubConfig().repoAllowlist.length>0,
    lifecycle:{read:true,snapshot:true,mutate:true,validate:true,deploy:true,observe:true,rollback:true},
  });
}

async function snapshot(repo:GitRepositoryBinding):Promise<GitTargetActionResponse>{
  const ref=await getRef(repo,repo.baseBranch);
  const commitSha=nestedString(ref,"object","sha");
  if(!commitSha)throw new Error("GitHub base ref response missing commit SHA");
  const commit=await getCommit(repo,commitSha);
  const treeSha=nestedString(commit,"tree","sha");
  if(!treeSha)throw new Error("GitHub commit response missing tree SHA");
  return GitTargetActionResponseSchema.parse({
    provider:"github",action:"snapshot",ok:true,repository:fullName(repo),
    branch:repo.baseBranch,baseCommitSha:commitSha,commitSha,treeSha,
    observedAt:new Date().toISOString(),note:"Captured exact Git commit/tree snapshot.",
  });
}

async function branchHead(repo:GitRepositoryBinding,branch:string){
  try{
    const existing=await getRef(repo,branch);
    const sha=nestedString(existing,"object","sha");
    if(!sha)throw new Error(`Git branch ${branch} response missing SHA`);
    return sha;
  }catch(error){
    if((error as {status?:number}).status===404)return undefined;
    throw error;
  }
}

async function createBranch(repo:GitRepositoryBinding,branch:string,expectedBaseSha:string){
  await githubRequest(repo,"git/refs",{
    method:"POST",
    body:JSON.stringify({ref:`refs/heads/${branch}`,sha:expectedBaseSha}),
  });
}

async function mutate(input:Extract<GitTargetActionRequest,{action:"mutate"}>):Promise<GitTargetActionResponse>{
  const repo=GitRepositoryBindingSchema.parse(input.repository);
  const normalizedChanges=input.changes.map((change)=>({
    change,
    path:safePath(change.path,repo.pathPrefix),
  }));
  const base=await getRef(repo,repo.baseBranch);
  const baseSha=nestedString(base,"object","sha");
  if(baseSha!==input.expectedBaseSha){
    throw new Error(`Base branch moved: ${baseSha??"unknown"} != expected ${input.expectedBaseSha}`);
  }
  const branch=input.branch??`evolve/${safeBranchPart(input.missionId)}/${safeBranchPart(input.candidateId)}`;
  const existingBranchHead=await branchHead(repo,branch);
  const parent=await getCommit(repo,input.expectedBaseSha);
  const baseTree=nestedString(parent,"tree","sha");
  if(!baseTree)throw new Error("Base commit missing tree SHA");

  const tree:Json[]=[];
  const changedPaths:string[]=[];
  for(const {change,path} of normalizedChanges){
    changedPaths.push(path);
    if(change.delete){tree.push({path,mode:"100644",type:"blob",sha:null});continue;}
    const blob=await githubRequest(repo,"git/blobs",{
      method:"POST",
      body:JSON.stringify({content:change.content,encoding:"utf-8"}),
    });
    const sha=objectString(blob,"sha");
    if(!sha)throw new Error(`GitHub blob response missing SHA for ${path}`);
    tree.push({path,mode:"100644",type:"blob",sha});
  }
  const treeReceipt=await githubRequest(repo,"git/trees",{
    method:"POST",
    body:JSON.stringify({base_tree:baseTree,tree}),
  });
  const treeSha=objectString(treeReceipt,"sha");
  if(!treeSha)throw new Error("GitHub tree response missing SHA");
  if(existingBranchHead&&existingBranchHead!==input.expectedBaseSha){
    const existingCommit=await getCommit(repo,existingBranchHead);
    const existingTreeSha=nestedString(existingCommit,"tree","sha");
    if(existingTreeSha===treeSha){
      return GitTargetActionResponseSchema.parse({
        provider:"github",action:"mutate",ok:true,repository:fullName(repo),branch,
        baseCommitSha:input.expectedBaseSha,commitSha:existingBranchHead,treeSha,changedPaths,
        observedAt:new Date().toISOString(),
        note:"Reused existing auditable branch commit because its tree exactly matches the requested accepted content.",
      });
    }
    throw new Error(`Git branch ${branch} moved to ${existingBranchHead} with a different tree; refusing overwrite`);
  }
  if(!existingBranchHead)await createBranch(repo,branch,input.expectedBaseSha);
  const commit=await githubRequest(repo,"git/commits",{
    method:"POST",
    body:JSON.stringify({message:input.commitMessage,tree:treeSha,parents:[input.expectedBaseSha]}),
  });
  const commitSha=objectString(commit,"sha");
  if(!commitSha)throw new Error("GitHub commit response missing SHA");
  await githubRequest(repo,`git/refs/${branchRef(branch).split("/").map(enc).join("/")}`,{
    method:"PATCH",
    body:JSON.stringify({sha:commitSha,force:false}),
  });
  return GitTargetActionResponseSchema.parse({
    provider:"github",action:"mutate",ok:true,repository:fullName(repo),branch,
    baseCommitSha:input.expectedBaseSha,commitSha,treeSha,changedPaths,
    observedAt:new Date().toISOString(),note:"Created auditable branch commit from exact base SHA.",
  });
}

async function validate(input:Extract<GitTargetActionRequest,{action:"validate"}>):Promise<GitTargetActionResponse>{
  const repo=GitRepositoryBindingSchema.parse(input.repository);
  const checks=checkSummary(await githubRequest(repo,`commits/${enc(input.commitSha)}/check-runs?per_page=100`) as Json);
  return GitTargetActionResponseSchema.parse({
    provider:"github",action:"validate",ok:checks.status!=="failure",repository:fullName(repo),
    commitSha:input.commitSha,checks,observedAt:new Date().toISOString(),
    note:checks.status==="success"?"All reported GitHub checks succeeded.":checks.status==="failure"?"One or more GitHub checks failed.":"GitHub checks are pending or absent.",
  });
}

async function openPr(input:Extract<GitTargetActionRequest,{action:"open-pr"}>):Promise<GitTargetActionResponse>{
  const repo=GitRepositoryBindingSchema.parse(input.repository);
  const head=`${repo.owner}:${input.branch}`;
  const query=new URLSearchParams({state:"open",head,base:repo.baseBranch,per_page:"20"});
  const existing=await githubRequest(repo,`pulls?${query.toString()}`) as unknown;
  const open=Array.isArray(existing)?existing[0] as Json|undefined:undefined;
  const pr=open??await githubRequest(repo,"pulls",{
    method:"POST",
    body:JSON.stringify({title:input.title,head:input.branch,base:repo.baseBranch,body:input.body??""}),
  });
  if(!pr)throw new Error("GitHub pull request response missing");
  const pullNumber=typeof pr.number==="number"?pr.number:undefined;
  const pullUrl=objectString(pr,"html_url");
  const commitSha=nestedString(pr,"head","sha");
  if(!pullNumber||!pullUrl)throw new Error("GitHub pull request response incomplete");
  return GitTargetActionResponseSchema.parse({
    provider:"github",action:"open-pr",ok:true,repository:fullName(repo),branch:input.branch,
    commitSha,pullNumber,pullUrl,observedAt:new Date().toISOString(),
    note:open?"Reused existing open pull request.":"Created pull request.",
  });
}

async function observe(input:Extract<GitTargetActionRequest,{action:"observe"}>):Promise<GitTargetActionResponse>{
  const repo=GitRepositoryBindingSchema.parse(input.repository);
  const checks=checkSummary(await githubRequest(repo,`commits/${enc(input.commitSha)}/check-runs?per_page=100`) as Json);
  let pullUrl:string|undefined;
  if(input.pullNumber){
    const pr=await githubRequest(repo,`pulls/${input.pullNumber}`) as Json;
    pullUrl=objectString(pr,"html_url");
  }
  return GitTargetActionResponseSchema.parse({
    provider:"github",action:"observe",ok:checks.status!=="failure",repository:fullName(repo),
    commitSha:input.commitSha,pullNumber:input.pullNumber,pullUrl,checks,
    observedAt:new Date().toISOString(),note:"Observed pull request and GitHub check state.",
  });
}

async function merge(input:Extract<GitTargetActionRequest,{action:"merge"}>):Promise<GitTargetActionResponse>{
  const repo=GitRepositoryBindingSchema.parse(input.repository);
  const pr=await githubRequest(repo,`pulls/${input.pullNumber}`) as Json;
  const headSha=nestedString(pr,"head","sha");
  if(headSha!==input.expectedHeadSha)throw new Error(`PR head moved: ${headSha??"unknown"} != expected ${input.expectedHeadSha}`);
  const result=await githubRequest(repo,`pulls/${input.pullNumber}/merge`,{
    method:"PUT",
    body:JSON.stringify({sha:input.expectedHeadSha,merge_method:input.mergeMethod}),
  }) as Json;
  if(result.merged!==true)throw new Error(`GitHub did not merge PR: ${String(result.message??"unknown")}`);
  const mergeCommitSha=objectString(result,"sha");
  return GitTargetActionResponseSchema.parse({
    provider:"github",action:"merge",ok:true,repository:fullName(repo),pullNumber:input.pullNumber,
    commitSha:input.expectedHeadSha,mergeCommitSha,observedAt:new Date().toISOString(),
    note:"Merged exact reviewed PR head SHA.",
  });
}

async function rollback(input:Extract<GitTargetActionRequest,{action:"rollback"}>):Promise<GitTargetActionResponse>{
  const repo=GitRepositoryBindingSchema.parse(input.repository);
  const base=await getRef(repo,repo.baseBranch);
  const headSha=nestedString(base,"object","sha");
  if(headSha!==input.expectedHeadSha)throw new Error(`Base branch moved: ${headSha??"unknown"} != expected ${input.expectedHeadSha}`);
  const stable=await getCommit(repo,input.stableCommitSha);
  const stableTree=nestedString(stable,"tree","sha");
  if(!stableTree)throw new Error("Stable commit missing tree SHA");
  const commit=await githubRequest(repo,"git/commits",{
    method:"POST",
    body:JSON.stringify({message:input.message,tree:stableTree,parents:[input.expectedHeadSha]}),
  }) as Json;
  const commitSha=objectString(commit,"sha");
  if(!commitSha)throw new Error("Rollback commit missing SHA");
  await githubRequest(repo,`git/refs/${branchRef(repo.baseBranch).split("/").map(enc).join("/")}`,{
    method:"PATCH",
    body:JSON.stringify({sha:commitSha,force:false}),
  });
  return GitTargetActionResponseSchema.parse({
    provider:"github",action:"rollback",ok:true,repository:fullName(repo),branch:repo.baseBranch,
    baseCommitSha:input.expectedHeadSha,commitSha,treeSha:stableTree,
    observedAt:new Date().toISOString(),note:`Created auditable rollback commit using stable tree ${input.stableCommitSha}; history was not force-rewritten.`,
  });
}

export async function executeGitTargetAction(raw:unknown):Promise<GitTargetActionResponse>{
  const input=GitTargetActionRequestSchema.parse(raw);
  if(input.action==="snapshot")return snapshot(input.repository);
  if(input.action==="mutate")return mutate(input);
  if(input.action==="validate")return validate(input);
  if(input.action==="open-pr")return openPr(input);
  if(input.action==="observe")return observe(input);
  if(input.action==="merge")return merge(input);
  return rollback(input);
}
