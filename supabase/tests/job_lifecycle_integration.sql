-- Run after the latest migration. Wrap this file in BEGIN/ROLLBACK so test rows are never committed.

do $$
declare
  v_at timestamptz := '2026-09-24T00:00:00Z';
  v_mission text := 'tx-test-mission-20260924';
  v_job jsonb;
  v_job_2 jsonb;
  v_created record;
  v_retry record;
  v_written record;
  v_checkpoint record;
  v_cancel record;
  v_status text;
  v_revision bigint;
  v_count integer;
  v_evidence public.evidence_ledger%rowtype;
begin
  insert into public.missions(id,schema_version,revision,stage,status,payload,created_at,updated_at)
  values(v_mission,'mission-v1',0,'intake','idle',
    jsonb_build_object('id',v_mission,'stage','intake','campaign',jsonb_build_object('status','idle')),
    v_at,v_at);

  v_job:=jsonb_build_object(
    'schemaVersion','job-v1','id','tx-test-job-1','missionId',v_mission,'type','campaign',
    'status','queued','label','Integration Job','idempotencyKey','tx-test-key-1',
    'generation',0,'attempts',0,'priority',50,'metadata',jsonb_build_object('source','test'),
    'createdAt','2026-09-24T00:00:00.000Z','updatedAt','2026-09-24T00:00:00.000Z');

  select * into v_created from public.create_evolution_job_idempotent(v_job);
  if not v_created.applied or v_created.reason <> 'created' then raise exception 'Job creation failed'; end if;
  if not exists(select 1 from public.events where id='job-created:tx-test-job-1' and type='JobQueued') then
    raise exception 'Job creation Event missing';
  end if;

  select * into v_retry from public.create_evolution_job_idempotent(v_job||jsonb_build_object('id','tx-test-retry-id'));
  if not v_retry.applied or v_retry.reason <> 'idempotent-replay' or v_retry.job->>'id' <> 'tx-test-job-1' then
    raise exception 'Job creation retry was not idempotent';
  end if;

  select * into v_written from public.put_evolution_job_with_event(
    v_job||jsonb_build_object('status','running','metadata',jsonb_build_object('source','test','runId','run-1'),
      'updatedAt','2026-09-24T00:01:00.000Z'),
    jsonb_build_object('schemaVersion','event-v1','id','tx-test-job-write-1','missionId',v_mission,
      'jobId','tx-test-job-1','type','JobUpdated','source','integration-test',
      'payload',jsonb_build_object('status','running'),'at','2026-09-24T00:01:00.000Z'));
  if not v_written.applied or v_written.job->>'status' <> 'running' then raise exception 'Atomic Job write failed'; end if;
  if not exists(select 1 from public.events where id='tx-test-job-write-1') then raise exception 'Atomic Job Event missing'; end if;

  select * into v_written from public.bind_evolution_job_workflow_run(
    'tx-test-job-1',0,'tx-test-run-id','output-ref',v_at+interval '2 minutes');
  if not v_written.applied then raise exception 'Workflow output-ref bind failed'; end if;
  select * into v_written from public.bind_evolution_job_workflow_run(
    'tx-test-job-1',0,'tx-test-run-id','metadata',v_at+interval '2 minutes');
  if not v_written.applied then raise exception 'Workflow metadata bind failed'; end if;
  select * into v_written from public.put_evolution_job_with_event(
    v_job||jsonb_build_object('status','running','updatedAt','2026-09-24T00:03:00.000Z'),
    jsonb_build_object('schemaVersion','event-v1','id','tx-test-job-write-2','missionId',v_mission,
      'jobId','tx-test-job-1','type','JobUpdated','source','integration-test',
      'payload',jsonb_build_object('status','running'),'at','2026-09-24T00:03:00.000Z'));
  if v_written.job->>'output_ref' <> 'tx-test-run-id'
    or v_written.job->'metadata'->>'runId' <> 'tx-test-run-id' then
    raise exception 'Job update lost the bound Workflow run id';
  end if;

  select * into v_written from public.transition_evolution_job_with_event(
    'tx-test-job-1',0,v_job||jsonb_build_object('status','waiting','updatedAt','2026-09-24T00:04:00.000Z'),
    jsonb_build_object('schemaVersion','event-v1','id','tx-test-job-waiting','missionId',v_mission,
      'jobId','tx-test-job-1','type','JobUpdated','source','integration-test',
      'payload',jsonb_build_object('from','running','to','waiting','priorUpdatedAt','2026-09-24T00:03:00.000Z'),
      'at','2026-09-24T00:04:00.000Z'));
  if not v_written.applied or v_written.job->>'status' <> 'waiting'
    or v_written.job->>'output_ref' <> 'tx-test-run-id'
    or v_written.job->'metadata'->>'runId' <> 'tx-test-run-id' then
    raise exception 'Job transition lost the bound Workflow run id';
  end if;

  select * into v_retry from public.create_evolution_job_idempotent(v_job||jsonb_build_object('id','tx-test-later-retry'));
  if not v_retry.applied or v_retry.job->>'id' <> 'tx-test-job-1' then
    raise exception 'Mutable Job metadata broke the creation fingerprint';
  end if;
  select * into v_retry from public.create_evolution_job_idempotent(v_job||jsonb_build_object('label','Conflicting label'));
  if v_retry.applied or v_retry.reason <> 'idempotency-conflict' then
    raise exception 'Changed creation parameters were accepted';
  end if;

  v_job_2:=v_job||jsonb_build_object('id','tx-test-job-2','idempotencyKey','tx-test-key-2');
  select * into v_created from public.create_evolution_job_idempotent(v_job_2);
  if not v_created.applied then raise exception 'Second Job creation failed'; end if;
  begin
    perform * from public.transition_evolution_job_with_event(
      'tx-test-job-2',0,v_job_2||jsonb_build_object('status','running','updatedAt','2026-09-24T00:01:00.000Z'),
      jsonb_build_object('schemaVersion','event-v1','id','job-created:tx-test-job-1','missionId',v_mission,
        'jobId','tx-test-job-2','type','JobStarted','source','integration-test',
        'payload',jsonb_build_object('from','queued','to','running','priorUpdatedAt','2026-09-24T00:00:00.000Z'),
        'at','2026-09-24T00:01:00.000Z'));
    raise exception 'Expected duplicate Event failure';
  exception when unique_violation then null;
  end;
  select status into v_status from public.jobs where id='tx-test-job-2';
  if v_status <> 'queued' then raise exception 'Event failure left a changed Job state'; end if;

  select * into v_cancel from public.cancel_evolution_job_generation_with_event('tx-test-job-2',0,v_at+interval '2 minutes');
  if not v_cancel.applied or v_cancel.job->>'status' <> 'cancelled' then raise exception 'Job cancel failed'; end if;
  if not exists(select 1 from public.events where id='job-cancel:tx-test-job-2:0') then
    raise exception 'Job cancellation Event missing';
  end if;

  select * into v_checkpoint from public.compare_and_swap_mission_with_event(
    v_mission,0,'mission-v1','intake','idle',
    jsonb_build_object('id',v_mission,'stage','intake','campaign',jsonb_build_object('status','idle',
      'checkpoint',jsonb_build_object('id','tx-test-checkpoint','round',1,'completedPhase','baseline','at','2026-09-24T00:01:00.000Z'))),
    v_at,v_at+interval '1 minute',
    jsonb_build_object('schemaVersion','event-v1','id','tx-test-checkpoint','missionId',v_mission,
      'checkpointId','tx-test-checkpoint','type','CheckpointCreated','source','integration-test',
      'payload',jsonb_build_object('round',1),'at','2026-09-24T00:01:00.000Z'));
  if not v_checkpoint.applied then raise exception 'Checkpoint compare-and-swap failed'; end if;
  select revision into v_revision from public.missions where id=v_mission;
  if v_revision <> 1 then raise exception 'Checkpoint did not advance Mission revision'; end if;
  select * into v_checkpoint from public.compare_and_swap_mission_with_event(
    v_mission,0,'mission-v1','intake','idle',
    jsonb_build_object('id',v_mission,'stage','intake'),v_at,v_at+interval '2 minutes',
    jsonb_build_object('schemaVersion','event-v1','id','tx-test-stale-checkpoint','missionId',v_mission,
      'checkpointId','tx-test-stale-checkpoint','type','CheckpointCreated','source','integration-test',
      'payload','{}'::jsonb,'at','2026-09-24T00:02:00.000Z'));
  if v_checkpoint.applied then raise exception 'Stale Mission revision was accepted'; end if;
  select count(*) into v_count from public.events where id='tx-test-stale-checkpoint';
  if v_count <> 0 then raise exception 'Stale checkpoint created an Event'; end if;

  select * into v_evidence from public.append_evidence_ledger(
    'tx-test-evidence','tx-test-workspace',v_mission,'artifact','integration-test','tester',
    null,null,null,null,null,null,'checked','{}'::jsonb,'[]'::jsonb,repeat('a',64),null,null);
  if v_evidence.sequence <> 1 then raise exception 'Evidence append failed'; end if;
  select * into v_evidence from public.append_evidence_ledger(
    'tx-test-evidence','tx-test-workspace',v_mission,'artifact','integration-test','tester',
    null,null,null,null,null,null,'checked','{}'::jsonb,'[]'::jsonb,repeat('a',64),null,null);
  select count(*) into v_count from public.evidence_ledger where id='tx-test-evidence';
  if v_count <> 1 then raise exception 'Evidence retry created a duplicate'; end if;

  if has_function_privilege('anon','public.create_evolution_job_idempotent(jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.put_evolution_job_with_event(jsonb,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.put_evolution_job_with_event(jsonb,jsonb)','EXECUTE') then
    raise exception 'Lifecycle RPC permissions are incorrect';
  end if;
end;
$$;
