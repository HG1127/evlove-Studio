-- Evolution OS · durable job metadata
-- Parse and other resumable jobs require typed context (session/artifact/name/role)
-- to survive page refreshes and server restarts.

alter table public.jobs
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.jobs.metadata is
  'Durable non-secret job context used for recovery/idempotency. Never store API keys or credentials here.';
