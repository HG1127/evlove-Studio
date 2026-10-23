-- Guard browser-executable HTML Campaign startup against *different* idempotency keys.
-- No existing Mission/Job/Event/Artifact data is changed by this migration.
-- Requires the prior create_evolution_job_idempotent RPC and its fingerprint contract.
-- Both the active-job check and the new Job insertion happen under one per-Mission
-- transaction-scoped advisory lock; callers must use this RPC rather than the generic
-- Job creation endpoint for newly started HTML Campaigns.
create or replace function public.create_evolution_html_campaign_control(
  p_job jsonb,
  p_allow_single_waiting_retry boolean
)
returns table(applied boolean,reason text,job jsonb)
language plpgsql security definer set search_path = public
as $$
declare
  v_mission text := nullif(p_job->>'missionId','');
  v_key text := nullif(p_job->>'idempotencyKey','');
  v_id text := nullif(p_job->>'id','');
  v_prefix text;
  v_active_count bigint;
  v_active public.jobs%rowtype;
begin
  if v_mission is null or v_key is null or v_id is null
    or p_job->>'type' is distinct from 'campaign'
    or p_job->>'status' is distinct from 'queued' then
    raise exception 'Invalid HTML Campaign start identity or Job status';
  end if;
  v_prefix := 'workflow-control:'||v_mission||':';
  if left(v_key,length(v_prefix)) is distinct from v_prefix then
    raise exception 'HTML Campaign start requires a Mission-bound workflow-control key';
  end if;
  if coalesce(p_allow_single_waiting_retry,false)
    and left(v_key,length(v_prefix||'experiment-judge-retry:'))
      is distinct from v_prefix||'experiment-judge-retry:' then
    raise exception 'HTML Campaign waiting retry requires explicit recovery key';
  end if;

  -- Serialize new HTML starts for the *Mission*, not just an individual key.
  perform pg_advisory_xact_lock(hashtextextended('html-campaign-start:'||v_mission,0));
  perform 1 from public.missions where id=v_mission for key share;
  if not found then
    return query select false,'mission-missing',null::jsonb;
    return;
  end if;

  -- Same-key replay is checked first and delegated to the existing fingerprint
  -- comparison. A replay never creates a second Job, even when one is active.
  if exists(select 1 from public.jobs where idempotency_key=v_key) then
    return query select r.applied,r.reason,r.job
      from public.create_evolution_job_idempotent(p_job) as r;
    return;
  end if;

  -- Include legacy Campaign keys, not just workflow-control-prefixed receipts.
  select count(*) into v_active_count from public.jobs
    where mission_id=v_mission and type='campaign'
      and status in ('queued','running','waiting');
  if v_active_count > 0 then
    select * into v_active from public.jobs
      where mission_id=v_mission and type='campaign'
        and status in ('queued','running','waiting')
      order by updated_at desc,id desc limit 1;
    if not (
      coalesce(p_allow_single_waiting_retry,false)
      and v_active_count=1
      and v_active.status='waiting'
      and left(v_active.idempotency_key,length('workflow-control:'||v_mission||':'))
        = 'workflow-control:'||v_mission||':'
    ) then
      return query select false,'mission-active',to_jsonb(v_active);
      return;
    end if;
  end if;

  -- The guarded check and the Event-emitting insert share one transaction.
  return query select r.applied,r.reason,r.job
    from public.create_evolution_job_idempotent(p_job) as r;
end;
$$;
-- Final production security invariants.
alter default privileges in schema public revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

alter table public.missions enable row level security;
alter table public.jobs enable row level security;
alter table public.events enable row level security;
alter table public.artifacts enable row level security;
alter table public.artifact_retention_tombstones enable row level security;
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
revoke all privileges on table public.artifact_retention_tombstones from public, anon, authenticated;
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
revoke all privileges on table public.artifact_retention_tombstones from service_role;
revoke all privileges on table public.organization_capabilities from service_role;
revoke all privileges on table public.evidence_ledger from service_role;
revoke all privileges on table public.release_approval_grants from service_role;
revoke all privileges on table public.outcome_metric_samples from service_role;
revoke all privileges on table public.evolution_vault_secrets from service_role;
revoke all privileges on table public.evolution_workspace_members from service_role;

grant select, insert,update,delete on table public.missions to service_role;
grant select, insert,update,delete on table public.jobs to service_role;
grant select, insert on table public.events to service_role;
grant select, insert,update,delete on table public.artifacts to service_role;
grant select, insert,update,delete on table public.organization_capabilities to service_role;
grant select on table public.evidence_ledger to service_role;
grant select, insert,update,delete on table public.release_approval_grants to service_role;
grant select, insert,delete on table public.outcome_metric_samples to service_role;
grant select, insert,update,delete on table public.evolution_vault_secrets to service_role;
grant select, insert,update on table public.evolution_workspace_members to service_role;

create or replace function public.prevent_evolution_event_mutation()
returns trigger language plpgsql as $$ begin raise exception 'events is append-only; UPDATE/DELETE are forbidden'; end; $$;
drop trigger if exists evolution_events_immutable_trigger on public.events;
create trigger evolution_events_immutable_trigger before update or delete on public.events for each row execute function public.prevent_evolution_event_mutation();

revoke execute on function public.append_evidence_ledger(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text) from public, anon, authenticated;
revoke execute on function public.evidence_ledger_health() from public, anon, authenticated;
revoke execute on function public.match_organization_capabilities(text,extensions.vector,integer,boolean,text[],text,text) from public, anon, authenticated;
revoke execute on function public.bind_evolution_job_workflow_run(text,integer,text,text,timestamptz) from public, anon, authenticated;
revoke execute on function public.put_evolution_job_monotonic(jsonb) from public, anon, authenticated;
revoke execute on function public.put_evolution_job_with_event(jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public.cancel_evolution_job_generation(text,integer,timestamptz) from public, anon, authenticated;
revoke execute on function public.cancel_evolution_job_generation_with_event(text,integer,timestamptz) from public, anon, authenticated;
revoke execute on function public.compare_and_swap_mission(text,bigint,text,text,text,jsonb,timestamptz,timestamptz) from public, anon, authenticated;
revoke execute on function public.delete_mission_if_revision(text,bigint) from public, anon, authenticated;
revoke execute on function public.create_evolution_job_idempotent(jsonb) from public, anon, authenticated;
revoke execute on function public.create_evolution_html_campaign_control(jsonb,boolean) from public, anon, authenticated;
revoke execute on function public.transition_evolution_job_with_event(text,integer,jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public.compare_and_swap_mission_with_event(text,bigint,text,text,text,jsonb,timestamptz,timestamptz,jsonb) from public, anon, authenticated;

grant execute on function public.append_evidence_ledger(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text) to service_role;
grant execute on function public.evidence_ledger_health() to service_role;
grant execute on function public.match_organization_capabilities(text,extensions.vector,integer,boolean,text[],text,text) to service_role;
grant execute on function public.bind_evolution_job_workflow_run(text,integer,text,text,timestamptz) to service_role;
grant execute on function public.put_evolution_job_monotonic(jsonb) to service_role;
grant execute on function public.put_evolution_job_with_event(jsonb,jsonb) to service_role;
grant execute on function public.cancel_evolution_job_generation(text,integer,timestamptz) to service_role;
grant execute on function public.cancel_evolution_job_generation_with_event(text,integer,timestamptz) to service_role;
grant execute on function public.compare_and_swap_mission(text,bigint,text,text,text,jsonb,timestamptz,timestamptz) to service_role;
grant execute on function public.delete_mission_if_revision(text,bigint) to service_role;
grant execute on function public.create_evolution_job_idempotent(jsonb) to service_role;
grant execute on function public.create_evolution_html_campaign_control(jsonb,boolean) to service_role;
grant execute on function public.transition_evolution_job_with_event(text,integer,jsonb,jsonb) to service_role;
grant execute on function public.compare_and_swap_mission_with_event(text,bigint,text,text,text,jsonb,timestamptz,timestamptz,jsonb) to service_role;

-- Preserve trigger guard revocations from the earlier Artifact migration.
revoke execute on function public.enforce_evolution_artifact_identity() from public, anon, authenticated;
revoke execute on function public.lock_evolution_evidence_artifact_refs() from public, anon, authenticated;
revoke execute on function public.bump_mission_revision() from public, anon, authenticated;
revoke execute on function public.prevent_evidence_ledger_mutation() from public, anon, authenticated;
revoke execute on function public.prevent_evolution_event_mutation() from public, anon, authenticated;
update storage.buckets set public=false where id='evolution-artifacts';
drop policy if exists evolution_artifacts_anon_select on storage.objects;
drop policy if exists evolution_artifacts_anon_insert on storage.objects;
drop policy if exists evolution_artifacts_anon_update on storage.objects;
drop policy if exists evolution_artifacts_anon_delete on storage.objects;
revoke all privileges on table storage.objects from public, anon, authenticated;


-- Only the backend service credential can read tombstones and mark blob cleanup.
-- Artifact IDs and tombstone identity fields remain immutable to this role.
grant select, update (blob_deleted_at) on table public.artifact_retention_tombstones to service_role;

-- PostgREST must discover the new service-only RPC before the matching app code is deployed.
notify pgrst, 'reload schema';
