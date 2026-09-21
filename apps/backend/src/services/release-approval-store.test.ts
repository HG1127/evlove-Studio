// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {
  createReleaseApprovalGrant,
  getActiveReleaseApprovalGrant,
  releaseApprovalStoreHealth,
  revokeReleaseApprovalGrants,
} from "./release-approval-store";

const KEYS=[
  "NODE_ENV","SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY","EVOLUTION_WORKSPACE_ID","EVOLUTION_RELEASE_APPROVAL_TTL_SECONDS",
] as const;
const previous=new Map<string,string|undefined>();

type Row=Record<string,unknown>;

function installStore(){
  const rows:Row[]=[];
  const fetchMock=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input));
    const method=init?.method??"GET";
    const mission=(url.searchParams.get("mission_id")??"").replace(/^eq\./,"");
    const candidate=(url.searchParams.get("candidate_id")??"").replace(/^eq\./,"");
    const workspace=(url.searchParams.get("workspace_id")??"").replace(/^eq\./,"");
    const matches=()=>rows.filter((row)=>{
      if(mission&&row.mission_id!==mission)return false;
      if(candidate&&row.candidate_id!==candidate)return false;
      if(workspace&&row.workspace_id!==workspace)return false;
      if(url.searchParams.get("revoked_at")==="is.null"&&row.revoked_at)return false;
      return true;
    });
    if(method==="POST"){
      rows.push(JSON.parse(String(init?.body)) as Row);
      return new Response(null,{status:204});
    }
    if(method==="PATCH"){
      const body=JSON.parse(String(init?.body)) as Row;
      const affected=matches();
      for(const row of affected)Object.assign(row,body);
      const prefer=String((init?.headers as Record<string,string>|undefined)?.Prefer??"");
      return prefer.includes("return=representation")
        ?new Response(JSON.stringify(affected),{status:200,headers:{"Content-Type":"application/json"}})
        :new Response(null,{status:204});
    }
    return new Response(JSON.stringify(matches()),{status:200,headers:{"Content-Type":"application/json"}});
  });
  vi.stubGlobal("fetch",fetchMock);
  return {rows,fetchMock};
}

describe("durable release approval store",()=>{
  beforeEach(()=>{
    for(const key of KEYS){previous.set(key,process.env[key]);delete process.env[key];}
    process.env.NODE_ENV="test";
    process.env.SUPABASE_URL="https://supabase.test";
    process.env.SUPABASE_PUBLISHABLE_KEY="anon-test-key-1234567890";
    process.env.EVOLUTION_WORKSPACE_ID="workspace-test";
  });
  afterEach(()=>{
    vi.unstubAllGlobals();
    for(const key of KEYS){
      const value=previous.get(key);
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  });

  it("issues a candidate-bound expiring grant and resolves it while active",async()=>{
    const {rows}=installStore();
    const grant=await createReleaseApprovalGrant({
      missionId:"mission-1",
      candidateId:"C1",
      actor:{id:"approver-1",role:"approver"},
      note:"ship",
      ttlSeconds:600,
      now:"2026-09-21T05:00:00.000Z",
    });
    expect(grant).toMatchObject({
      workspaceId:"workspace-test",
      missionId:"mission-1",
      candidateId:"C1",
      approvedBy:"approver-1",
      approvedRole:"approver",
      expiresAt:"2026-09-21T05:10:00.000Z",
    });
    expect(rows).toHaveLength(1);
    const active=await getActiveReleaseApprovalGrant({
      missionId:"mission-1",
      candidateId:"C1",
      now:Date.parse("2026-09-21T05:05:00.000Z"),
    });
    expect(active?.id).toBe(grant.id);
    expect(await getActiveReleaseApprovalGrant({
      missionId:"mission-1",
      candidateId:"C2",
      now:Date.parse("2026-09-21T05:05:00.000Z"),
    })).toBeUndefined();
  });

  it("treats an expired grant as inactive even if storage returns the row",async()=>{
    installStore();
    await createReleaseApprovalGrant({
      missionId:"mission-1",candidateId:"C1",
      actor:{id:"admin-1",role:"admin"},
      ttlSeconds:300,
      now:"2026-09-21T05:00:00.000Z",
    });
    expect(await getActiveReleaseApprovalGrant({
      missionId:"mission-1",candidateId:"C1",
      now:Date.parse("2026-09-21T05:06:00.000Z"),
    })).toBeUndefined();
  });

  it("revokes active grants and immediately removes release authorization",async()=>{
    installStore();
    await createReleaseApprovalGrant({
      missionId:"mission-1",candidateId:"C1",
      actor:{id:"approver-1",role:"approver"},
      now:"2026-09-21T05:00:00.000Z",
    });
    const revoked=await revokeReleaseApprovalGrants({
      missionId:"mission-1",
      now:"2026-09-21T05:01:00.000Z",
    });
    expect(revoked).toEqual({revokedAt:"2026-09-21T05:01:00.000Z",revokedCount:1});
    expect(await getActiveReleaseApprovalGrant({
      missionId:"mission-1",candidateId:"C1",
      now:Date.parse("2026-09-21T05:02:00.000Z"),
    })).toBeUndefined();
  });

  it("rejects grant creation by execution-only roles",async()=>{
    const {fetchMock}=installStore();
    await expect(createReleaseApprovalGrant({
      missionId:"mission-1",candidateId:"C1",
      actor:{id:"operator-1",role:"operator"},
    })).rejects.toThrow(/approver or admin/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports approval store database readiness independently",async()=>{
    installStore();
    await expect(releaseApprovalStoreHealth()).resolves.toEqual({configured:true,databaseReady:true});
  });
});
