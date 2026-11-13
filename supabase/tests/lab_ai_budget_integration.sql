-- P3-H: run ONLY against a disposable PostgreSQL database with all current migrations applied.
-- This transaction always rolls back. A two-connection lock test is still required in Lab.
begin;
do $$
declare
  v_mission text := 'tx-lab-budget-contract';
  v_job text := 'tx-lab-budget-workflow-control';
  v_deadline timestamptz := now()+interval '15 minutes';
  v_first uuid := '0cc2467c-e3d6-4c5a-b9b1-82e758b3c973';
  v_second uuid := '0cc2467c-e3d6-4c5a-b9b1-82e758b3c974';
  v_other uuid := '0cc2467c-e3d6-4c5a-b9b1-82e758b3c975';
  v_result jsonb;
  v_budget public.evolution_lab_ai_budgets%rowtype;
begin
  insert into public.missions(id,schema_version,revision,stage,status,payload,created_at,updated_at)
    values(v_mission,'mission-v1',0,'target','idle',
      jsonb_build_object('id',v_mission,'stage','target','campaign',jsonb_build_object('status','idle')),
      now(),now());
  insert into public.jobs(id,mission_id,schema_version,type,status,label,idempotency_key,
      generation,attempts,priority,created_at,updated_at)
    values(v_job,v_mission,'job-v1','campaign','running','Lab control',
      'workflow-control:'||v_mission,1,0,70,now(),now());

  v_result:=public.initialize_evolution_lab_ai_budget(v_mission,v_job,2,1000,v_deadline);
  if v_result->>'reason'<>'enrolled' or v_result->>'allowed'<>'true' then
    raise exception 'Lab initial enrollment denied';
  end if;
  v_result:=public.initialize_evolution_lab_ai_budget(v_mission,v_job,2,1000,v_deadline);
  if v_result->>'allowed'<>'true' then raise exception 'Same immutable enrollment cannot be retried'; end if;
  v_result:=public.initialize_evolution_lab_ai_budget(v_mission,v_job,6,1000,v_deadline);
  if v_result->>'reason'<>'existing-budget-immutable' then raise exception 'Call cap was reset'; end if;

  v_result:=public.reserve_evolution_lab_ai_call(v_mission,v_job,v_first,repeat('a',64),600);
  if v_result->>'reason'<>'reserved' then raise exception 'First reservation denied'; end if;
  v_result:=public.reserve_evolution_lab_ai_call(v_mission,v_job,v_first,repeat('a',64),600);
  if v_result->>'reason'<>'call-id-already-used' then raise exception 'Duplicate physical attempt accepted'; end if;
  v_result:=public.reserve_evolution_lab_ai_call(v_mission,v_job,v_other,repeat('a',64),500);
  if v_result->>'reason'<>'unsettled-attempt' then raise exception 'Unsettled attempt did not block a second physical call'; end if;

  v_result:=public.settle_evolution_lab_ai_call(v_mission,v_job,v_first,250);
  if v_result->>'reason'<>'settled' then raise exception 'Observed settlement failed'; end if;
  v_result:=public.settle_evolution_lab_ai_call(v_mission,v_job,v_first,0);
  if v_result->>'reason'<>'call-not-reserved' then raise exception 'Duplicate settlement accepted'; end if;
  v_result:=public.reserve_evolution_lab_ai_call(v_mission,v_job,v_other,repeat('b',64),800);
  if v_result->>'reason'<>'budget-exhausted' then raise exception 'Monetary cap was bypassed'; end if;
  v_result:=public.reserve_evolution_lab_ai_call(v_mission,v_job,v_second,repeat('b',64),500);
  if v_result->>'reason'<>'reserved' then raise exception 'Second reservation denied after settlement'; end if;
  v_result:=public.reserve_evolution_lab_ai_call(v_mission,v_job,v_other,repeat('a',64),1);
  if v_result->>'reason'<>'unsettled-attempt' then raise exception 'Pending second attempt did not block new calls'; end if;


  v_result:=public.settle_evolution_lab_ai_call(v_mission,v_job,v_second,null);
  if v_result->>'reason'<>'usage-unknown-paused' then raise exception 'Unmeasured response not paused'; end if;
  select * into v_budget from public.evolution_lab_ai_budgets where mission_id=v_mission;
  if v_budget.calls_used<>2 or v_budget.held_cost_microusd<>500
    or v_budget.spent_cost_microusd<>250 or v_budget.status<>'paused' then
    raise exception 'Lab budget counters incorrectly refunded unknown cost';
  end if;
  v_result:=public.cancel_evolution_lab_ai_budget(v_mission,v_job);
  if v_result->>'reason'<>'cancelled' then raise exception 'Lab cancellation failed'; end if;
  select * into v_budget from public.evolution_lab_ai_budgets where mission_id=v_mission;
  if v_budget.status<>'cancelled' or v_budget.held_cost_microusd<>500 then
    raise exception 'Cancellation refunded cost or changed state incorrectly';
  end if;

  if has_function_privilege('anon','public.reserve_evolution_lab_ai_call(text,text,uuid,text,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.reserve_evolution_lab_ai_call(text,text,uuid,text,bigint)','EXECUTE')
    or not has_function_privilege('service_role','public.reserve_evolution_lab_ai_call(text,text,uuid,text,bigint)','EXECUTE')
    or has_table_privilege('anon','public.evolution_lab_ai_budgets','SELECT')
    or has_table_privilege('authenticated','public.evolution_lab_ai_calls','SELECT') then
    raise exception 'Lab budget service-role boundary is unsafe';
  end if;
end;
$$;
rollback;