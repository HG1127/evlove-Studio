// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cancelLabSubscriptionBudget,initializeLabSubscriptionBudget,reserveLabSubscriptionCall,settleLabSubscriptionCall} from "./server-ai-lab-subscription-budget";
const lab={
  EVOLUTION_EXPERIMENT_MODE:"isolated",
  EVOLUTION_TEST_SUPABASE_PROJECT_REF:"jnlbqgpezenmpksyklme",
  EVOLUTION_PRODUCTION_SUPABASE_PROJECT_REF:"mlvevgdntlswxbyxmlum",
  EVOLUTION_TEST_SUPABASE_URL:"https://jnlbqgpezenmpksyklme.supabase.co",
  SUPABASE_URL:"https://jnlbqgpezenmpksyklme.supabase.co",
  SUPABASE_SECRET_KEY:"PRIVATE_SYNTHETIC_LAB_CREDENTIAL_000000000",
  SUPABASE_ARTIFACT_BUCKET:"evolve-audit-p3c-lab",
  EVOLUTION_TEST_ARTIFACT_BUCKET:"evolve-audit-p3c-lab",
  EVOLUTION_WORKSPACE_ID:"lab-evolve-p3c-test",
  EVOLUTION_IDENTITY_HMAC_SECRET:"synthetic_lab_only_identity_secret_00001",
  EVOLUTION_VAULT_MASTER_KEY:"synthetic_lab_only_vault_master_000001",
  EVOLUTION_VAULT_KEY_ID:"lab-test-vault-key",
  EVOLUTION_OPERATOR_ACCESS_KEY:"a".repeat(64),
  EVOLUTION_EVIDENCE_SIGNING_KEY:"synthetic_lab_evidence_signing_key_00001",
  EVOLUTION_EVIDENCE_SIGNING_KEY_ID:"lab-test-evidence-key",
};
const keys=[...Object.keys(lab),"VERCEL_ENV","NODE_ENV","SUPABASE_SERVICE_ROLE_KEY","SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL","VITE_SUPABASE_ANON_KEY","EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH",
  "EVOLUTION_ALLOW_PROTECTED_DEPLOYMENT_INTERNAL_AUTH"];
const saved=new Map<string,string|undefined>();
const base={missionId:"lab-mission",controlJobId:"workflow-job"};
const callId="0cc2467c-e3d6-4c5a-b9b1-82e758b3c973";
const quota={
  provider:"minimax-m-plan" as const,modelGroup:"general" as const,
  intervalRemainingPercent:82,weeklyRemainingPercent:91,intervalStatus:1 as const,weeklyStatus:1 as const,
  intervalResetAt:"2026-11-12T15:00:00.000Z",weeklyResetAt:"2026-11-16T00:00:00.000Z",
  observedAt:"2026-11-12T12:00:00.000Z",endpointOrigin:"https://www.minimax.io",
};
beforeEach(()=>{for(const key of keys){saved.set(key,process.env[key]);delete process.env[key];}Object.assign(process.env,lab);});
afterEach(()=>{for(const key of keys){const v=saved.get(key);if(v===undefined)delete process.env[key];else process.env[key]=v;}saved.clear();vi.unstubAllGlobals();});
describe("isolated Lab M Plan subscription budget RPC adapter",()=>{
  it("refuses non-Lab, production, or missing service-role data plane before requests",async()=>{
    const f=vi.fn();vi.stubGlobal("fetch",f);
    process.env.SUPABASE_URL="https://mlvevgdntlswxbyxmlum.supabase.co";
    await expect(cancelLabSubscriptionBudget(base)).rejects.toMatchObject({code:"LAB_SUBSCRIPTION_DATA_PLANE_NOT_READY"});
    process.env.SUPABASE_URL=lab.SUPABASE_URL;delete process.env.SUPABASE_SECRET_KEY;
    await expect(cancelLabSubscriptionBudget(base)).rejects.toMatchObject({code:"LAB_SUBSCRIPTION_DATA_PLANE_NOT_READY"});
    expect(f).not.toHaveBeenCalled();
  });
  it("persists initialization, quota snapshot reservation, measured tokens, unknown pause and cancellation",async()=>{
    const calls:Array<{url:string;body:Record<string,unknown>}>=[];const key=lab.SUPABASE_SECRET_KEY;
    vi.stubGlobal("fetch",vi.fn(async(url:string,init:RequestInit)=>{
      calls.push({url,body:JSON.parse(String(init.body))});return new Response(JSON.stringify({allowed:true,reason:"reserved"}),{status:200});
    }));
    await initializeLabSubscriptionBudget({...base,maxCalls:6,maxTokens:300_000,deadline:"2026-11-12T12:20:00.000Z",
      minIntervalRemainingPercent:50,minWeeklyRemainingPercent:50});
    await reserveLabSubscriptionCall({...base,callId,routeFingerprint:"f".repeat(64),reservedTokens:50000,quota});
    await settleLabSubscriptionCall({...base,callId,measuredTokens:32000});
    await settleLabSubscriptionCall({...base,callId,measuredTokens:null});
    await cancelLabSubscriptionBudget(base);
    expect(calls.map(x=>x.url.split("/").pop())).toEqual([
      "initialize_evolution_lab_subscription_budget","reserve_evolution_lab_subscription_call",
      "settle_evolution_lab_subscription_call","settle_evolution_lab_subscription_call",
      "cancel_evolution_lab_subscription_budget",
    ]);
    expect(calls[1]?.body).toMatchObject({p_reserved_tokens:50000,p_interval_remaining_percent:82,p_weekly_remaining_percent:91});
    expect(calls[2]?.body.p_measured_tokens).toBe(32000);
    expect(calls[3]?.body.p_measured_tokens).toBeNull();
    expect(JSON.stringify(calls)).not.toContain(key);
    expect(calls.every(x=>x.url.startsWith(lab.SUPABASE_URL))).toBe(true);
  });
  it("does not replay denied non-idempotent reservation and rejects malformed receipt",async()=>{
    const f=vi.fn(async()=>new Response(JSON.stringify({allowed:false,reason:"quota-insufficient"}),{status:200}));
    vi.stubGlobal("fetch",f);
    await expect(reserveLabSubscriptionCall({...base,callId,routeFingerprint:"a".repeat(64),reservedTokens:50000,quota}))
      .rejects.toMatchObject({code:"LAB_SUBSCRIPTION_BUDGET_REJECTED",reason:"quota-insufficient"});
    expect(f).toHaveBeenCalledOnce();
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({ok:true}),{status:200})));
    await expect(cancelLabSubscriptionBudget(base)).rejects.toThrow();
  });
});