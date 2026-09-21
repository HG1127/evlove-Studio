-- Evolution OS · Organization Capability Registry
-- Cross-Mission Lesson / Verified Skill / Anti-pattern registry for the current internal MVP.
-- Vector embeddings are deliberately NOT faked here; matching starts with deterministic server-side fuzzy/lexical ranking.

create table if not exists public.organization_capabilities (
  id text primary key,
  workspace_id text not null,
  capability_key text not null,
  source_mission_id text not null,
  lesson_id text not null,
  lesson_status text not null,
  governance_status text,
  reusable boolean not null default false,
  title text not null,
  summary text not null,
  search_text text not null,
  embedding jsonb,
  embedding_model text,
  payload jsonb not null,
  replication_evidence jsonb not null default '[]'::jsonb,
  counter_examples jsonb not null default '[]'::jsonb,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, source_mission_id, lesson_id)
);

alter table public.organization_capabilities add column if not exists embedding jsonb;
alter table public.organization_capabilities add column if not exists embedding_model text;

create index if not exists organization_capabilities_workspace_updated_idx
  on public.organization_capabilities(workspace_id, updated_at desc);
create index if not exists organization_capabilities_workspace_key_idx
  on public.organization_capabilities(workspace_id, capability_key);
create index if not exists organization_capabilities_mission_idx
  on public.organization_capabilities(workspace_id, source_mission_id);
create index if not exists organization_capabilities_status_idx
  on public.organization_capabilities(workspace_id, lesson_status, governance_status, archived);

-- Temporary internal-MVP access, consistent with the existing backend foundation.
-- Public multi-user exposure must move this table behind authenticated RLS/RBAC.
alter table public.organization_capabilities disable row level security;
grant select, insert, update, delete on public.organization_capabilities to anon;

comment on table public.organization_capabilities is
  'Organization-level capability registry. Each Mission lesson remains independently auditable; capability_key groups cross-Mission replications.';
comment on column public.organization_capabilities.capability_key is
  'Deterministic fingerprint of title/trigger/method for cross-Mission replication grouping; not an embedding.';
