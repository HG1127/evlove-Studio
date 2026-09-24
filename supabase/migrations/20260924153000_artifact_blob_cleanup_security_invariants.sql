-- Preserve retired Artifact identities and record completed Storage deletion separately.
alter table public.artifact_retention_tombstones
  add column if not exists blob_deleted_at timestamptz;

create index if not exists artifact_retention_pending_blob_cleanup_idx
  on public.artifact_retention_tombstones (deleted_at, artifact_id)
  where blob_deleted_at is null;

-- Lock paths across delete/insert so a concurrent insert cannot pass the
-- tombstone check before the old Artifact row commits its deletion.
create or replace function public.enforce_evolution_artifact_identity()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('artifact-retention:' || new.id, 0));
    perform pg_advisory_xact_lock(hashtextextended('artifact-path:' || new.bucket || '/' || new.object_path, 0));
    if exists(select 1 from public.artifact_retention_tombstones where bucket = new.bucket and object_path = new.object_path) then
      raise exception 'ARTIFACT_PATH_RETIRED';
    end if;
    if exists(select 1 from public.artifact_retention_tombstones where artifact_id = new.id) then
      raise exception 'ARTIFACT_ID_RETIRED';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform pg_advisory_xact_lock(hashtextextended('artifact-retention:' || old.id, 0));
    perform pg_advisory_xact_lock(hashtextextended('artifact-path:' || old.bucket || '/' || old.object_path, 0));
    if old.mission_id is not null then
      raise exception 'ARTIFACT_MISSION_BOUND';
    end if;
    if exists(
      select 1 from public.evidence_ledger
      where artifact_refs @> jsonb_build_array(old.id)
    ) then
      raise exception 'ARTIFACT_EVIDENCE_REFERENCED';
    end if;
    insert into public.artifact_retention_tombstones(artifact_id, bucket, object_path, sha256)
    values(old.id, old.bucket, old.object_path, old.sha256);
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if (new.id,new.schema_version,new.bucket,new.object_path,new.mime_type,new.size_bytes,new.sha256,new.created_at)
      is distinct from
      (old.id,old.schema_version,old.bucket,old.object_path,old.mime_type,old.size_bytes,old.sha256,old.created_at) then
      raise exception 'ARTIFACT_IDENTITY_IMMUTABLE';
    end if;
    if old.mission_id is not null and new.mission_id is distinct from old.mission_id then
      raise exception 'ARTIFACT_MISSION_BINDING_IMMUTABLE';
    end if;
    if old.metadata ? 'jobId' and new.metadata->>'jobId' is distinct from old.metadata->>'jobId' then
      raise exception 'ARTIFACT_JOB_BINDING_IMMUTABLE';
    end if;
    if old.metadata ? 'kind' and new.metadata->>'kind' is distinct from old.metadata->>'kind' then
      raise exception 'ARTIFACT_KIND_IMMUTABLE';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists evolution_artifact_identity_trigger on public.artifacts;
create trigger evolution_artifact_identity_trigger
before insert or update or delete on public.artifacts
for each row execute function public.enforce_evolution_artifact_identity();

revoke execute on function public.enforce_evolution_artifact_identity() from public, anon, authenticated;
revoke execute on function public.lock_evolution_evidence_artifact_refs() from public, anon, authenticated;

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
grant execute on function public.transition_evolution_job_with_event(text,integer,jsonb,jsonb) to service_role;
grant execute on function public.compare_and_swap_mission_with_event(text,bigint,text,text,text,jsonb,timestamptz,timestamptz,jsonb) to service_role;

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
