-- Evolution OS · final production security invariants
-- Keep this migration at the tail of the migration set whenever new server-side
-- tables/RPCs are introduced. Browser access goes through authenticated Nitro APIs.

-- Future objects created by the migration owner must not silently inherit public/client access.
alter default privileges in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- Every Evolution OS production table is server-only.
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

-- Reset prior service-role grants before applying today's least-privilege set.
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

-- Re-grant only the operations used by server-side services.
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

-- EvolutionEvent is the authoritative append-only state-change log.
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

revoke execute on function public.prevent_evolution_event_mutation()
  from public, anon, authenticated;

-- SECURITY DEFINER RPCs are not public APIs. PostgreSQL grants EXECUTE to PUBLIC
-- on functions by default, so PUBLIC must be revoked explicitly in addition to
-- Supabase's anon/authenticated roles.
revoke execute on function public.append_evidence_ledger(
  text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text
) from public, anon, authenticated;
revoke execute on function public.evidence_ledger_health()
  from public, anon, authenticated;
revoke execute on function public.match_organization_capabilities(
  text,extensions.vector,integer,boolean,text[],text,text
) from public, anon, authenticated;

grant execute on function public.append_evidence_ledger(
  text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text
) to service_role;
grant execute on function public.evidence_ledger_health() to service_role;
grant execute on function public.match_organization_capabilities(
  text,extensions.vector,integer,boolean,text[],text,text
) to service_role;

-- Trigger functions are implementation details and never callable application RPCs.
revoke execute on function public.bump_mission_revision() from public, anon, authenticated;
revoke execute on function public.prevent_evidence_ledger_mutation() from public, anon, authenticated;
revoke execute on function public.prevent_evolution_event_mutation() from public, anon, authenticated;

-- Artifact Storage remains private and server mediated.
update storage.buckets
set public=false
where id='evolution-artifacts';

drop policy if exists evolution_artifacts_anon_select on storage.objects;
drop policy if exists evolution_artifacts_anon_insert on storage.objects;
drop policy if exists evolution_artifacts_anon_update on storage.objects;
drop policy if exists evolution_artifacts_anon_delete on storage.objects;
revoke all privileges on table storage.objects from public, anon, authenticated;

comment on table public.missions is
  'Evolution OS Mission envelopes. Production access is server-only through authenticated APIs.';
comment on table public.evidence_ledger is
  'Immutable server-only evidence ledger. PUBLIC/anon/authenticated direct access and RPC execution are revoked.';
