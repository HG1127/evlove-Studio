-- P3-P rollback-only Lab verification of forward Mission/Job triggers.
-- Execute only after the DDL-under-test inside the SAME transaction; no COMMIT.
do $$
declare
  v_mission text := 'tx-p3p-mission-parent-guard';
  v_job text := 'tx-p3p-job-parent-guard';
  v_bad text := 'tx-p3p-unparented-job';
  v_legacy text := 'tx-p3r-legacy-delete-audit';
  v_result record;
  v_audit record;
  v_rejected boolean;
begin
  insert into public.missions(id,schema_version,revision,stage,status,payload,created_at,updated_at)
  values (v_mission,'mission-v1',0,'target','idle',
    jsonb_build_object('id',v_mission,'stage','target',
      'campaign',jsonb_build_object('status','idle')),now(),now());
  insert into public.jobs(
    id,mission_id,schema_version,type,status,label,idempotency_key,
    generation,attempts,priority,created_at,updated_at
  ) values (
    v_job,v_mission,'job-v1','campaign','queued','P3-P rollback-only Job',
    'workflow-control:'||v_mission||':fixture',1,0,70,now(),now()
  );

  select * into v_result from public.delete_mission_if_revision(v_mission,0,'lab-admin-fixture','admin');
  if v_result.applied is distinct from false
    or v_result.blocked_reason is distinct from 'active-jobs'
    or v_result.active_job_count is distinct from 1::bigint then
    raise exception 'New audited delete did not block active child Job';
  end if;
  if not exists(select 1 from public.missions where id=v_mission) then
    raise exception 'Mission was deleted while active Job remained';
  end if;
  -- Active children may not detach from a Mission to evade deletion protection.
  v_rejected:=false;
  begin
    update public.jobs set mission_id=null where id=v_job;
  exception when foreign_key_violation then
    if sqlerrm='ACTIVE_JOB_MISSION_DETACH_FORBIDDEN' then v_rejected:=true;
    else raise;
    end if;
  end;
  if not v_rejected then raise exception 'Active Job detached from parent Mission'; end if;

  -- Previous 2-argument RPC remains compatible but cannot bypass the trigger.
  v_rejected:=false;
  begin
    perform public.delete_mission_if_revision(v_mission,0);
  exception when others then
    if sqlerrm='MISSION_HAS_ACTIVE_JOBS' then v_rejected:=true;
    else raise;
    end if;
  end;
  if not v_rejected then raise exception 'Legacy 2-arg delete bypassed active Job guard'; end if;

  -- Terminalizing a legitimate child permits deletion and writes a single
  -- append-only audit event in exactly the Mission DELETE transaction.
  update public.jobs set status='completed',finished_at=now(),updated_at=now() where id=v_job;
  select * into v_result from public.delete_mission_if_revision(v_mission,0,'lab-admin-fixture','admin');
  if v_result.applied is distinct from true then raise exception 'Audited Mission deletion did not apply'; end if;
  select * into v_audit from public.events
    where mission_id=v_mission and type='MissionDeleted' order by at desc limit 1;
  if not found or v_audit.source is distinct from 'backend-mission-delete'
    or v_audit.payload->>'actorId' is distinct from 'lab-admin-fixture'
    or v_audit.payload->>'actorRole' is distinct from 'admin'
    or (v_audit.payload->>'deletedRevision')::bigint is distinct from 0::bigint then
    raise exception 'Mission deletion audit was not atomically attributed';
  end if;
  -- No actor identity from the four-argument RPC may contaminate a later
  -- legacy operation in the same transaction.
  if nullif(current_setting('app.evolution_actor_id',true),'') is not null
    or nullif(current_setting('app.evolution_actor_role',true),'') is not null then
    raise exception 'Audited deletion leaked actor identity to the transaction';
  end if;
  insert into public.missions(id,schema_version,revision,stage,status,payload,created_at,updated_at)
  values(v_legacy,'mission-v1',0,'target','idle',
    jsonb_build_object('id',v_legacy,'stage','target',
      'campaign',jsonb_build_object('status','idle')),now(),now());
  perform public.delete_mission_if_revision(v_legacy,0);
  select * into v_audit from public.events
    where mission_id=v_legacy and type='MissionDeleted' order by at desc limit 1;
  if not found
    or v_audit.payload->>'actorId' is distinct from 'unattributed-service-role'
    or v_audit.payload->>'actorRole' is distinct from 'service' then
    raise exception 'Legacy delete inherited incorrect actor identity';
  end if;

  v_rejected:=false;
  begin
    update public.jobs set status='waiting',updated_at=now() where id=v_job;
  exception when foreign_key_violation then
    if sqlerrm='JOB_MISSION_NOT_FOUND' then v_rejected:=true;
    else raise;
    end if;
  end;
  if not v_rejected then raise exception 'Orphaned completed Job was revived without Mission'; end if;

  v_rejected:=false;
  begin
    insert into public.jobs(
      id,mission_id,schema_version,type,status,label,idempotency_key,
      generation,attempts,priority,created_at,updated_at
    ) values (
      v_bad,v_mission,'job-v1','campaign','queued','Invalid parent',
      'workflow-control:'||v_mission||':invalid',1,0,70,now(),now()
    );
  exception when foreign_key_violation then
    if sqlerrm='JOB_MISSION_NOT_FOUND' then v_rejected:=true;
    else raise;
    end if;
  end;
  if not v_rejected then raise exception 'New Job accepted missing parent Mission'; end if;

  if has_function_privilege('anon','public.delete_mission_if_revision(text,bigint,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.delete_mission_if_revision(text,bigint,text,text)','EXECUTE')
     or not has_function_privilege('service_role','public.delete_mission_if_revision(text,bigint,text,text)','EXECUTE') then
    raise exception 'New audited Mission deletion exposed a privileged RPC';
  end if;
end;
$$;
