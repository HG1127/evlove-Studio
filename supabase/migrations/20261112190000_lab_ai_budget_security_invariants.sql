-- P3-H: service-role-only transactional Lab AI experiment budget.
-- This migration defines a capability; no production Mission is enrolled by applying it.
-- All model dispatch remains fail-closed until separately authorized runtime wiring and pricing checks.
create table if not exists public.evolution_lab_ai_budgets (
  mission_id text primary key references public.missions(id) on delete restrict,
  control_job_id text not null references public.jobs(id) on delete restrict,
  max_calls integer not null check (max_calls between 1 and 6),
  max_cost_microusd bigint not null check (max_cost_microusd between 1 and 5000000),
  calls_used integer not null default 0 check (calls_used >= 0),
  held_cost_microusd bigint not null default 0 check (held_cost_microusd >= 0),
  spent_cost_microusd bigint not null default 0 check (spent_cost_microusd >= 0),
  deadline timestamptz not null,
  status text not null default 'active' check (status in ('active','paused','cancelled','overspent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.evolution_lab_ai_calls (
  call_id uuid primary key,
  mission_id text not null references public.evolution_lab_ai_budgets(mission_id) on delete restrict,
  control_job_id text not null,
  route_fingerprint text not null check (route_fingerprint ~ '^[0-9a-f]{64}$'),
  reserved_cost_microusd bigint not null check (reserved_cost_microusd >= 0),
  measured_cost_microusd bigint check (measured_cost_microusd >= 0),
  status text not null default 'reserved' check (status in ('reserved','settled','unknown')),
  started_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists evolution_lab_ai_calls_mission_idx on public.evolution_lab_ai_calls(mission_id,started_at);

alter table public.evolution_lab_ai_budgets enable row level security;
alter table public.evolution_lab_ai_calls enable row level security;
revoke all on table public.evolution_lab_ai_budgets from public,anon,authenticated;
revoke all on table public.evolution_lab_ai_calls from public,anon,authenticated;
revoke all on table public.evolution_lab_ai_budgets from service_role;
revoke all on table public.evolution_lab_ai_calls from service_role;
grant select on table public.evolution_lab_ai_budgets to service_role;
grant select on table public.evolution_lab_ai_calls to service_role;

-- Immutable enrollment; replay must never reset an existing budget or deadline.
create or replace function public.initialize_evolution_lab_ai_budget(
  p_mission_id text,p_control_job_id text,p_max_calls integer,
  p_max_cost_microusd bigint,p_deadline timestamptz
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_job public.jobs%rowtype; v_budget public.evolution_lab_ai_budgets%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job:' || p_control_job_id,0));
  select * into v_job from public.jobs where id=p_control_job_id for update;
  if not found or v_job.mission_id is distinct from p_mission_id
    or v_job.type is distinct from 'campaign' or v_job.generation is distinct from 1
    or v_job.idempotency_key not like 'workflow-control:%'
    or v_job.status not in ('queued','running','waiting') then
    return jsonb_build_object('allowed',false,'reason','control-inactive');
  end if;
  if p_mission_id is null or p_max_calls not between 1 and 6
    or p_max_cost_microusd not between 1 and 5000000 or p_deadline is null
    or p_deadline <= pg_catalog.clock_timestamp()
    or p_deadline > pg_catalog.clock_timestamp() + interval '20 minutes' then
    return jsonb_build_object('allowed',false,'reason','invalid-cap');
  end if;
  insert into public.evolution_lab_ai_budgets(mission_id,control_job_id,max_calls,max_cost_microusd,deadline)
    values(p_mission_id,p_control_job_id,p_max_calls,p_max_cost_microusd,p_deadline)
    on conflict (mission_id) do nothing;
  select * into v_budget from public.evolution_lab_ai_budgets where mission_id=p_mission_id for update;
  if v_budget.control_job_id is distinct from p_control_job_id
    or v_budget.max_calls is distinct from p_max_calls
    or v_budget.max_cost_microusd is distinct from p_max_cost_microusd
    or v_budget.deadline is distinct from p_deadline
    or v_budget.status is distinct from 'active' then
    return jsonb_build_object('allowed',false,'reason','existing-budget-immutable');
  end if;
  return jsonb_build_object('allowed',true,'reason','enrolled');
end;
$$;

-- Lock order matches Job cancellation: advisory job lock -> Job row -> budget row.
-- Each physical provider attempt consumes a unique call_id, even after retry/timeout.
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

-- Unknown usage never releases a monetary hold; freeze until human/provider reconciliation.
-- Measured overrun is retained truthfully and prevents further calls, never silently clamped.
create or replace function public.settle_evolution_lab_ai_call(
  p_mission_id text,p_control_job_id text,p_call_id uuid,p_measured_cost_microusd bigint default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_budget public.evolution_lab_ai_budgets%rowtype; v_call public.evolution_lab_ai_calls%rowtype;
begin
  if p_measured_cost_microusd is not null and p_measured_cost_microusd < 0 then
    return jsonb_build_object('allowed',false,'reason','invalid-cost');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job:' || p_control_job_id,0));
  select * into v_budget from public.evolution_lab_ai_budgets where mission_id=p_mission_id for update;
  if not found or v_budget.control_job_id is distinct from p_control_job_id then
    return jsonb_build_object('allowed',false,'reason','budget-not-found');
  end if;
  select * into v_call from public.evolution_lab_ai_calls
    where call_id=p_call_id and mission_id=p_mission_id and control_job_id=p_control_job_id for update;
  if not found or v_call.status is distinct from 'reserved' then
    return jsonb_build_object('allowed',false,'reason','call-not-reserved');
  end if;
  update public.evolution_lab_ai_calls set
    status=case when p_measured_cost_microusd is null then 'unknown' else 'settled' end,
    measured_cost_microusd=p_measured_cost_microusd,settled_at=pg_catalog.clock_timestamp()
    where call_id=p_call_id;
  if p_measured_cost_microusd is null then
    update public.evolution_lab_ai_budgets set
      status=case when status='active' then 'paused' else status end,
      updated_at=pg_catalog.clock_timestamp() where mission_id=p_mission_id;
  else
    update public.evolution_lab_ai_budgets set
      held_cost_microusd=held_cost_microusd-v_call.reserved_cost_microusd,
      spent_cost_microusd=spent_cost_microusd+p_measured_cost_microusd,
      status=case when status='cancelled' then 'cancelled'
        when spent_cost_microusd+p_measured_cost_microusd
          +held_cost_microusd-v_call.reserved_cost_microusd > max_cost_microusd
          then 'overspent' else status end,
      updated_at=pg_catalog.clock_timestamp() where mission_id=p_mission_id;
  end if;
  return jsonb_build_object('allowed',true,'reason',case when p_measured_cost_microusd is null then 'usage-unknown-paused' else 'settled' end);
end;
$$;

-- Explicit cancellation is monotonic and never refunds unknown/unfinished call holds.
create or replace function public.cancel_evolution_lab_ai_budget(
  p_mission_id text,p_control_job_id text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_budget public.evolution_lab_ai_budgets%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job:' || p_control_job_id,0));
  select * into v_budget from public.evolution_lab_ai_budgets where mission_id=p_mission_id for update;
  if not found or v_budget.control_job_id is distinct from p_control_job_id then
    return jsonb_build_object('allowed',false,'reason','budget-not-found');
  end if;
  update public.evolution_lab_ai_budgets set status='cancelled',updated_at=pg_catalog.clock_timestamp()
    where mission_id=p_mission_id;
  return jsonb_build_object('allowed',true,'reason','cancelled');
end;
$$;

revoke execute on function public.initialize_evolution_lab_ai_budget(text,text,integer,bigint,timestamptz) from public,anon,authenticated;
revoke execute on function public.reserve_evolution_lab_ai_call(text,text,uuid,text,bigint) from public,anon,authenticated;
revoke execute on function public.settle_evolution_lab_ai_call(text,text,uuid,bigint) from public,anon,authenticated;
revoke execute on function public.cancel_evolution_lab_ai_budget(text,text) from public,anon,authenticated;
grant execute on function public.initialize_evolution_lab_ai_budget(text,text,integer,bigint,timestamptz) to service_role;
grant execute on function public.reserve_evolution_lab_ai_call(text,text,uuid,text,bigint) to service_role;
grant execute on function public.settle_evolution_lab_ai_call(text,text,uuid,bigint) to service_role;
grant execute on function public.cancel_evolution_lab_ai_budget(text,text) to service_role;