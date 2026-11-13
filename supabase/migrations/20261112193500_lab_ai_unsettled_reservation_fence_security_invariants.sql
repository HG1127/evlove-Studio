-- P3-I: enforce one in-flight budgeted call at a time; fail closed on missing settlement.
-- Forward-only replacement of the existing private RPC; P3-H migration remains immutable.
create or replace function public.reserve_evolution_lab_ai_call(
  p_mission_id text,p_control_job_id text,p_call_id uuid,
  p_route_fingerprint text,p_reserved_cost_microusd bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_job public.jobs%rowtype; v_budget public.evolution_lab_ai_budgets%rowtype;
begin
  if p_mission_id is null or p_control_job_id is null or p_call_id is null
    or p_route_fingerprint is null or p_route_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reserved_cost_microusd is null or p_reserved_cost_microusd < 1 then
    return jsonb_build_object('allowed',false,'reason','invalid-reservation');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job:' || p_control_job_id,0));
  select * into v_job from public.jobs where id=p_control_job_id for update;
  if not found or v_job.mission_id is distinct from p_mission_id
    or v_job.type is distinct from 'campaign' or v_job.generation is distinct from 1
    or v_job.idempotency_key not like 'workflow-control:%'
    or v_job.status not in ('queued','running','waiting') then
    return jsonb_build_object('allowed',false,'reason','control-inactive');
  end if;
  select * into v_budget from public.evolution_lab_ai_budgets where mission_id=p_mission_id for update;
  if not found then return jsonb_build_object('allowed',false,'reason','budget-not-enrolled'); end if;
  if v_budget.control_job_id is distinct from p_control_job_id
    or v_budget.status is distinct from 'active'
    or v_budget.deadline <= pg_catalog.clock_timestamp() then
    return jsonb_build_object('allowed',false,'reason','budget-inactive');
  end if;
  if exists (select 1 from public.evolution_lab_ai_calls where call_id=p_call_id) then
    return jsonb_build_object('allowed',false,'reason','call-id-already-used');
  end if;
  -- A failed/unobserved settlement must block subsequent physical provider attempts.
  -- This guard runs while holding the per-Mission budget row lock.
  if exists (select 1 from public.evolution_lab_ai_calls
      where mission_id=p_mission_id and status='reserved') then
    return jsonb_build_object('allowed',false,'reason','unsettled-attempt');
  end if;
  if v_budget.calls_used >= v_budget.max_calls
    or v_budget.held_cost_microusd + v_budget.spent_cost_microusd + p_reserved_cost_microusd > v_budget.max_cost_microusd then
    return jsonb_build_object('allowed',false,'reason','budget-exhausted');
  end if;
  insert into public.evolution_lab_ai_calls(call_id,mission_id,control_job_id,route_fingerprint,reserved_cost_microusd)
    values(p_call_id,p_mission_id,p_control_job_id,p_route_fingerprint,p_reserved_cost_microusd);
  update public.evolution_lab_ai_budgets
    set calls_used=calls_used+1,held_cost_microusd=held_cost_microusd+p_reserved_cost_microusd,
        updated_at=pg_catalog.clock_timestamp()
    where mission_id=p_mission_id;
  return jsonb_build_object('allowed',true,'reason','reserved');
end;
$$;

revoke execute on function public.reserve_evolution_lab_ai_call(text,text,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.reserve_evolution_lab_ai_call(text,text,uuid,text,bigint) to service_role;
