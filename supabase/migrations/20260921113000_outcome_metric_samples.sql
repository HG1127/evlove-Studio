-- Evolution OS · Outcome Analytics warehouse
-- Raw candidate/stable metric samples for statistical, segment and drift analysis.

create table if not exists public.outcome_metric_samples (
  id text primary key,
  workspace_id text not null,
  mission_id text not null,
  candidate_id text,
  deployment_id text,
  arm text not null check (arm in ('stable','candidate')),
  metric_key text not null,
  metric_kind text not null check (metric_kind in ('business','latency','cost','safety')),
  direction text not null check (direction in ('higher','lower')),
  value double precision not null,
  unit text,
  segment text not null default 'all',
  source text not null,
  observed_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists outcome_samples_mission_metric_idx
  on public.outcome_metric_samples(workspace_id,mission_id,metric_key,segment,observed_at);
create index if not exists outcome_samples_candidate_idx
  on public.outcome_metric_samples(workspace_id,mission_id,candidate_id,arm,observed_at);

alter table public.outcome_metric_samples enable row level security;
revoke all on public.outcome_metric_samples from anon, authenticated;
grant select,insert,delete on public.outcome_metric_samples to service_role;

comment on table public.outcome_metric_samples is
  'Raw Stable/Candidate production metric samples. Statistical conclusions remain insufficient until both arms meet sample thresholds.';
