-- Evolution OS · Artifact identity and retention enforcement.
-- The adapter writes new blobs to content-addressed paths before metadata registration.

create or replace function public.enforce_evolution_artifact_identity()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.mission_id is not null then
      raise exception 'ARTIFACT_MISSION_BOUND';
    end if;
    if exists(
      select 1 from public.evidence_ledger
      where artifact_refs @> jsonb_build_array(old.id)
    ) then
      raise exception 'ARTIFACT_EVIDENCE_REFERENCED';
    end if;
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
before update or delete on public.artifacts
for each row execute function public.enforce_evolution_artifact_identity();

create index if not exists evidence_ledger_artifact_refs_gin_idx
on public.evidence_ledger using gin (artifact_refs jsonb_path_ops);

revoke execute on function public.enforce_evolution_artifact_identity() from public, anon, authenticated;

-- Final production security invariants.
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
