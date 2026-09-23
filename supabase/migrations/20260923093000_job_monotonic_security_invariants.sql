-- Evolution OS · Job monotonic state + final production security invariants
-- Job generations are execution identities. Within one generation, terminal
-- states cannot regress and running/waiting cannot be overwritten by queued.

create or replace function public.put_evolution_job_monotonic(p_job jsonb)
returns table(applied boolean,reason text,job jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := nullif(p_job->>'id','');
  v_generation integer := coalesce((p_job->>'generation')::integer,0);
  v_status text := p_job->>'status';
  v_updated_at timestamptz := (p_job->>'updatedAt')::timestamptz;
  v_current public.jobs%rowtype;
  v_saved public.jobs%rowtype;
begin
  if v_id is null then raise exception 'Job id is required'; end if;
  if v_generation < 0 then raise exception 'Job generation must be non-negative'; end if;
  if v_status not in ('queued','running','waiting','completed','partial','failed','cancelled') then
    raise exception 'Invalid Job status: %',v_status;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('job:' || v_id, 0));
  select * into v_current from public.jobs where id=v_id for update;

  if not found then
    begin
      insert into public.jobs(
        id,mission_id,schema_version,type,status,label,idempotency_key,generation,attempts,priority,
        checkpoint_id,input_ref,output_ref,metadata,progress,error,created_at,started_at,heartbeat_at,finished_at,updated_at
      ) values (
        v_id,nullif(p_job->>'missionId',''),p_job->>'schemaVersion',p_job->>'type',v_status,p_job->>'label',
        p_job->>'idempotencyKey',v_generation,coalesce((p_job->>'attempts')::integer,0),
        coalesce((p_job->>'priority')::integer,50),nullif(p_job->>'checkpointId',''),
        nullif(p_job->>'inputRef',''),nullif(p_job->>'outputRef',''),coalesce(p_job->'metadata','{}'::jsonb),
        p_job->'progress',nullif(p_job->>'error',''),(p_job->>'createdAt')::timestamptz,
        nullif(p_job->>'startedAt','')::timestamptz,nullif(p_job->>'heartbeatAt','')::timestamptz,
        nullif(p_job->>'finishedAt','')::timestamptz,v_updated_at
      ) returning * into v_saved;
      return query select true,'inserted',to_jsonb(v_saved);
      return;
    exception when unique_violation then
      select * into v_current from public.jobs
      where idempotency_key=p_job->>'idempotencyKey'
      order by updated_at desc limit 1;
      return query select false,'idempotency-conflict',
        case when found then to_jsonb(v_current) else null::jsonb end;
      return;
    end;
  end if;

  if v_generation < v_current.generation then
    return query select false,'older-generation',to_jsonb(v_current);
    return;
  end if;

  if v_generation = v_current.generation then
    if v_current.status in ('completed','partial','failed','cancelled') then
      if v_status = v_current.status then
        return query select true,'terminal-idempotent',to_jsonb(v_current);
      end if;
      return query select false,'terminal-immutable',to_jsonb(v_current);
      return;
    end if;
    if v_current.status in ('running','waiting') and v_status='queued' then
      return query select false,'state-regression',to_jsonb(v_current);
      return;
    end if;
    if v_updated_at < v_current.updated_at then
      return query select false,'older-update',to_jsonb(v_current);
      return;
    end if;
  end if;

  update public.jobs set
    mission_id=nullif(p_job->>'missionId',''),
    schema_version=p_job->>'schemaVersion',
    type=p_job->>'type',
    status=v_status,
    label=p_job->>'label',
    idempotency_key=p_job->>'idempotencyKey',
    generation=v_generation,
    attempts=coalesce((p_job->>'attempts')::integer,0),
    priority=coalesce((p_job->>'priority')::integer,50),
    checkpoint_id=nullif(p_job->>'checkpointId',''),
    input_ref=nullif(p_job->>'inputRef',''),
    output_ref=nullif(p_job->>'outputRef',''),
    metadata=coalesce(p_job->'metadata','{}'::jsonb),
    progress=p_job->'progress',
    error=nullif(p_job->>'error',''),
    started_at=nullif(p_job->>'startedAt','')::timestamptz,
    heartbeat_at=nullif(p_job->>'heartbeatAt','')::timestamptz,
    finished_at=nullif(p_job->>'finishedAt','')::timestamptz,
    updated_at=v_updated_at
  where id=v_id
  returning * into v_saved;

  return query select true,'updated',to_jsonb(v_saved);
end;
$$;

create or replace function public.cancel_evolution_job_generation(
  p_id text,
  p_expected_generation integer,
  p_at timestamptz
)
returns table(applied boolean,reason text,job jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.jobs%rowtype;
  v_saved public.jobs%rowtype;
begin
  if p_expected_generation < 0 then raise exception 'expected Job generation must be non-negative'; end if;
  perform pg_advisory_xact_lock(hashtextextended('job:' || p_id, 0));
  select * into v_current from public.jobs where id=p_id for update;

  if not found then
    return query select false,'missing',null::jsonb;
    return;
  end if;
  if v_current.generation <> p_expected_generation then
    return query select false,'generation-conflict',to_jsonb(v_current);
    return;
  end if;
  if v_current.status in ('completed','partial','failed','cancelled') then
    return query select false,'already-terminal',to_jsonb(v_current);
    return;
  end if;

  update public.jobs
  set status='cancelled',finished_at=p_at,updated_at=p_at
  where id=p_id
  returning * into v_saved;
  return query select true,'cancelled',to_jsonb(v_saved);
end;
$$;

-- Mission CAS functions remain the durable Mission write boundary.
create or replace function public.compare_and_swap_mission(
  p_id text,p_expected_revision bigint,p_schema_version text,p_stage text,p_status text,
  p_payload jsonb,p_created_at timestamptz,p_updated_at timestamptz
)
returns table(applied boolean,current_revision bigint,mission jsonb)
language plpgsql security definer set search_path = public
as $$
declare v_current public.missions%rowtype; v_saved public.missions%rowtype;
begin
  if p_expected_revision < 0 then raise exception 'expected Mission revision must be non-negative'; end if;
  if p_payload->>'id' is distinct from p_id then raise exception 'Mission payload id must match p_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mission:' || p_id, 0));
  select * into v_current from public.missions where id=p_id for update;
  if not found then
    if p_expected_revision <> 0 then return query select false,null::bigint,null::jsonb; return; end if;
    insert into public.missions(id,schema_version,revision,stage,status,payload,created_at,updated_at)
    values(p_id,p_schema_version,0,p_stage,p_status,p_payload,p_created_at,p_updated_at)
    returning * into v_saved;
    return query select true,v_saved.revision,to_jsonb(v_saved); return;
  end if;
  if v_current.revision <> p_expected_revision then
    return query select false,v_current.revision,to_jsonb(v_current); return;
  end if;
  update public.missions set schema_version=p_schema_version,stage=p_stage,status=p_status,payload=p_payload,updated_at=p_updated_at
  where id=p_id returning * into v_saved;
  return query select true,v_saved.revision,to_jsonb(v_saved);
end;
$$;

create or replace function public.delete_mission_if_revision(p_id text,p_expected_revision bigint)
returns table(applied boolean,current_revision bigint)
language plpgsql security definer set search_path = public
as $$
declare v_current public.missions%rowtype;
begin
  if p_expected_revision < 0 then raise exception 'expected Mission revision must be non-negative'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mission:' || p_id, 0));
  select * into v_current from public.missions where id=p_id for update;
  if not found then return query select true,null::bigint; return; end if;
  if v_current.revision <> p_expected_revision then return query select false,v_current.revision; return; end if;
  delete from public.missions where id=p_id;
  return query select true,v_current.revision;
end;
$$;

-- Final production security invariants. Keep this migration at the tail.
alter default privileges in schema public revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

alter table public.missions enable row level security;
alter table public.jobs enable row level security;
alter table public.events enable row level security;
alter table public.artifacts enable row level security;
alter table public.organization_capabilities enable row level security;
alter table public.evidence_ledger enable row level security;
alter table public.release_approval_grants enable row level security;
alter table public.outcome_metric_samples enable row level security;
alter table public.evolution_vault_secrets enable row level security;
alter table public.evolution_workspace_members enable row level security;

revoke all privileges on table public.missions from public, anon, authenticated;
revoke all privileges on table public.jobs from public, anon, authenticated;
revoke all privileges on table public.events from public, anon, authenticated;
revoke all privileges on table public.artifacts from public, anon, authenticated;
revoke all privileges on table public.organization_capabilities from public, anon, authenticated;
revoke all privileges on table public.evidence_ledger from public, anon, authenticated;
revoke all privileges on table public.release_approval_grants from public, anon, authenticated;
revoke all privileges on table public.outcome_metric_samples from public, anon, authenticated;
revoke all privileges on table public.evolution_vault_secrets from public, anon, authenticated;
revoke all privileges on table public.evolution_workspace_members from public, anon, authenticated;

revoke all privileges on table public.missions from service_role;
revoke all privileges on table public.jobs from service_role;
revoke all privileges on table public.events from service_role;
revoke all privileges on table public.artifacts from service_role;
revoke all privileges on table public.organization_capabilities from service_role;
revoke all privileges on table public.evidence_ledger from service_role;
revoke all privileges on table public.release_approval_grants from service_role;
revoke all privileges on table public.outcome_metric_samples from service_role;
revoke all privileges on table public.evolution_vault_secrets from service_role;
revoke all privileges on table public.evolution_workspace_members from service_role;

grant select,insert,update,delete on table public.missions to service_role;
grant select,insert,update,delete on table public.jobs to service_role;
grant select, insert on table public.events to service_role;
grant select,insert,update,delete on table public.artifacts to service_role;
grant select,insert,update,delete on table public.organization_capabilities to service_role;
grant select on table public.evidence_ledger to service_role;
grant select,insert,update,delete on table public.release_approval_grants to service_role;
grant select,insert,delete on table public.outcome_metric_samples to service_role;
grant select,insert,update,delete on table public.evolution_vault_secrets to service_role;
grant select,insert,update on table public.evolution_workspace_members to service_role;

create or replace function public.prevent_evolution_event_mutation()
returns trigger language plpgsql as $$ begin raise exception 'events is append-only; UPDATE/DELETE are forbidden'; end; $$;
drop trigger if exists evolution_events_immutable_trigger on public.events;
create trigger evolution_events_immutable_trigger before update or delete on public.events
for each row execute function public.prevent_evolution_event_mutation();

revoke execute on function public.put_evolution_job_monotonic(jsonb) from public, anon, authenticated;
revoke execute on function public.cancel_evolution_job_generation(text,integer,timestamptz) from public, anon, authenticated;
revoke execute on function public.compare_and_swap_mission(text,bigint,text,text,text,jsonb,timestamptz,timestamptz) from public, anon, authenticated;
revoke execute on function public.delete_mission_if_revision(text,bigint) from public, anon, authenticated;
revoke execute on function public.append_evidence_ledger(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text) from public, anon, authenticated;
revoke execute on function public.evidence_ledger_health() from public, anon, authenticated;
revoke execute on function public.match_organization_capabilities(text,extensions.vector,integer,boolean,text[],text,text) from public, anon, authenticated;

grant execute on function public.put_evolution_job_monotonic(jsonb) to service_role;
grant execute on function public.cancel_evolution_job_generation(text,integer,timestamptz) to service_role;
grant execute on function public.compare_and_swap_mission(text,bigint,text,text,text,jsonb,timestamptz,timestamptz) to service_role;
grant execute on function public.delete_mission_if_revision(text,bigint) to service_role;
grant execute on function public.append_evidence_ledger(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text) to service_role;
grant execute on function public.evidence_ledger_health() to service_role;
grant execute on function public.match_organization_capabilities(text,extensions.vector,integer,boolean,text[],text,text) to service_role;

revoke execute on function public.bump_mission_revision() from public, anon, authenticated;
revoke execute on function public.prevent_evidence_ledger_mutation() from public, anon, authenticated;
revoke execute on function public.prevent_evolution_event_mutation() from public, anon, authenticated;

update storage.buckets set public=false where id='evolution-artifacts';
drop policy if exists evolution_artifacts_anon_select on storage.objects;
drop policy if exists evolution_artifacts_anon_insert on storage.objects;
drop policy if exists evolution_artifacts_anon_update on storage.objects;
drop policy if exists evolution_artifacts_anon_delete on storage.objects;
revoke all privileges on table storage.objects from public, anon, authenticated;

comment on table public.jobs is
  'Unified EvolutionJob metadata. Generation and terminal-state monotonicity are enforced by server-only RPCs.';
comment on table public.missions is
  'Evolution OS Mission envelopes. All writes/deletes use revision compare-and-swap; production access is server-only.';
comment on table public.evidence_ledger is
  'Immutable server-only evidence ledger. PUBLIC/anon/authenticated direct access and RPC execution are revoked.';
