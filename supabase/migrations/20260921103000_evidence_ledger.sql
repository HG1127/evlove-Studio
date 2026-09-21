-- Evolution OS · Immutable Evidence Ledger
-- Append-only, per-Mission SHA-256 hash chain with server-side HMAC content signatures.
-- Signing secrets remain server-only; the database stores only signature + key id.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.evidence_ledger (
  id text primary key,
  workspace_id text not null,
  mission_id text not null,
  sequence bigint not null,
  kind text not null,
  source text not null,
  actor text not null,
  event_id text,
  job_id text,
  checkpoint_id text,
  model_ref text,
  prompt_version text,
  test_version text,
  decision text,
  payload jsonb not null default '{}'::jsonb,
  artifact_refs jsonb not null default '[]'::jsonb,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  signature text check (signature is null or signature ~ '^[a-f0-9]{64}$'),
  signature_key_id text,
  previous_hash text check (previous_hash is null or previous_hash ~ '^[a-f0-9]{64}$'),
  chain_hash text not null check (chain_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(workspace_id, mission_id, sequence)
);

create index if not exists evidence_ledger_mission_sequence_idx
  on public.evidence_ledger(workspace_id, mission_id, sequence);
create index if not exists evidence_ledger_event_idx
  on public.evidence_ledger(event_id) where event_id is not null;
create index if not exists evidence_ledger_chain_hash_idx
  on public.evidence_ledger(chain_hash);

create or replace function public.prevent_evidence_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'evidence_ledger is append-only; UPDATE/DELETE are forbidden';
end;
$$;

drop trigger if exists evidence_ledger_immutable_trigger on public.evidence_ledger;
create trigger evidence_ledger_immutable_trigger
before update or delete on public.evidence_ledger
for each row execute function public.prevent_evidence_ledger_mutation();

create or replace function public.append_evidence_ledger(
  p_id text,
  p_workspace_id text,
  p_mission_id text,
  p_kind text,
  p_source text,
  p_actor text,
  p_event_id text,
  p_job_id text,
  p_checkpoint_id text,
  p_model_ref text,
  p_prompt_version text,
  p_test_version text,
  p_decision text,
  p_payload jsonb,
  p_artifact_refs jsonb,
  p_content_hash text,
  p_signature text,
  p_signature_key_id text
)
returns setof public.evidence_ledger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_next_sequence bigint;
  v_previous_hash text;
  v_chain_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id || ':' || p_mission_id, 0));

  select sequence, chain_hash
    into v_next_sequence, v_previous_hash
  from public.evidence_ledger
  where workspace_id = p_workspace_id and mission_id = p_mission_id
  order by sequence desc
  limit 1;

  v_next_sequence := coalesce(v_next_sequence, 0) + 1;
  v_chain_hash := encode(
    digest(
      coalesce(v_previous_hash, 'GENESIS') || '|' ||
      p_content_hash || '|' ||
      v_next_sequence::text || '|' ||
      p_id,
      'sha256'
    ),
    'hex'
  );

  return query
  insert into public.evidence_ledger (
    id, workspace_id, mission_id, sequence, kind, source, actor,
    event_id, job_id, checkpoint_id, model_ref, prompt_version, test_version, decision,
    payload, artifact_refs, content_hash, signature, signature_key_id, previous_hash, chain_hash
  )
  values (
    p_id, p_workspace_id, p_mission_id, v_next_sequence, p_kind, p_source, p_actor,
    p_event_id, p_job_id, p_checkpoint_id, p_model_ref, p_prompt_version, p_test_version, p_decision,
    coalesce(p_payload, '{}'::jsonb), coalesce(p_artifact_refs, '[]'::jsonb),
    p_content_hash, p_signature, p_signature_key_id, v_previous_hash, v_chain_hash
  )
  returning public.evidence_ledger.*;
end;
$$;

create or replace function public.evidence_ledger_health()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'tableReady', to_regclass('public.evidence_ledger') is not null,
    'appendFunctionReady', to_regprocedure('public.append_evidence_ledger(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text)') is not null,
    'immutableTriggerReady', exists (
      select 1
      from pg_trigger
      where tgname = 'evidence_ledger_immutable_trigger'
        and tgrelid = 'public.evidence_ledger'::regclass
        and not tgisinternal
    )
  );
$$;

alter table public.evidence_ledger disable row level security;

revoke insert, update, delete on public.evidence_ledger from anon;
grant select on public.evidence_ledger to anon;
grant execute on function public.append_evidence_ledger(
  text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text
) to anon;
grant execute on function public.evidence_ledger_health() to anon;

comment on table public.evidence_ledger is
  'Immutable evidence/decision ledger. Rows are append-only and chained per workspace+mission.';
comment on column public.evidence_ledger.content_hash is
  'SHA-256 of canonical evidence content generated by the server before append.';
comment on column public.evidence_ledger.signature is
  'Optional server-side HMAC-SHA256 over content_hash; signing secret is never stored here.';
comment on column public.evidence_ledger.chain_hash is
  'Database-generated SHA-256(previous_hash|content_hash|sequence|id), serialized by advisory lock.';
