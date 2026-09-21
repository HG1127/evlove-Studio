-- Evolution OS · server-only data plane hardening.
-- Production browsers use /api/evolution; direct anon CRUD/RPC/storage access is retired.

alter table public.missions enable row level security;
alter table public.jobs enable row level security;
alter table public.events enable row level security;
alter table public.artifacts enable row level security;
alter table public.organization_capabilities enable row level security;
alter table public.evidence_ledger enable row level security;

revoke all on public.missions from anon, authenticated;
revoke all on public.jobs from anon, authenticated;
revoke all on public.events from anon, authenticated;
revoke all on public.artifacts from anon, authenticated;
revoke all on public.organization_capabilities from anon, authenticated;
revoke all on public.evidence_ledger from anon, authenticated;

grant select, insert, update, delete on public.missions to service_role;
grant select, insert, update, delete on public.jobs to service_role;
grant select, insert, update, delete on public.events to service_role;
grant select, insert, update, delete on public.artifacts to service_role;
grant select, insert, update, delete on public.organization_capabilities to service_role;
grant select on public.evidence_ledger to service_role;

revoke execute on function public.append_evidence_ledger(
  text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text
) from anon, authenticated;
revoke execute on function public.evidence_ledger_health() from anon, authenticated;
grant execute on function public.append_evidence_ledger(
  text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text
) to service_role;
grant execute on function public.evidence_ledger_health() to service_role;

drop policy if exists evolution_artifacts_anon_select on storage.objects;
drop policy if exists evolution_artifacts_anon_insert on storage.objects;
drop policy if exists evolution_artifacts_anon_update on storage.objects;
drop policy if exists evolution_artifacts_anon_delete on storage.objects;
revoke all on storage.objects from anon, authenticated;

comment on table public.missions is
  'Evolution OS Mission envelopes. Production access is server-only; browsers use /api/evolution.';
comment on table public.evidence_ledger is
  'Immutable server-only evidence ledger. Direct anon access is revoked.';
