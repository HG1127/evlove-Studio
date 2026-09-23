-- Evolution OS · Mission revision CAS + final production security invariants
-- Mission writes/deletes use server-side compare-and-swap so stale browsers or
-- concurrent durable workers cannot overwrite a newer Mission state.

create or replace function public.compare_and_swap_mission(
  p_id text,
  p_expected_revision bigint,
  p_schema_version text,
  p_stage text,
  p_status text,
  p_payload jsonb,
  p_created_at timestamptz,
  p_updated_at timestamptz
)
returns table(applied boolean,current_revision bigint,mission jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.missions%rowtype;
  v_saved public.missions%rowtype;
begin
  if p_expected_revision < 0 then
    raise exception 'expected Mission revision must be non-negative';
  end if;
  if p_payload->>'id' is distinct from p_id then
    raise exception 'Mission payload id must match p_id';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mission:' || p_id, 0));
  select * into v_current
  from public.missions
  where id = p_id
  for update;

  if not found then
    if p_expected_revision <> 0 then
      return query select false, null::bigint, null::jsonb;
      return;
    end if;
    insert into public.missions(
      id,schema_version,revision,stage,status,payload,created_at,updated_at
    )
    values(
      p_id,p_schema_version,0,p_stage,p_status,p_payload,p_created_at,p_updated_at
    )
    returning * into v_saved;
    return query select true,v_saved.revision,to_jsonb(v_saved);
    return;
  end if;

  if v_current.revision <> p_expected_revision then
    return query select false,v_current.revision,to_jsonb(v_current);
    return;
  end if;

  update public.missions
  set schema_version=p_schema_version,
      stage=p_stage,
      status=p_status,
      payload=p_payload,
      updated_at=p_updated_at
  where id=p_id
  returning * into v_saved;

  return query select true,v_saved.revision,to_jsonb(v_saved);
end;
$$;

create or replace function public.delete_mission_if_revision(
  p_id text,
  p_expected_revision bigint
)
returns table(applied boolean,current_revision bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.missions%rowtype;
begin
  if p_expected_revision < 0 then
    raise exception 'expected Mission revision must be non-negative';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mission:' || p_id, 0));
  select * into v_current
  from public.missions
  where id = p_id
  for update;

  if not found then
    return query select true, null::bigint;
    return;
  end if;

  if v_current.revision <> p_expected_revision then
    return query select false,v_current.revision;
    return;
  end if;

  delete from public.missions where id=p_id;
  return query select true,v_current.revision;
end;
$$;

-- Final production security invariants. Keep this migration at the tail.
alter default privileges in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

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

grant select, insert, update, delete on table public.missions to service_role;
grant select, insert, update, delete on table public.jobs to service_role;
grant select, insert on table public.events to service_role;
grant select, insert, update, delete on table public.artifacts to service_role;
grant select, insert, update, delete on table public.organization_capabilities to service_role;
grant select on table public.evidence_ledger to service_role;
grant select, insert, update, delete on table public.release_approval_grants to service_role;
grant select, insert, delete on table public.outcome_metric_samples to service_role;
grant select, insert, update, delete on table public.evolution_vault_secrets to service_role;
grant select, insert, update on table public.evolution_workspace_members to service_role;

create or replace function public.prevent_evolution_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'events is append-only; UPDATE/DELETE are forbidden';
end;
$$;

drop trigger if exists evolution_events_immutable_trigger on public.events;
create trigger evolution_events_immutable_trigger
before update or delete on public.events
for each row execute function public.prevent_evolution_event_mutation();

revoke execute on function public.compare_and_swap_mission(
  text,bigint,text,text,text,jsonb,timestamptz,timestamptz
) from public, anon, authenticated;
revoke execute on function public.delete_mission_if_revision(text,bigint)
  from public, anon, authenticated;
revoke execute on function public.append_evidence_ledger(
  text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text
) from public, anon, authenticated;
revoke execute on function public.evidence_ledger_health()
  from public, anon, authenticated;
revoke execute on function public.match_organization_capabilities(
  text,extensions.vector,integer,boolean,text[],text,text
) from public, anon, authenticated;

grant execute on function public.compare_and_swap_mission(
  text,bigint,text,text,text,jsonb,timestamptz,timestamptz
) to service_role;
grant execute on function public.delete_mission_if_revision(text,bigint)
  to service_role;
grant execute on function public.append_evidence_ledger(
  text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text
) to service_role;
grant execute on function public.evidence_ledger_health() to service_role;
grant execute on function public.match_organization_capabilities(
  text,extensions.vector,integer,boolean,text[],text,text
) to service_role;

revoke execute on function public.bump_mission_revision() from public, anon, authenticated;
revoke execute on function public.prevent_evidence_ledger_mutation() from public, anon, authenticated;
revoke execute on function public.prevent_evolution_event_mutation() from public, anon, authenticated;

update storage.buckets
set public=false
where id='evolution-artifacts';

drop policy if exists evolution_artifacts_anon_select on storage.objects;
drop policy if exists evolution_artifacts_anon_insert on storage.objects;
drop policy if exists evolution_artifacts_anon_update on storage.objects;
drop policy if exists evolution_artifacts_anon_delete on storage.objects;
revoke all privileges on table storage.objects from public, anon, authenticated;

comment on table public.missions is
  'Evolution OS Mission envelopes. All writes/deletes use revision compare-and-swap; production access is server-only.';
comment on table public.evidence_ledger is
  'Immutable server-only evidence ledger. PUBLIC/anon/authenticated direct access and RPC execution are revoked.';
