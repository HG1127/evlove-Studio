-- Evolution OS · Idempotent evidence, atomic job transitions, checkpoint CAS
-- This remains the tail migration so every server-only boundary is re-hardened.

create or replace function public.append_evidence_ledger(
  p_id text,p_workspace_id text,p_mission_id text,p_kind text,p_source text,p_actor text,
  p_event_id text,p_job_id text,p_checkpoint_id text,p_model_ref text,p_prompt_version text,
  p_test_version text,p_decision text,p_payload jsonb,p_artifact_refs jsonb,
  p_content_hash text,p_signature text,p_signature_key_id text
)
returns setof public.evidence_ledger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_existing public.evidence_ledger%rowtype; v_next_sequence bigint; v_previous_hash text; v_chain_hash text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id || ':' || p_mission_id, 0));
  select * into v_existing from public.evidence_ledger where id=p_id for update;
  if found then
    if v_existing.workspace_id<>p_workspace_id or v_existing.mission_id<>p_mission_id
      or v_existing.content_hash<>p_content_hash then
      raise exception 'EVIDENCE_IDEMPOTENCY_CONFLICT';
    end if;
    return next v_existing;
    return;
  end if;

  select sequence,chain_hash into v_next_sequence,v_previous_hash
  from public.evidence_ledger
  where workspace_id=p_workspace_id and mission_id=p_mission_id
  order by sequence desc limit 1;
  v_next_sequence:=coalesce(v_next_sequence,0)+1;
  v_chain_hash:=encode(digest(coalesce(v_previous_hash,'GENESIS')||'|'||p_content_hash||'|'||v_next_sequence::text||'|'||p_id,'sha256'),'hex');
  return query insert into public.evidence_ledger(
    id,workspace_id,mission_id,sequence,kind,source,actor,event_id,job_id,checkpoint_id,
    model_ref,prompt_version,test_version,decision,payload,artifact_refs,content_hash,
    signature,signature_key_id,previous_hash,chain_hash
  ) values(
    p_id,p_workspace_id,p_mission_id,v_next_sequence,p_kind,p_source,p_actor,p_event_id,p_job_id,p_checkpoint_id,
    p_model_ref,p_prompt_version,p_test_version,p_decision,coalesce(p_payload,'{}'::jsonb),coalesce(p_artifact_refs,'[]'::jsonb),
    p_content_hash,p_signature,p_signature_key_id,v_previous_hash,v_chain_hash
  ) returning *;
end;
$$;

alter table public.jobs add column if not exists creation_fingerprint text;

create or replace function public.create_evolution_job_idempotent(p_job jsonb)
returns table(applied boolean,reason text,job jsonb)
language plpgsql security definer set search_path = public
as $$
declare v_key text:=nullif(p_job->>'idempotencyKey',''); v_id text:=nullif(p_job->>'id','');
  v_fingerprint text; v_current public.jobs%rowtype; v_saved public.jobs%rowtype;
begin
  if v_key is null or v_id is null then raise exception 'Job id and idempotency key are required'; end if;
  v_fingerprint:=encode(extensions.digest(jsonb_build_object(
    'missionId',p_job->'missionId','type',p_job->'type','label',p_job->'label',
    'priority',p_job->'priority','inputRef',p_job->'inputRef',
    'metadata',coalesce(p_job->'metadata','{}'::jsonb)
  )::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('job-idempotency:'||v_key,0));
  select * into v_current from public.jobs where idempotency_key=v_key for update;
  if found then
    if v_current.creation_fingerprint is distinct from v_fingerprint then
      return query select false,'idempotency-conflict',to_jsonb(v_current);
      return;
    end if;
    return query select true,'idempotent-replay',to_jsonb(v_current);
    return;
  end if;
  insert into public.jobs(
    id,mission_id,schema_version,type,status,label,idempotency_key,creation_fingerprint,generation,attempts,priority,
    checkpoint_id,input_ref,output_ref,metadata,progress,error,created_at,started_at,heartbeat_at,finished_at,updated_at
  ) values(
    v_id,nullif(p_job->>'missionId',''),p_job->>'schemaVersion',p_job->>'type',p_job->>'status',p_job->>'label',v_key,v_fingerprint,
    coalesce((p_job->>'generation')::integer,0),coalesce((p_job->>'attempts')::integer,0),coalesce((p_job->>'priority')::integer,50),
    nullif(p_job->>'checkpointId',''),nullif(p_job->>'inputRef',''),nullif(p_job->>'outputRef',''),coalesce(p_job->'metadata','{}'::jsonb),
    p_job->'progress',nullif(p_job->>'error',''),(p_job->>'createdAt')::timestamptz,
    nullif(p_job->>'startedAt','')::timestamptz,nullif(p_job->>'heartbeatAt','')::timestamptz,
    nullif(p_job->>'finishedAt','')::timestamptz,(p_job->>'updatedAt')::timestamptz
  ) returning * into v_saved;
  insert into public.events(id,mission_id,schema_version,type,source,job_id,payload,at)
  values(
    'job-created:'||v_id,v_saved.mission_id,'event-v1','JobQueued','backend-job-lifecycle',v_id,
    jsonb_build_object('type',v_saved.type,'label',v_saved.label,'idempotencyKey',v_key),v_saved.created_at
  );
  return query select true,'created',to_jsonb(v_saved);
exception when unique_violation then
  select * into v_current from public.jobs where idempotency_key=v_key;
  if found and v_current.creation_fingerprint=v_fingerprint then
    return query select true,'idempotent-replay',to_jsonb(v_current);
  else
    return query select false,'idempotency-conflict',case when found then to_jsonb(v_current) else null::jsonb end;
  end if;
end;
$$;

create or replace function public.transition_evolution_job_with_event(
  p_id text,p_expected_generation integer,p_job jsonb,p_event jsonb
)
returns table(applied boolean,reason text,job jsonb)
language plpgsql security definer set search_path = public
as $$
declare v_current public.jobs%rowtype; v_saved public.jobs%rowtype; v_next text:=p_job->>'status'; v_event_id text:=nullif(p_event->>'id','');
begin
  if p_expected_generation<0 or nullif(p_job->>'id','') is distinct from p_id then raise exception 'Invalid Job transition identity'; end if;
  if coalesce((p_job->>'generation')::integer,-1)<>p_expected_generation then raise exception 'Job transition generation mismatch'; end if;
  if nullif(p_event->>'id','') is null or p_event->>'jobId' is distinct from p_id then raise exception 'Job transition Event binding mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended('job:'||p_id,0));
  select * into v_current from public.jobs where id=p_id for update;
  if not found then return query select false,'missing',null::jsonb; return; end if;
  if v_current.generation<>p_expected_generation then return query select false,'generation-conflict',to_jsonb(v_current); return; end if;
  if p_event->>'missionId' is distinct from v_current.mission_id
    or p_event->'payload'->>'from' is distinct from v_current.status
    or (p_event->'payload'->>'priorUpdatedAt')::timestamptz is distinct from v_current.updated_at then
    return query select false,'state-conflict',to_jsonb(v_current); return;
  end if;
  if v_next=v_current.status then return query select true,'idempotent',to_jsonb(v_current); return; end if;
  if not ((v_current.status='queued' and v_next in ('running','failed','cancelled'))
    or (v_current.status='running' and v_next in ('waiting','completed','partial','failed','cancelled'))
    or (v_current.status='waiting' and v_next in ('running','failed','cancelled'))) then
    return query select false,'invalid-transition',to_jsonb(v_current); return;
  end if;

  update public.jobs set
    status=v_next,label=p_job->>'label',attempts=coalesce((p_job->>'attempts')::integer,attempts),
    checkpoint_id=nullif(p_job->>'checkpointId',''),output_ref=coalesce(nullif(p_job->>'outputRef',''),output_ref),
    metadata=coalesce(metadata,'{}'::jsonb)||coalesce(p_job->'metadata','{}'::jsonb),
    progress=p_job->'progress',error=nullif(p_job->>'error',''),
    started_at=nullif(p_job->>'startedAt','')::timestamptz,heartbeat_at=nullif(p_job->>'heartbeatAt','')::timestamptz,
    finished_at=nullif(p_job->>'finishedAt','')::timestamptz,updated_at=(p_job->>'updatedAt')::timestamptz
  where id=p_id returning * into v_saved;
  insert into public.events(id,mission_id,schema_version,type,source,job_id,checkpoint_id,causation_id,correlation_id,payload,at)
  values(
    v_event_id,nullif(p_event->>'missionId',''),coalesce(p_event->>'schemaVersion','event-v1'),p_event->>'type',p_event->>'source',
    p_id,nullif(p_event->>'checkpointId',''),nullif(p_event->>'causationId',''),nullif(p_event->>'correlationId',''),
    coalesce(p_event->'payload','{}'::jsonb),(p_event->>'at')::timestamptz
  );
  return query select true,'transitioned',to_jsonb(v_saved);
end;
$$;

create or replace function public.put_evolution_job_with_event(p_job jsonb,p_event jsonb)
returns table(applied boolean,reason text,job jsonb)
language plpgsql security definer set search_path = public
as $$
declare v_result record; v_existing public.events%rowtype; v_current public.jobs%rowtype;
  v_event_id text:=nullif(p_event->>'id',''); v_job jsonb:=p_job;
begin
  if v_event_id is null or p_event->>'jobId' is distinct from p_job->>'id'
    or p_event->>'missionId' is distinct from p_job->>'missionId' then
    raise exception 'Job Event binding mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('job:'||(p_job->>'id'),0));
  select * into v_current from public.jobs where id=p_job->>'id' for update;
  if found and v_current.generation=coalesce((p_job->>'generation')::integer,0) then
    if not p_job ? 'outputRef' and v_current.output_ref is not null then
      v_job:=jsonb_set(v_job,'{outputRef}',to_jsonb(v_current.output_ref));
    end if;
    v_job:=jsonb_set(v_job,'{metadata}',coalesce(v_current.metadata,'{}'::jsonb)||coalesce(p_job->'metadata','{}'::jsonb));
  end if;
  select * into v_result from public.put_evolution_job_monotonic(v_job);
  if v_result.applied and v_result.reason in ('inserted','updated') then
    select * into v_existing from public.events where id=v_event_id;
    if found then
      if v_existing.job_id is distinct from p_job->>'id'
        or v_existing.payload is distinct from coalesce(p_event->'payload','{}'::jsonb) then
        raise exception 'Job Event idempotency conflict';
      end if;
    else
      insert into public.events(id,mission_id,schema_version,type,source,job_id,checkpoint_id,causation_id,correlation_id,payload,at)
      values(
        v_event_id,nullif(p_event->>'missionId',''),coalesce(p_event->>'schemaVersion','event-v1'),p_event->>'type',
        p_event->>'source',p_job->>'id',nullif(p_event->>'checkpointId',''),nullif(p_event->>'causationId',''),
        nullif(p_event->>'correlationId',''),coalesce(p_event->'payload','{}'::jsonb),(p_event->>'at')::timestamptz
      );
    end if;
  end if;
  return query select v_result.applied,v_result.reason,v_result.job;
end;
$$;

create or replace function public.cancel_evolution_job_generation_with_event(
  p_id text,p_expected_generation integer,p_at timestamptz
)
returns table(applied boolean,reason text,job jsonb)
language plpgsql security definer set search_path = public
as $$
declare v_result record;
begin
  select * into v_result from public.cancel_evolution_job_generation(p_id,p_expected_generation,p_at);
  if v_result.applied then
    insert into public.events(id,mission_id,schema_version,type,source,job_id,payload,at)
    values(
      'job-cancel:'||p_id||':'||p_expected_generation,
      nullif(v_result.job->>'mission_id',''),'event-v1','JobUpdated','backend-job-store',p_id,
      jsonb_build_object('status','cancelled','generation',p_expected_generation),p_at
    );
  end if;
  return query select v_result.applied,v_result.reason,v_result.job;
end;
$$;

create or replace function public.compare_and_swap_mission_with_event(
  p_id text,p_expected_revision bigint,p_schema_version text,p_stage text,p_status text,
  p_payload jsonb,p_created_at timestamptz,p_updated_at timestamptz,p_event jsonb
)
returns table(applied boolean,current_revision bigint,mission jsonb)
language plpgsql security definer set search_path = public
as $$
declare v_current public.missions%rowtype; v_saved public.missions%rowtype;
begin
  if p_expected_revision<0 or p_payload->>'id' is distinct from p_id then raise exception 'Invalid Mission checkpoint identity'; end if;
  if p_event->>'missionId' is distinct from p_id or nullif(p_event->>'id','') is null
    or p_event->>'type' is distinct from 'CheckpointCreated'
    or p_event->>'checkpointId' is distinct from p_event->>'id' then
    raise exception 'Checkpoint Event binding mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mission:'||p_id,0));
  select * into v_current from public.missions where id=p_id for update;
  if not found then return query select false,null::bigint,null::jsonb; return; end if;
  if v_current.revision<>p_expected_revision then return query select false,v_current.revision,to_jsonb(v_current); return; end if;
  update public.missions set schema_version=p_schema_version,stage=p_stage,status=p_status,payload=p_payload,updated_at=p_updated_at
  where id=p_id returning * into v_saved;
  insert into public.events(id,mission_id,schema_version,type,source,job_id,checkpoint_id,causation_id,correlation_id,payload,at)
  values(
    p_event->>'id',p_id,coalesce(p_event->>'schemaVersion','event-v1'),p_event->>'type',p_event->>'source',
    nullif(p_event->>'jobId',''),nullif(p_event->>'checkpointId',''),nullif(p_event->>'causationId',''),
    nullif(p_event->>'correlationId',''),coalesce(p_event->'payload','{}'::jsonb),(p_event->>'at')::timestamptz
  );
  return query select true,v_saved.revision,to_jsonb(v_saved);
end;
$$;

create or replace function public.bind_evolution_job_workflow_run(
  p_id text,
  p_expected_generation integer,
  p_run_id text,
  p_binding text,
  p_at timestamptz
)
returns table(applied boolean,reason text,job jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.jobs%rowtype;
  v_saved public.jobs%rowtype;
begin
  if p_expected_generation < 0 then
    raise exception 'expected Job generation must be non-negative';
  end if;
  if nullif(trim(p_run_id),'') is null then
    raise exception 'Workflow run id is required';
  end if;
  if p_binding not in ('metadata','output-ref') then
    raise exception 'Unsupported Workflow run binding: %',p_binding;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('job:' || p_id, 0));
  select * into v_current from public.jobs where id=p_id for update;

  if not found then
    return query select false,'missing',null::jsonb;
    return;
  end if;
  if v_current.generation <> p_expected_generation then
    return query select false,'generation-conflict',to_jsonb(v_current);
    return;
  end if;

  if p_binding='metadata' then
    update public.jobs
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('runId',p_run_id),
        updated_at=greatest(updated_at,p_at)
    where id=p_id
    returning * into v_saved;
  else
    update public.jobs
    set output_ref=p_run_id,
        updated_at=greatest(updated_at,p_at)
    where id=p_id
    returning * into v_saved;
  end if;

  return query select true,'bound',to_jsonb(v_saved);
end;
$$;

-- Final production security invariants.
alter default privileges in schema public revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

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

grant select, insert,update,delete on table public.missions to service_role;
grant select, insert,update,delete on table public.jobs to service_role;
grant select, insert on table public.events to service_role;
grant select, insert,update,delete on table public.artifacts to service_role;
grant select, insert,update,delete on table public.organization_capabilities to service_role;
grant select on table public.evidence_ledger to service_role;
grant select, insert,update,delete on table public.release_approval_grants to service_role;
grant select, insert,delete on table public.outcome_metric_samples to service_role;
grant select, insert,update,delete on table public.evolution_vault_secrets to service_role;
grant select, insert,update on table public.evolution_workspace_members to service_role;

create or replace function public.prevent_evolution_event_mutation()
returns trigger language plpgsql as $$ begin raise exception 'events is append-only; UPDATE/DELETE are forbidden'; end; $$;
drop trigger if exists evolution_events_immutable_trigger on public.events;
create trigger evolution_events_immutable_trigger before update or delete on public.events for each row execute function public.prevent_evolution_event_mutation();

revoke execute on function public.append_evidence_ledger(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text) from public, anon, authenticated;
revoke execute on function public.evidence_ledger_health() from public, anon, authenticated;
revoke execute on function public.match_organization_capabilities(text,extensions.vector,integer,boolean,text[],text,text) from public, anon, authenticated;
revoke execute on function public.bind_evolution_job_workflow_run(text,integer,text,text,timestamptz) from public, anon, authenticated;
revoke execute on function public.put_evolution_job_monotonic(jsonb) from public, anon, authenticated;
revoke execute on function public.put_evolution_job_with_event(jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public.cancel_evolution_job_generation(text,integer,timestamptz) from public, anon, authenticated;
revoke execute on function public.cancel_evolution_job_generation_with_event(text,integer,timestamptz) from public, anon, authenticated;
revoke execute on function public.compare_and_swap_mission(text,bigint,text,text,text,jsonb,timestamptz,timestamptz) from public, anon, authenticated;
revoke execute on function public.delete_mission_if_revision(text,bigint) from public, anon, authenticated;
revoke execute on function public.create_evolution_job_idempotent(jsonb) from public, anon, authenticated;
revoke execute on function public.transition_evolution_job_with_event(text,integer,jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public.compare_and_swap_mission_with_event(text,bigint,text,text,text,jsonb,timestamptz,timestamptz,jsonb) from public, anon, authenticated;

grant execute on function public.append_evidence_ledger(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb,jsonb,text,text,text) to service_role;
grant execute on function public.evidence_ledger_health() to service_role;
grant execute on function public.match_organization_capabilities(text,extensions.vector,integer,boolean,text[],text,text) to service_role;
grant execute on function public.bind_evolution_job_workflow_run(text,integer,text,text,timestamptz) to service_role;
grant execute on function public.put_evolution_job_monotonic(jsonb) to service_role;
grant execute on function public.put_evolution_job_with_event(jsonb,jsonb) to service_role;
grant execute on function public.cancel_evolution_job_generation(text,integer,timestamptz) to service_role;
grant execute on function public.cancel_evolution_job_generation_with_event(text,integer,timestamptz) to service_role;
grant execute on function public.compare_and_swap_mission(text,bigint,text,text,text,jsonb,timestamptz,timestamptz) to service_role;
grant execute on function public.delete_mission_if_revision(text,bigint) to service_role;
grant execute on function public.create_evolution_job_idempotent(jsonb) to service_role;
grant execute on function public.transition_evolution_job_with_event(text,integer,jsonb,jsonb) to service_role;
grant execute on function public.compare_and_swap_mission_with_event(text,bigint,text,text,text,jsonb,timestamptz,timestamptz,jsonb) to service_role;

revoke execute on function public.bump_mission_revision() from public, anon, authenticated;
revoke execute on function public.prevent_evidence_ledger_mutation() from public, anon, authenticated;
revoke execute on function public.prevent_evolution_event_mutation() from public, anon, authenticated;
update storage.buckets set public=false where id='evolution-artifacts';
drop policy if exists evolution_artifacts_anon_select on storage.objects;
drop policy if exists evolution_artifacts_anon_insert on storage.objects;
drop policy if exists evolution_artifacts_anon_update on storage.objects;
drop policy if exists evolution_artifacts_anon_delete on storage.objects;
revoke all privileges on table storage.objects from public, anon, authenticated;
