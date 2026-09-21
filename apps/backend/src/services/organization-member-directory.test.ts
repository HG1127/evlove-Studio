// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {
  getOrganizationMember,
  listOrganizationMembers,
  organizationMemberDirectoryHealth,
  requireActiveOrganizationMember,
  upsertOrganizationMember,
} from "./organization-member-directory";

const KEYS=[
  "NODE_ENV","SUPABASE_URL","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY","EVOLUTION_WORKSPACE_ID",
] as const;
const previous=new Map<string,string|undefined>();

type Row=Record<string,unknown>;

function installDirectory(){
  const rows=new Map<string,Row>();
  const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input));
    const method=init?.method??"GET";
    const workspace=(url.searchParams.get("workspace_id")??"").replace(/^eq\./,"");
    const actorId=(url.searchParams.get("actor_id")??"").replace(/^eq\./,"");
    const selected=[...rows.values()].filter((row)=>{
      if(workspace&&row.workspace_id!==workspace)return false;
      if(actorId&&row.actor_id!==actorId)return false;
      return true;
    });
    if(method==="POST"){
      const row=JSON.parse(String(init?.body)) as Row;
      rows.set(String(row.actor_id),row);
      return new Response(JSON.stringify([row]),{status:200,headers:{"Content-Type":"application/json"}});
    }
    return new Response(JSON.stringify(selected),{status:200,headers:{"Content-Type":"application/json"}});
  });
  vi.stubGlobal("fetch",fetchMock);
  return {rows,fetchMock};
}

describe("organization member directory",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
    process.env.NODE_ENV="test";
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_SECRET_KEY="service-role-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){
      const value=previous.get(key);
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });

  it("bootstraps only the signed admin itself as the first active admin",async()=>{
    const {rows}=installDirectory();
    await expect(upsertOrganizationMember({
      actorId:"operator-1",role:"operator",status:"active",
    },{id:"operator-1",role:"operator"})).rejects.toMatchObject({code:"MEMBER_BOOTSTRAP_INVALID"});
    expect(rows.size).toBe(0);
    const result=await upsertOrganizationMember({
      actorId:"admin-1",
      role:"admin",
      status:"active",
      displayName:"Admin One",
    },{id:"admin-1",role:"admin"},{now:"2026-09-21T06:00:00.000Z"});
    expect(result).toMatchObject({
      bootstrap:true,
      member:{actorId:"admin-1",role:"admin",status:"active",createdBy:"admin-1"},
    });
    expect(rows.size).toBe(1);
  });

  it("allows an active admin to add and suspend members, with suspension immediately blocking actions",async()=>{
    installDirectory();
    await upsertOrganizationMember({
      actorId:"admin-1",role:"admin",status:"active",
    },{id:"admin-1",role:"admin"});
    await upsertOrganizationMember({
      actorId:"operator-1",role:"operator",status:"active",
    },{id:"admin-1",role:"admin"});
    await expect(requireActiveOrganizationMember({id:"operator-1",role:"operator"}))
      .resolves.toMatchObject({actorId:"operator-1",status:"active"});
    await upsertOrganizationMember({
      actorId:"operator-1",role:"operator",status:"suspended",note:"offboarded",
    },{id:"admin-1",role:"admin"},{now:"2026-09-21T06:05:00.000Z"});
    await expect(requireActiveOrganizationMember({id:"operator-1",role:"operator"}))
      .rejects.toMatchObject({code:"MEMBER_NOT_ACTIVE"});
    const member=await getOrganizationMember("operator-1");
    expect(member).toMatchObject({status:"suspended",suspendedAt:"2026-09-21T06:05:00.000Z"});
  });

  it("rejects stale signed roles when the directory role has changed",async()=>{
    installDirectory();
    await upsertOrganizationMember({
      actorId:"admin-1",role:"admin",status:"active",
    },{id:"admin-1",role:"admin"});
    await upsertOrganizationMember({
      actorId:"person-1",role:"approver",status:"active",
    },{id:"admin-1",role:"admin"});
    await expect(requireActiveOrganizationMember({id:"person-1",role:"operator"}))
      .rejects.toMatchObject({code:"MEMBER_ROLE_MISMATCH"});
  });

  it("protects the last active admin from suspension or demotion",async()=>{
    installDirectory();
    await upsertOrganizationMember({
      actorId:"admin-1",role:"admin",status:"active",
    },{id:"admin-1",role:"admin"});
    await expect(upsertOrganizationMember({
      actorId:"admin-1",role:"admin",status:"suspended",
    },{id:"admin-1",role:"admin"})).rejects.toMatchObject({code:"MEMBER_LAST_ADMIN"});
    await expect(upsertOrganizationMember({
      actorId:"admin-1",role:"operator",status:"active",
    },{id:"admin-1",role:"admin"})).rejects.toMatchObject({code:"MEMBER_LAST_ADMIN"});
  });

  it("reports directory readiness and active admin/member counts",async()=>{
    installDirectory();
    expect(await organizationMemberDirectoryHealth()).toMatchObject({
      configured:true,databaseReady:true,activeMembers:0,activeAdmins:0,
    });
    await upsertOrganizationMember({
      actorId:"admin-1",role:"admin",status:"active",
    },{id:"admin-1",role:"admin"});
    await upsertOrganizationMember({
      actorId:"viewer-1",role:"viewer",status:"active",
    },{id:"admin-1",role:"admin"});
    const health=await organizationMemberDirectoryHealth();
    expect(health).toMatchObject({databaseReady:true,activeMembers:2,activeAdmins:1});
    const list=await listOrganizationMembers();
    expect(list.members.map((item)=>item.actorId).sort()).toEqual(["admin-1","viewer-1"]);
  });
});
