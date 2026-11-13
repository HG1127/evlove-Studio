// @vitest-environment node
import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../../../../supabase/migrations/20261112190000_lab_ai_budget_security_invariants.sql",import.meta.url),"utf8");
describe("P3-H Lab budget migration static security invariants (not a DB concurrency proof)",()=>{
  it("has transactional idempotent reservation, explicit Job cancellation lock and a hard cap",()=>{
    expect(source).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(source).toMatch(/from public\.jobs where id=p_control_job_id for update/g);
    expect(source).toMatch(/from public\.evolution_lab_ai_budgets where mission_id=p_mission_id for update/g);
    expect(source).toContain("calls_used >= v_budget.max_calls");
    expect(source).toContain("call-id-already-used");
    expect(source).toContain("max_cost_microusd between 1 and 5000000");
    expect(source).toContain("interval '20 minutes'");
  });
  it("keeps unmeasured attempts held and pauses later calls",()=>{
    expect(source).toContain("status=case when status='active' then 'paused' else status end");
    expect(source).toContain("then 'unknown' else 'settled'");
    expect(source).toContain("when status='active' then 'paused'");
    expect(source).toContain("held_cost_microusd=held_cost_microusd-v_call.reserved_cost_microusd");
    expect(source).toContain("status='cancelled'");
  });
  it("revokes browser access and grants only server role RPC access",()=>{
    for(const name of ["initialize_evolution_lab_ai_budget","reserve_evolution_lab_ai_call",
      "settle_evolution_lab_ai_call","cancel_evolution_lab_ai_budget"]){
      expect(source).toContain("revoke execute on function public."+name);
      expect(source).toContain("grant execute on function public."+name);
    }
    expect(source).toContain("enable row level security");
    expect(source).toContain("from public,anon,authenticated");
  });
});