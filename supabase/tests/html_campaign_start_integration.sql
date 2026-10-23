-- SQL integration proof for Mission-atomic HTML Campaign admission.
-- Run on a disposable migrated PostgreSQL database; this fixture ALWAYS rolls back.
-- This checks sequential conflict/replay/recovery and privilege boundaries.
-- A two-session concurrency stress test is still required to prove live deployment.
begin;
do $$
declare
  v_mission text := 'tx-html-campaign-atomic-20261021';
  v_at text := '2026-10-21T00:00:00.000Z';
  v_job jsonb;
  v_other jsonb;
  v_retry jsonb;
  v_first record;
  v_result record;
  v_count bigint;
begin
  insert into public.missions(id,schema_version,revision,stage,status,payload,created_at,updated_at)
  values(v_mission,'mission-v1',0,'target','idle',
    jsonb_build_object('id',v_mission,'stage','target','campaign',jsonb_build_object('status','idle')),
    v_at::timestamptz,v_at::timestamptz);

  v_job := jsonb_build_object(
    'schemaVersion','job-v1','id','tx-html-atomic-job-a','missionId',v_mission,
    'type','campaign','status','queued','label','Evolution Workflow Control',
    'idempotencyKey','workflow-control:'||v_mission||':first',
    'generation',1,'attempts',0,'priority',70,
    'createdAt',v_at,'updatedAt',v_at);
  select * into v_first from public.create_evolution_html_campaign_control(v_job,false);
  if not v_first.applied or v_first.reason <> 'created' then
    raise exception 'First HTML Campaign was not created';
  end if;
  if not exists(select 1 from public.events where id='job-created:tx-html-atomic-job-a') then
    raise exception 'HTML Campaign creation Event missing';
  end if;

  v_other := v_job || jsonb_build_object('id','tx-html-atomic-job-b',
    'idempotencyKey','workflow-control:'||v_mission||':different-key');
  select * into v_result from public.create_evolution_html_campaign_control(v_other,false);
  if v_result.applied or v_result.reason <> 'mission-active'
    or v_result.job->>'id' <> 'tx-html-atomic-job-a' then
    raise exception 'A different key bypassed the Mission active guard';
  end if;
  select * into v_result from public.create_evolution_html_campaign_control(
    v_job || jsonb_build_object('id','tx-html-atomic-replay'),false);
  if not v_result.applied or v_result.reason <> 'idempotent-replay'
    or v_result.job->>'id' <> 'tx-html-atomic-job-a' then
    raise exception 'Same-key replay did not recover the original Job';
  end if;

  -- Exercise the special recovery exemption using only test rows in this rollback.
  update public.jobs set status='waiting' where id='tx-html-atomic-job-a';
  select * into v_result from public.create_evolution_html_campaign_control(v_other,false);
  if v_result.applied or v_result.reason <> 'mission-active' then
    raise exception 'Ordinary start bypassed a waiting Campaign';
  end if;
  v_retry := v_other || jsonb_build_object('id','tx-html-atomic-recovery',
    'idempotencyKey','workflow-control:'||v_mission||':experiment-judge-retry:validated');
  select * into v_result from public.create_evolution_html_campaign_control(v_retry,true);
  if not v_result.applied or v_result.reason <> 'created' then
    raise exception 'Validated single waiting recovery was rejected';
  end if;
  select * into v_result from public.create_evolution_html_campaign_control(
    v_retry || jsonb_build_object('id','tx-html-atomic-third',
      'idempotencyKey','workflow-control:'||v_mission||':experiment-judge-retry:another'),true);
  if v_result.applied or v_result.reason <> 'mission-active' then
    raise exception 'Multiple active Campaigns bypassed retry guard';
  end if;
  select count(*) into v_count from public.jobs where mission_id=v_mission;
  if v_count <> 2 then raise exception 'Guarded admission created extra Job rows: %',v_count; end if;

  if has_function_privilege('anon','public.create_evolution_html_campaign_control(jsonb,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.create_evolution_html_campaign_control(jsonb,boolean)','EXECUTE')
    or not has_function_privilege('service_role','public.create_evolution_html_campaign_control(jsonb,boolean)','EXECUTE') then
    raise exception 'HTML Campaign control RPC grants are unsafe';
  end if;
end;
$$;
rollback;
