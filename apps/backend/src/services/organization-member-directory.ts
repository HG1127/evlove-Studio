import {
  OrganizationMemberListResponseSchema,
  OrganizationMemberPutRequestSchema,
  OrganizationMemberPutResponseSchema,
  OrganizationMemberRecordSchema,
  type EvolutionActor,
  type OrganizationMemberPutRequest,
  type OrganizationMemberRecord,
} from "@evolution/contracts";
import {
  getEvolutionWorkspaceId,
  getServerSupabaseConfig,
  serverSupabaseSecureConfigured,
} from "../server-env";

type JsonRecord=Record<string,unknown>;

function rowMember(row:JsonRecord):OrganizationMemberRecord{
  return OrganizationMemberRecordSchema.parse({
    workspaceId:row.workspace_id,
    actorId:row.actor_id,
    role:row.role,
    status:row.status,
    displayName:row.display_name??undefined,
    note:row.note??undefined,
    createdBy:row.created_by,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    suspendedAt:row.suspended_at??undefined,
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
    const response=await fetch(root+"/"+path,{
      ...init,
      headers:{...headers,...(init.headers??{})},
    });
    if(!response.ok){
      const detail=await response.text().catch(()=>"");
      throw new Error("Organization Member Directory HTTP "+response.status+": "+detail.slice(0,500));
    }
    if(response.status===204)return undefined;
    const text=await response.text();
    return text?JSON.parse(text):undefined;
  }
  return {request};
}

export function organizationMemberDirectoryConfigured(){
  return serverSupabaseSecureConfigured()&&Boolean(getEvolutionWorkspaceId());
}

function directoryError(message:string,code:string){
  const error=new Error(message);
  Object.assign(error,{code});
  return error;
}

export async function listOrganizationMembers(){
  const workspaceId=getEvolutionWorkspaceId();
  if(!organizationMemberDirectoryConfigured()||!workspaceId){
    return OrganizationMemberListResponseSchema.parse({
      configured:false,
      workspaceId,
      members:[],
      message:"Organization Member Directory 未配置安全数据面。",
    });
  }
  const {request}=restClient();
  const rows=await request(
    "evolution_workspace_members?select=*&workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&order=created_at.asc",
  ) as JsonRecord[];
  return OrganizationMemberListResponseSchema.parse({
    configured:true,
    workspaceId,
    members:(rows??[]).map(rowMember),
    message:"Organization Member Directory loaded.",
  });
}

export async function getOrganizationMember(actorId:string){
  const workspaceId=getEvolutionWorkspaceId();
  if(!organizationMemberDirectoryConfigured()||!workspaceId)return undefined;
  const {request}=restClient();
  const rows=await request(
    "evolution_workspace_members?select=*&workspace_id=eq."+encodeURIComponent(workspaceId)
    +"&actor_id=eq."+encodeURIComponent(actorId)
    +"&limit=1",
  ) as JsonRecord[];
  return rows?.[0]?rowMember(rows[0]):undefined;
}

export async function requireActiveOrganizationMember(
  actor:Pick<EvolutionActor,"id"|"role">,
  options?:{admin?:boolean},
){
  if(!organizationMemberDirectoryConfigured()){
    throw directoryError(
      "Active Member Directory requires EVOLUTION_WORKSPACE_ID and a secure Supabase server credential",
      "MEMBER_DIRECTORY_NOT_CONFIGURED",
    );
  }
  const member=await getOrganizationMember(actor.id);
  if(!member||member.status!=="active"){
    throw directoryError("Evolution actor is not an active workspace member","MEMBER_NOT_ACTIVE");
  }
  if(member.role!==actor.role){
    throw directoryError(
      "Evolution actor role no longer matches the current Organization Member Directory",
      "MEMBER_ROLE_MISMATCH",
    );
  }
  if(options?.admin&&member.role!=="admin"){
    throw directoryError("Active workspace admin membership is required","MEMBER_ADMIN_REQUIRED");
  }
  return member;
}

export async function listOrganizationMembersForAdmin(actor:Pick<EvolutionActor,"id"|"role">){
  const result=await listOrganizationMembers();
  if(!result.configured)return result;
  if(result.members.length)await requireActiveOrganizationMember(actor,{admin:true});
  else if(actor.role!=="admin"){
    throw directoryError("Only a signed admin can bootstrap an empty member directory","MEMBER_BOOTSTRAP_ADMIN_REQUIRED");
  }
  return result;
}

export async function upsertOrganizationMember(
  raw:OrganizationMemberPutRequest,
  actor:Pick<EvolutionActor,"id"|"role">,
  options?:{now?:string},
){
  const input=OrganizationMemberPutRequestSchema.parse(raw);
  const workspaceId=getEvolutionWorkspaceId();
  if(!organizationMemberDirectoryConfigured()||!workspaceId){
    throw directoryError(
      "Organization Member Directory requires a secure Supabase server credential",
      "MEMBER_DIRECTORY_NOT_CONFIGURED",
    );
  }
  const directory=await listOrganizationMembers();
  const bootstrap=directory.members.length===0;
  if(bootstrap){
    if(actor.role!=="admin"||input.actorId!==actor.id||input.role!=="admin"||input.status!=="active"){
      throw directoryError(
        "The first member must be the signed admin itself with active admin role",
        "MEMBER_BOOTSTRAP_INVALID",
      );
    }
  }else{
    await requireActiveOrganizationMember(actor,{admin:true});
  }

  const existing=directory.members.find((member)=>member.actorId===input.actorId);
  const activeAdmins=directory.members.filter((member)=>member.status==="active"&&member.role==="admin");
  const removesLastAdmin=existing?.status==="active"
    &&existing.role==="admin"
    &&activeAdmins.length===1
    &&activeAdmins[0]?.actorId===existing.actorId
    &&(input.status!=="active"||input.role!=="admin");
  if(removesLastAdmin){
    throw directoryError("Cannot suspend or demote the last active workspace admin","MEMBER_LAST_ADMIN");
  }

  const now=options?.now??new Date().toISOString();
  const row={
    workspace_id:workspaceId,
    actor_id:input.actorId,
    role:input.role,
    status:input.status,
    display_name:input.displayName??null,
    note:input.note??null,
    created_by:existing?.createdBy??actor.id,
    created_at:existing?.createdAt??now,
    updated_at:now,
    suspended_at:input.status==="suspended"?(existing?.suspendedAt??now):null,
  };
  const {request}=restClient();
  const rows=await request("evolution_workspace_members?on_conflict=workspace_id,actor_id",{
    method:"POST",
    headers:{Prefer:"resolution=merge-duplicates,return=representation"},
    body:JSON.stringify(row),
  }) as JsonRecord[];
  return OrganizationMemberPutResponseSchema.parse({
    bootstrap,
    member:rows?.[0]?rowMember(rows[0]):rowMember(row),
    message:bootstrap
      ?"Workspace admin membership bootstrapped."
      :input.status==="suspended"
        ?"Workspace member suspended."
        :"Workspace member updated.",
  });
}

export async function organizationMemberDirectoryHealth(){
  const workspaceId=getEvolutionWorkspaceId();
  if(!organizationMemberDirectoryConfigured()||!workspaceId){
    return {
      configured:false,
      databaseReady:false,
      activeMembers:0,
      activeAdmins:0,
      workspaceId,
    };
  }
  try{
    const result=await listOrganizationMembers();
    return {
      configured:true,
      databaseReady:true,
      activeMembers:result.members.filter((member)=>member.status==="active").length,
      activeAdmins:result.members.filter((member)=>member.status==="active"&&member.role==="admin").length,
      workspaceId,
    };
  }catch{
    return {
      configured:true,
      databaseReady:false,
      activeMembers:0,
      activeAdmins:0,
      workspaceId,
    };
  }
}
