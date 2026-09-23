-- Evolution OS · Durable Workflow run binding + final production security invariants
-- A Workflow run id is bound to the exact Job generation without changing Job state,
-- so a fast queued->running transition cannot lose the control-plane cancellation handle.

create or replace function public.bind_evolution_job_workflow_run(
  p_id text,
  p_expected_generation integer,
  p_run_id text,
  p_binding text,
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
  if p_expected_generation < 0 then
    raise exception 'expected Job generation must be non-negative';
  end if;
  if nullif(trim(p_run_id),'') is null then
    raise exception 'Workflow run id is required';
  end if;
  if p_binding not in ('metadata','output-ref') then
    raise exception 'Unsupported Workflow run binding: %',p_binding;
  end if;

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

  if p_binding='metadata' then
    update public.jobs
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('runId',p_run_id),
        updated_at=greatest(updated_at,p_at)
    where id=p_id
    returning * into v_saved;
  else
    update public.jobs
    set output_ref=p_run_id,
        updated_at=greatest(updated_at,p_at)
    where id=p_id
    returning * into v_saved;
  end if;

  return query select true,'bound',to_jsonb(v_saved);
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
returns trigger language plpgsql as $$
begin
  raise exception 'events is append-only; UPDATE/DELETE are forbidden';
end;
$$;
drop trigger if exists evolution_events_immutable_trigger on public.events;
create trigger evolution_events_immutable_trigger
before update or delete on public.events
for each row execute function public.prevent_evolution_event_mutation();

revoke execute on function public.bind_evolution_job_workflow_run(text,integer,text,text,timestamptz) from public, anon, authenticated;
revoke execute on function public.put_evolution_job_monotonic(jsonb) from public, anon, authenticated;
revoke execute on function public.cancel_evolution_job_generation(text,integer,timestamptz) from public, anon, authenticated;
revoke execute on function public.compare_and_swap_mission(text,bigint,text,text,text,jsonb,timestamptz,timestamptz) from public, anon, authenticated;
revoke execute on function public.delete_mission_if_revision(text,bigint) from public, anon, authenticated;
revoke execute on function public.append_evidence_ledger(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text) from public, anon, authenticated;
revoke execute on function public.evidence_ledger_health() from public, anon, authenticated;
revoke execute on function public.match_organization_capabilities(text,extensions.vector,integer,boolean,text[],text,text) from public, anon, authenticated;

grant execute on function public.bind_evolution_job_workflow_run(text,integer,text,text,timestamptz) to service_role;
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

comment on function public.bind_evolution_job_workflow_run(text,integer,text,text,timestamptz) is
  'Binds a Vercel Workflow run id to an exact EvolutionJob generation without changing Job state.';
