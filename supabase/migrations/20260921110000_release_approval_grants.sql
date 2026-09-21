-- Evolution OS · durable release approval grants
-- Candidate-bound, expiring authorization records. No secrets are stored here.

create table if not exists public.release_approval_grants (
  id text primary key,
  workspace_id text not null,
  mission_id text not null,
  candidate_id text not null,
  scope text not null default 'release' check (scope='release'),
  approved_by text not null,
  approved_role text not null,
  approved_at timestamptz not null,
  expires_at timestamptz not null,
  note text,
  revoked_at timestamptz
);

create index if not exists release_approval_grants_active_idx
  on public.release_approval_grants(workspace_id,mission_id,candidate_id,expires_at desc)
  where revoked_at is null;

alter table public.release_approval_grants enable row level security;
revoke all on public.release_approval_grants from anon, authenticated;
grant select,insert,update,delete on public.release_approval_grants to service_role;

comment on table public.release_approval_grants is
  'Durable candidate-bound release approvals with expiry/revocation for separation of approval and execution.';
