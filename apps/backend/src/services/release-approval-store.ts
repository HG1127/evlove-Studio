import {randomUUID} from "node:crypto";
import {
  ReleaseApprovalGrantSchema,
  type EvolutionActor,
  type ReleaseApprovalGrant,
} from "@evolution/contracts";
import {
  getEvolutionWorkspaceId,
  getServerSupabaseConfig,
  releaseApprovalTtlSeconds,
  serverSupabaseConfigured,
} from "../server-env";

type JsonRecord=Record<string,unknown>;

function rowGrant(row:JsonRecord):ReleaseApprovalGrant{
  return ReleaseApprovalGrantSchema.parse({
    id:row.id,
    workspaceId:row.workspace_id,
    missionId:row.mission_id,
    candidateId:row.candidate_id,
    scope:row.scope,
    approvedBy:row.approved_by,
    approvedRole:row.approved_role,
    approvedAt:row.approved_at,
    expiresAt:row.expires_at,
    note:row.note??undefined,
    revokedAt:row.revoked_at??undefined,
  });
}

function restClient(){
  const config=getServerSupabaseConfig();
  const root=config.url.replace(/\/+$/,"")+"/rest/v1";
  const headers={
    apikey:config.anonKey,
    Authorization:"Bearer "+config.anonKey,
    "Content-Type":"application/json",
  };
  async function request(path:string,init:RequestInit={}){
    const response=await fetch(root+"/"+path,{...init,headers:{...headers,...(init.headers??{})}});
    if(!response.ok){
      const detail=await response.text().catch(()=>"");
      throw new Error("Release Approval Store HTTP "+response.status+": "+detail.slice(0,500));
    }
    if(response.status===204)return undefined;
    const text=await response.text();
    return text?JSON.parse(text):undefined;
  }
  return {request};
}

export function releaseApprovalStoreConfigured(){
  return serverSupabaseConfigured()&&Boolean(getEvolutionWorkspaceId());
}

export async function createReleaseApprovalGrant(args:{
  missionId:string;
  candidateId:string;
  actor:Pick<EvolutionActor,"id"|"role">;
  note?:string;
  ttlSeconds?:number;
  now?:string;
}){
  const workspaceId=getEvolutionWorkspaceId();
  if(!releaseApprovalStoreConfigured()||!workspaceId)throw new Error("Release Approval Store is not configured");
  if(args.actor.role!=="approver"&&args.actor.role!=="admin"){
    throw new Error("Release approval must be issued by approver or admin");
  }
  const approvedAt=args.now??new Date().toISOString();
  const approvedMs=Date.parse(approvedAt);
  if(!Number.isFinite(approvedMs))throw new Error("Invalid release approval time");
  const ttl=Math.max(300,Math.min(args.ttlSeconds??releaseApprovalTtlSeconds(),86_400));
  const expiresAt=new Date(approvedMs+ttl*1000).toISOString();
  const {request}=restClient();
  const missionFilter="workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&mission_id=eq."+encodeURIComponent(args.missionId)
    +"&revoked_at=is.null";
  await request("release_approval_grants?"+missionFilter,{
    method:"PATCH",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify({revoked_at:approvedAt}),
  });
  const grant=ReleaseApprovalGrantSchema.parse({
    id:"release-approval-"+randomUUID(),
    workspaceId,
    missionId:args.missionId,
    candidateId:args.candidateId,
    scope:"release",
    approvedBy:args.actor.id,
    approvedRole:args.actor.role,
    approvedAt,
    expiresAt,
    note:args.note,
  });
  await request("release_approval_grants",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify({
      id:grant.id,
      workspace_id:grant.workspaceId,
      mission_id:grant.missionId,
      candidate_id:grant.candidateId,
      scope:grant.scope,
      approved_by:grant.approvedBy,
      approved_role:grant.approvedRole,
      approved_at:grant.approvedAt,
      expires_at:grant.expiresAt,
      note:grant.note??null,
      revoked_at:null,
    }),
  });
  return grant;
}

export async function getActiveReleaseApprovalGrant(args:{
  missionId:string;
  candidateId:string;
  now?:number;
}):Promise<ReleaseApprovalGrant|undefined>{
  const workspaceId=getEvolutionWorkspaceId();
  if(!releaseApprovalStoreConfigured()||!workspaceId)return undefined;
  const now=args.now??Date.now();
  const at=new Date(now).toISOString();
  const {request}=restClient();
  const rows=await request(
    "release_approval_grants?select=*&workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&mission_id=eq."+encodeURIComponent(args.missionId)
    +"&candidate_id=eq."+encodeURIComponent(args.candidateId)
    +"&scope=eq.release&revoked_at=is.null&expires_at=gt."+encodeURIComponent(at)
    +"&order=approved_at.desc&limit=1",
  ) as JsonRecord[];
  const row=rows?.[0];
  if(!row)return undefined;
  const grant=rowGrant(row);
  if(grant.revokedAt||Date.parse(grant.expiresAt)<=now)return undefined;
  return grant;
}

export async function requireActiveReleaseApprovalGrant(args:{
  missionId:string;
  candidateId:string;
  now?:number;
}){
  const grant=await getActiveReleaseApprovalGrant(args);
  if(!grant){
    const error=new Error("Release approval is missing, expired, revoked, or bound to a different Candidate");
    Object.assign(error,{code:"RELEASE_APPROVAL_REQUIRED"});
    throw error;
  }
  return grant;
}

export async function revokeReleaseApprovalGrants(args:{
  missionId:string;
  now?:string;
}){
  const workspaceId=getEvolutionWorkspaceId();
  if(!releaseApprovalStoreConfigured()||!workspaceId)throw new Error("Release Approval Store is not configured");
  const revokedAt=args.now??new Date().toISOString();
  const {request}=restClient();
  const rows=await request(
    "release_approval_grants?workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&mission_id=eq."+encodeURIComponent(args.missionId)
    +"&revoked_at=is.null",
    {
      method:"PATCH",
      headers:{Prefer:"return=representation"},
      body:JSON.stringify({revoked_at:revokedAt}),
    },
  ) as JsonRecord[];
  return {revokedAt,revokedCount:(rows??[]).length};
}

export async function releaseApprovalStoreHealth(){
  if(!releaseApprovalStoreConfigured())return {configured:false,databaseReady:false};
  try{
    const {request}=restClient();
    await request("release_approval_grants?select=id&limit=1");
    return {configured:true,databaseReady:true};
  }catch{
    return {configured:true,databaseReady:false};
  }
}
