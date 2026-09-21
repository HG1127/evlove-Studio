-- Evolution OS · encrypted Server Vault
-- Plaintext is never stored. Ciphertext is additionally protected by service_role-only RLS.

create table if not exists public.evolution_vault_secrets (
  workspace_id text not null,
  id text not null,
  name text not null,
  purpose text not null,
  scopes text[] not null default '{}'::text[],
  version integer not null check (version > 0),
  key_id text not null,
  algorithm text not null default 'aes-256-gcm' check (algorithm = 'aes-256-gcm'),
  ciphertext text not null,
  iv text not null,
  auth_tag text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id,id)
);

create index if not exists evolution_vault_secrets_updated_idx
  on public.evolution_vault_secrets(workspace_id,updated_at desc);

alter table public.evolution_vault_secrets enable row level security;
revoke all on public.evolution_vault_secrets from public, anon, authenticated;
grant select,insert,update,delete on public.evolution_vault_secrets to service_role;

comment on table public.evolution_vault_secrets is
  'Server-only AES-256-GCM ciphertext vault. Key material is external to PostgreSQL and supplied by server/KMS configuration.';
