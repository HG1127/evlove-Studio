-- Evolution OS · trusted Organization Member Directory
-- Signed actor assertions establish identity; this table establishes current membership,
-- role, and suspension/revocation state. Service-role only.

create table if not exists public.evolution_workspace_members (
  workspace_id text not null,
  actor_id text not null,
  role text not null check (role in ('viewer','operator','approver','admin','service')),
  status text not null default 'active' check (status in ('active','suspended')),
  display_name text,
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  suspended_at timestamptz,
  primary key (workspace_id,actor_id)
);

create index if not exists evolution_workspace_members_status_idx
  on public.evolution_workspace_members(workspace_id,status,role,updated_at desc);

alter table public.evolution_workspace_members enable row level security;
revoke all on public.evolution_workspace_members from public, anon, authenticated;
grant select,insert,update on public.evolution_workspace_members to service_role;

comment on table public.evolution_workspace_members is
  'Server-only current member/role/suspension directory. High-risk API actions must match an active row.';
