-- P3-M: dedicated M Plan subscription quota budget. USD and subscription tokens are never mixed.
-- Additive, service-role-only Lab tables; no production Mission is enrolled by this migration.
create table if not exists public.evolution_lab_subscription_budgets (
  mission_id text primary key references public.missions(id) on delete restrict,
  control_job_id text not null references public.jobs(id) on delete restrict,
  max_calls integer not null check (max_calls between 1 and 6),
  max_tokens bigint not null check (max_tokens between 10000 and 300000),
  calls_used integer not null default 0 check (calls_used >= 0),
  held_tokens bigint not null default 0 check (held_tokens >= 0),
  spent_tokens bigint not null default 0 check (spent_tokens >= 0),
  min_interval_remaining_percent numeric(7,3) not null check (min_interval_remaining_percent between 1 and 100),
  min_weekly_remaining_percent numeric(7,3) not null check (min_weekly_remaining_percent between 1 and 100),
  deadline timestamptz not null,
  status text not null default 'active' check (status in ('active','paused','cancelled','overspent')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table if not exists public.evolution_lab_subscription_calls (
  call_id uuid primary key,
  mission_id text not null references public.evolution_lab_subscription_budgets(mission_id) on delete restrict,
  control_job_id text not null references public.jobs(id) on delete restrict,
  route_fingerprint text not null check (route_fingerprint ~ '^[0-9a-f]{64}$'),
  reserved_tokens bigint not null check (reserved_tokens between 1 and 100000),
  measured_tokens bigint check (measured_tokens between 0 and 10000000),
  interval_remaining_percent numeric(7,3) not null check (interval_remaining_percent between 0 and 1000),
  weekly_remaining_percent numeric(7,3) not null check (weekly_remaining_percent between 0 and 1000),
  interval_status integer not null check (interval_status between 0 and 3),
  weekly_status integer not null check (weekly_status between 0 and 3),
  interval_reset_at timestamptz not null,
  weekly_reset_at timestamptz not null,
  quota_observed_at timestamptz not null,
  status text not null default 'reserved' check (status in ('reserved','settled','unknown')),
  started_at timestamptz not null default pg_catalog.clock_timestamp(),
  settled_at timestamptz
);
create index if not exists evolution_lab_subscription_calls_mission_status_idx
  on public.evolution_lab_subscription_calls(mission_id,status,started_at desc);

alter table public.evolution_lab_subscription_budgets enable row level security;
alter table public.evolution_lab_subscription_calls enable row level security;
revoke all on public.evolution_lab_subscription_budgets from public,anon,authenticated;
revoke all on public.evolution_lab_subscription_calls from public,anon,authenticated;
grant all on public.evolution_lab_subscription_budgets to service_role;
grant all on public.evolution_lab_subscription_calls to service_role;

create or replace function public.initialize_evolution_lab_subscription_budget(
  p_mission_id text,p_control_job_id text,p_max_calls integer,p_max_tokens bigint,
  p_deadline timestamptz,p_min_interval_remaining_percent numeric,p_min_weekly_remaining_percent numeric
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_job public.jobs%rowtype; v_budget public.evolution_lab_subscription_budgets%rowtype;
begin
  if p_mission_id is null or p_control_job_id is null then
    return jsonb_build_object('allowed',false,'reason','invalid-cap');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job:' || p_control_job_id,0));
  select * into v_job from public.jobs where id=p_control_job_id for update;
  if not found or v_job.mission_id is distinct from p_mission_id
    or v_job.type is distinct from 'campaign' or v_job.generation is distinct from 1
    or v_job.idempotency_key not like 'workflow-control:%'
    or v_job.status not in ('queued','running','waiting') then
    return jsonb_build_object('allowed',false,'reason','control-inactive');
  end if;
  if p_max_calls is null or p_max_calls not between 1 and 6
    or p_max_tokens is null or p_max_tokens not between 10000 and 300000
    or p_deadline is null or p_deadline<=pg_catalog.clock_timestamp()
    or p_deadline>pg_catalog.clock_timestamp()+interval '20 minutes'
    or p_min_interval_remaining_percent is null or p_min_interval_remaining_percent not between 1 and 100
    or p_min_weekly_remaining_percent is null or p_min_weekly_remaining_percent not between 1 and 100 then
    return jsonb_build_object('allowed',false,'reason','invalid-cap');
  end if;
  insert into public.evolution_lab_subscription_budgets(
    mission_id,control_job_id,max_calls,max_tokens,deadline,
    min_interval_remaining_percent,min_weekly_remaining_percent
  ) values (
    p_mission_id,p_control_job_id,p_max_calls,p_max_tokens,p_deadline,
    p_min_interval_remaining_percent,p_min_weekly_remaining_percent
  ) on conflict (mission_id) do nothing;
  select * into v_budget from public.evolution_lab_subscription_budgets where mission_id=p_mission_id for update;
  if v_budget.control_job_id is distinct from p_control_job_id
    or v_budget.max_calls is distinct from p_max_calls
    or v_budget.max_tokens is distinct from p_max_tokens
    or v_budget.deadline is distinct from p_deadline
    or v_budget.min_interval_remaining_percent is distinct from p_min_interval_remaining_percent
    or v_budget.min_weekly_remaining_percent is distinct from p_min_weekly_remaining_percent
    or v_budget.status is distinct from 'active' then
    return jsonb_build_object('allowed',false,'reason','existing-budget-immutable');
  end if;
  return jsonb_build_object('allowed',true,'reason','enrolled');
end;
$$;

create or replace function public.reserve_evolution_lab_subscription_call(
  p_mission_id text,p_control_job_id text,p_call_id uuid,p_route_fingerprint text,
  p_reserved_tokens bigint,p_interval_remaining_percent numeric,p_weekly_remaining_percent numeric,
  p_interval_status integer,p_weekly_status integer,p_interval_reset_at timestamptz,
  p_weekly_reset_at timestamptz,p_quota_observed_at timestamptz
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_job public.jobs%rowtype; v_budget public.evolution_lab_subscription_budgets%rowtype;
begin
  if p_mission_id is null or p_control_job_id is null or p_call_id is null
    or p_route_fingerprint is null or p_route_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reserved_tokens is null or p_reserved_tokens not between 1 and 100000
    or p_interval_remaining_percent is null or p_interval_remaining_percent not between 0 and 1000
    or p_weekly_remaining_percent is null or p_weekly_remaining_percent not between 0 and 1000
    or p_interval_status is null or p_weekly_status is null
    or p_interval_reset_at is null or p_weekly_reset_at is null or p_quota_observed_at is null then
    return jsonb_build_object('allowed',false,'reason','invalid-reservation');
  end if;
  if p_interval_status<>1 or p_weekly_status<>1
    or p_interval_remaining_percent<50 or p_weekly_remaining_percent<50 then
    return jsonb_build_object('allowed',false,'reason','quota-insufficient');
  end if;
  if p_quota_observed_at<pg_catalog.clock_timestamp()-interval '30 seconds'
    or p_quota_observed_at>pg_catalog.clock_timestamp()+interval '5 seconds'
    or p_interval_reset_at<=pg_catalog.clock_timestamp()
    or p_weekly_reset_at<=pg_catalog.clock_timestamp()
    or p_interval_reset_at>pg_catalog.clock_timestamp()+interval '8 days'
    or p_weekly_reset_at>pg_catalog.clock_timestamp()+interval '8 days' then
    return jsonb_build_object('allowed',false,'reason','quota-stale');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job:' || p_control_job_id,0));
  select * into v_job from public.jobs where id=p_control_job_id for update;
  if not found or v_job.mission_id is distinct from p_mission_id
    or v_job.type is distinct from 'campaign' or v_job.generation is distinct from 1
    or v_job.idempotency_key not like 'workflow-control:%'
    or v_job.status not in ('queued','running','waiting') then
    return jsonb_build_object('allowed',false,'reason','control-inactive');
  end if;
  select * into v_budget from public.evolution_lab_subscription_budgets where mission_id=p_mission_id for update;
  if not found then return jsonb_build_object('allowed',false,'reason','budget-not-enrolled'); end if;
  if v_budget.control_job_id is distinct from p_control_job_id
    or v_budget.status is distinct from 'active'
    or v_budget.deadline<=pg_catalog.clock_timestamp() then
    return jsonb_build_object('allowed',false,'reason','budget-inactive');
  end if;
  if exists(select 1 from public.evolution_lab_subscription_calls where call_id=p_call_id) then
    return jsonb_build_object('allowed',false,'reason','call-id-already-used');
  end if;
  if exists(select 1 from public.evolution_lab_subscription_calls
      where mission_id=p_mission_id and status='reserved') then
    return jsonb_build_object('allowed',false,'reason','unsettled-attempt');
  end if;
  if p_interval_remaining_percent<v_budget.min_interval_remaining_percent
    or p_weekly_remaining_percent<v_budget.min_weekly_remaining_percent then
    return jsonb_build_object('allowed',false,'reason','quota-insufficient');
  end if;
  if v_budget.calls_used>=v_budget.max_calls
    or v_budget.held_tokens+v_budget.spent_tokens+p_reserved_tokens>v_budget.max_tokens then
    return jsonb_build_object('allowed',false,'reason','budget-exhausted');
  end if;
  insert into public.evolution_lab_subscription_calls(
    call_id,mission_id,control_job_id,route_fingerprint,reserved_tokens,
    interval_remaining_percent,weekly_remaining_percent,interval_status,weekly_status,
    interval_reset_at,weekly_reset_at,quota_observed_at
  ) values (
    p_call_id,p_mission_id,p_control_job_id,p_route_fingerprint,p_reserved_tokens,
    p_interval_remaining_percent,p_weekly_remaining_percent,p_interval_status,p_weekly_status,
    p_interval_reset_at,p_weekly_reset_at,p_quota_observed_at
  );
  update public.evolution_lab_subscription_budgets
    set calls_used=calls_used+1,held_tokens=held_tokens+p_reserved_tokens,
        updated_at=pg_catalog.clock_timestamp() where mission_id=p_mission_id;
  return jsonb_build_object('allowed',true,'reason','reserved');
end;
$$;

create or replace function public.settle_evolution_lab_subscription_call(
  p_mission_id text,p_control_job_id text,p_call_id uuid,p_measured_tokens bigint default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_budget public.evolution_lab_subscription_budgets%rowtype;
  v_call public.evolution_lab_subscription_calls%rowtype; v_status text;
begin
  if p_measured_tokens is not null and p_measured_tokens not between 0 and 10000000 then
    return jsonb_build_object('allowed',false,'reason','invalid-usage');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job:' || p_control_job_id,0));
  select * into v_budget from public.evolution_lab_subscription_budgets where mission_id=p_mission_id for update;
  if not found or v_budget.control_job_id is distinct from p_control_job_id then
    return jsonb_build_object('allowed',false,'reason','budget-not-found');
  end if;
  select * into v_call from public.evolution_lab_subscription_calls
    where call_id=p_call_id and mission_id=p_mission_id and control_job_id=p_control_job_id for update;
  if not found or v_call.status is distinct from 'reserved' then
    return jsonb_build_object('allowed',false,'reason','call-not-reserved');
  end if;
  if p_measured_tokens is null then
    update public.evolution_lab_subscription_calls set status='unknown',settled_at=pg_catalog.clock_timestamp()
      where call_id=p_call_id;
    update public.evolution_lab_subscription_budgets set
      status=case when status='active' then 'paused' else status end,
      updated_at=pg_catalog.clock_timestamp() where mission_id=p_mission_id;
    return jsonb_build_object('allowed',true,'reason','usage-unknown-paused');
  end if;
  update public.evolution_lab_subscription_calls set status='settled',
    measured_tokens=p_measured_tokens,settled_at=pg_catalog.clock_timestamp() where call_id=p_call_id;
  v_status:=case
    when v_budget.status='cancelled' then 'cancelled'
    when p_measured_tokens>v_call.reserved_tokens
      or v_budget.spent_tokens+p_measured_tokens+v_budget.held_tokens-v_call.reserved_tokens>v_budget.max_tokens
      then 'overspent'
    else v_budget.status end;
  update public.evolution_lab_subscription_budgets set
    held_tokens=held_tokens-v_call.reserved_tokens,
    spent_tokens=spent_tokens+p_measured_tokens,
    status=v_status,updated_at=pg_catalog.clock_timestamp()
    where mission_id=p_mission_id;
  return jsonb_build_object('allowed',true,'reason',case when v_status='overspent' then 'overspent' else 'settled' end);
end;
$$;

create or replace function public.cancel_evolution_lab_subscription_budget(
  p_mission_id text,p_control_job_id text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_budget public.evolution_lab_subscription_budgets%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job:' || p_control_job_id,0));
  select * into v_budget from public.evolution_lab_subscription_budgets where mission_id=p_mission_id for update;
  if not found or v_budget.control_job_id is distinct from p_control_job_id then
    return jsonb_build_object('allowed',false,'reason','budget-not-found');
  end if;
  update public.evolution_lab_subscription_budgets set status='cancelled',
    updated_at=pg_catalog.clock_timestamp() where mission_id=p_mission_id;
  return jsonb_build_object('allowed',true,'reason','cancelled');
end;
$$;

revoke execute on function public.initialize_evolution_lab_subscription_budget(text,text,integer,bigint,timestamptz,numeric,numeric) from public,anon,authenticated;
revoke execute on function public.reserve_evolution_lab_subscription_call(text,text,uuid,text,bigint,numeric,numeric,integer,integer,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
revoke execute on function public.settle_evolution_lab_subscription_call(text,text,uuid,bigint) from public,anon,authenticated;
revoke execute on function public.cancel_evolution_lab_subscription_budget(text,text) from public,anon,authenticated;
grant execute on function public.initialize_evolution_lab_subscription_budget(text,text,integer,bigint,timestamptz,numeric,numeric) to service_role;
grant execute on function public.reserve_evolution_lab_subscription_call(text,text,uuid,text,bigint,numeric,numeric,integer,integer,timestamptz,timestamptz,timestamptz) to service_role;
grant execute on function public.settle_evolution_lab_subscription_call(text,text,uuid,bigint) to service_role;
grant execute on function public.cancel_evolution_lab_subscription_budget(text,text) to service_role;
