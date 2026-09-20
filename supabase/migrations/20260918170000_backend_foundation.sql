-- Evolution OS V1 · P0-1 backend foundation
-- Auth/RBAC is intentionally deferred for the current internal MVP.
-- Before public multi-user exposure, enable RLS and replace the temporary anon grants/policies.

create table if not exists public.missions (
  id text primary key,
  schema_version text not null default 'mission-v1',
  revision bigint not null default 0,
  stage text not null,
  status text not null default 'idle',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.bump_mission_revision()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists missions_revision_trigger on public.missions;
create trigger missions_revision_trigger
before update on public.missions
for each row execute function public.bump_mission_revision();

create index if not exists missions_updated_at_idx on public.missions(updated_at desc);
create index if not exists missions_stage_idx on public.missions(stage);

create table if not exists public.jobs (
  id text primary key,
  mission_id text,
  schema_version text not null default 'job-v1',
  type text not null,
  status text not null,
  label text not null,
  idempotency_key text not null,
  generation integer not null default 0,
  attempts integer not null default 0,
  priority integer not null default 50,
  checkpoint_id text,
  input_ref text,
  output_ref text,
  progress jsonb,
  error text,
  created_at timestamptz not null,
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null
);

create unique index if not exists jobs_idempotency_key_idx on public.jobs(idempotency_key);
create index if not exists jobs_mission_updated_idx on public.jobs(mission_id, updated_at desc);
create index if not exists jobs_status_updated_idx on public.jobs(status, updated_at desc);

create table if not exists public.events (
  id text primary key,
  mission_id text,
  schema_version text not null default 'event-v1',
  type text not null,
  source text not null,
  job_id text,
  checkpoint_id text,
  causation_id text,
  correlation_id text,
  payload jsonb not null default '{}'::jsonb,
  at timestamptz not null
);

create index if not exists events_mission_at_idx on public.events(mission_id, at desc);
create index if not exists events_job_at_idx on public.events(job_id, at desc);
create index if not exists events_type_at_idx on public.events(type, at desc);

create table if not exists public.artifacts (
  id text primary key,
  schema_version text not null default 'artifact-v1',
  mission_id text,
  bucket text not null default 'evolution-artifacts',
  object_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artifacts_mission_idx on public.artifacts(mission_id);
create index if not exists artifacts_sha256_idx on public.artifacts(sha256);

insert into storage.buckets (id, name, public, file_size_limit)
values ('evolution-artifacts', 'evolution-artifacts', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- Temporary auth-free internal MVP access.
alter table public.missions disable row level security;
alter table public.jobs disable row level security;
alter table public.events disable row level security;
alter table public.artifacts disable row level security;

grant select, insert, update, delete on public.missions to anon;
grant select, insert, update, delete on public.jobs to anon;
grant select, insert, update, delete on public.events to anon;
grant select, insert, update, delete on public.artifacts to anon;

drop policy if exists evolution_artifacts_anon_select on storage.objects;
create policy evolution_artifacts_anon_select on storage.objects
for select to anon using (bucket_id = 'evolution-artifacts');

drop policy if exists evolution_artifacts_anon_insert on storage.objects;
create policy evolution_artifacts_anon_insert on storage.objects
for insert to anon with check (bucket_id = 'evolution-artifacts');

drop policy if exists evolution_artifacts_anon_update on storage.objects;
create policy evolution_artifacts_anon_update on storage.objects
for update to anon using (bucket_id = 'evolution-artifacts') with check (bucket_id = 'evolution-artifacts');

drop policy if exists evolution_artifacts_anon_delete on storage.objects;
create policy evolution_artifacts_anon_delete on storage.objects
for delete to anon using (bucket_id = 'evolution-artifacts');

comment on table public.missions is 'Evolution OS Mission envelopes. Complex state remains versioned JSONB in V1.';
comment on table public.jobs is 'Unified EvolutionJob durable metadata.';
comment on table public.events is 'Append-only EvolutionEvent ledger for mission/job/action/checkpoint state changes.';
comment on table public.artifacts is 'Artifact metadata; binary bytes live in Supabase Storage.';
