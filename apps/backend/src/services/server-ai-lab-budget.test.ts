// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cancelLabAiBudget,initializeLabAiBudget,reserveLabAiBudgetCall,settleLabAiBudgetCall} from "./server-ai-lab-budget";

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
const keys=[...Object.keys(lab),"VERCEL_ENV","NODE_ENV","EVOLUTION_EXPERIMENT_TARGET",
  "SUPABASE_SERVICE_ROLE_KEY","SUPABASE_PUBLISHABLE_KEY","VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY","EVOLUTION_ALLOW_INSECURE_INTERNAL_AUTH",
  "EVOLUTION_ALLOW_PROTECTED_DEPLOYMENT_INTERNAL_AUTH"];
const saved=new Map<string,string|undefined>();
const callId="0cc2467c-e3d6-4c5a-b9b1-82e758b3c973";
const base={missionId:"lab-mission",controlJobId:"workflow-job"};
beforeEach(()=>{for(const key of keys){saved.set(key,process.env[key]);delete process.env[key];}
  Object.assign(process.env,lab);});
afterEach(()=>{for(const key of keys){const value=saved.get(key);if(value===undefined)delete process.env[key];else process.env[key]=value;}
  saved.clear();vi.unstubAllGlobals();});
describe("isolated Lab AI transactional budget RPC boundary",()=>{
  it("rejects production or missing dedicated identity before any request",async()=>{
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    process.env.SUPABASE_URL="https://mlvevgdntlswxbyxmlum.supabase.co";
    await expect(reserveLabAiBudgetCall({...base,callId,routeFingerprint:"a".repeat(64),reservedCostMicroUsd:50_000}))
      .rejects.toMatchObject({code:"LAB_AI_BUDGET_DATA_PLANE_NOT_READY"});
    process.env.SUPABASE_URL=lab.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    await expect(cancelLabAiBudget(base)).rejects.toMatchObject({code:"LAB_AI_BUDGET_DATA_PLANE_NOT_READY"});
    process.env.SUPABASE_SECRET_KEY=lab.SUPABASE_SECRET_KEY;
    process.env.VERCEL_ENV="production";
    await expect(cancelLabAiBudget(base)).rejects.toMatchObject({code:"LAB_AI_BUDGET_DATA_PLANE_NOT_READY"});
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("binds immutable mission caps, per-attempt UUID and settle/cancel to the Lab RPCs",async()=>{
    const requests:Array<{url:string;body:Record<string,unknown>}>=[];
    vi.stubGlobal("fetch",vi.fn(async(input:string,init:RequestInit)=>{
      requests.push({url:String(input),body:JSON.parse(String(init.body)) as Record<string,unknown>});
      return new Response(JSON.stringify({allowed:true,reason:"reserved"}),{status:200});
    }));
    await initializeLabAiBudget({...base,maxCalls:6,maxCostMicroUsd:5_000_000,deadline:"2026-11-12T14:50:00Z"});
    await reserveLabAiBudgetCall({...base,callId,routeFingerprint:"f".repeat(64),reservedCostMicroUsd:50_000});
    await settleLabAiBudgetCall({...base,callId,measuredCostMicroUsd:null});
    await cancelLabAiBudget(base);
    expect(requests.map(r=>r.url.split("/").pop())).toEqual([
      "initialize_evolution_lab_ai_budget","reserve_evolution_lab_ai_call",
      "settle_evolution_lab_ai_call","cancel_evolution_lab_ai_budget",
    ]);
    expect(requests[1]?.body).toMatchObject({p_call_id:callId,p_reserved_cost_microusd:50_000});
    expect(requests[2]?.body.p_measured_cost_microusd).toBeNull();
    expect(JSON.stringify(requests)).not.toContain(lab.SUPABASE_SECRET_KEY);
    expect(requests.every(r=>r.url.startsWith(lab.SUPABASE_URL))).toBe(true);
  });
  it("denies a DB cap rejection and does not replay a non-idempotent reservation",async()=>{
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({allowed:false,reason:"budget-exhausted"})));
    vi.stubGlobal("fetch",fetchMock);
    await expect(reserveLabAiBudgetCall({...base,callId,routeFingerprint:"f".repeat(64),reservedCostMicroUsd:10_000}))
      .rejects.toMatchObject({code:"LAB_AI_BUDGET_REJECTED",reason:"budget-exhausted"});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("fails closed on malformed receipts and invalid cost or route values",async()=>{
    const fetchMock=vi.fn(async()=>new Response(JSON.stringify({ok:true})));vi.stubGlobal("fetch",fetchMock);
    await expect(cancelLabAiBudget(base)).rejects.toThrow();
    await expect(reserveLabAiBudgetCall({...base,callId,routeFingerprint:"INVALID",reservedCostMicroUsd:100}))
      .rejects.toThrow();
    await expect(settleLabAiBudgetCall({...base,callId,measuredCostMicroUsd:-1})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});