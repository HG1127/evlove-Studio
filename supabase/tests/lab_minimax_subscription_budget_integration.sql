-- P3-M rollback-only integration fixture; execute only against the isolated Lab.
begin;
do $$
declare
  v_mission text := 'tx-p3m-subscription-budget-fixture';
  v_job text := 'tx-p3m-subscription-control-fixture';
  v_call_one uuid := '0cc2467c-e3d6-4c5a-b9b1-82e758b3c991';
  v_call_two uuid := '0cc2467c-e3d6-4c5a-b9b1-82e758b3c992';
  v_call_three uuid := '0cc2467c-e3d6-4c5a-b9b1-82e758b3c993';
  v_result jsonb;
  v_budget public.evolution_lab_subscription_budgets%rowtype;
  v_overrun_mission text := 'tx-p3m-subscription-overrun-fixture';
  v_overrun_job text := 'tx-p3m-subscription-overrun-control';
  v_overrun_call uuid := '0cc2467c-e3d6-4c5a-b9b1-82e758b3c994';
begin
  insert into public.missions(id,schema_version,revision,stage,status,payload,created_at,updated_at)
  values(v_mission,'mission-v1',0,'target','idle',
    jsonb_build_object('id',v_mission,'stage','target','campaign',jsonb_build_object('status','idle')),now(),now());
  insert into public.jobs(id,mission_id,schema_version,type,status,label,idempotency_key,generation,attempts,priority,created_at,updated_at)
  values(v_job,v_mission,'job-v1','campaign','queued','P3-M Subscription budget',
    'workflow-control:'||v_mission||':fixture',1,0,70,now(),now());

  v_result:=public.initialize_evolution_lab_subscription_budget(
    v_mission,v_job,6,300000,now()+interval '15 minutes',50,50);
  if v_result->>'reason'<>'enrolled' then raise exception 'Subscription budget enrollment failed'; end if;
  v_result:=public.initialize_evolution_lab_subscription_budget(
    v_mission,v_job,6,300000,now()+interval '16 minutes',50,50);
  if v_result->>'reason'<>'existing-budget-immutable' then raise exception 'Budget deadline/cap mutability was not rejected'; end if;

  v_result:=public.reserve_evolution_lab_subscription_call(
    v_mission,v_job,v_call_three,repeat('c',64),1000,49,91,1,1,
    now()+interval '4 hours',now()+interval '4 days',now());
  if v_result->>'reason'<>'quota-insufficient' then raise exception 'Low provider quota was accepted'; end if;
  v_result:=public.reserve_evolution_lab_subscription_call(
    v_mission,v_job,v_call_three,repeat('c',64),1000,82,91,1,1,
    now()+interval '4 hours',now()+interval '4 days',now()-interval '2 minutes');
  if v_result->>'reason'<>'quota-stale' then raise exception 'Stale provider quota was accepted'; end if;

  v_result:=public.reserve_evolution_lab_subscription_call(
    v_mission,v_job,v_call_one,repeat('a',64),80000,82,91,1,1,
    now()+interval '4 hours',now()+interval '4 days',now());
  if v_result->>'reason'<>'reserved' then raise exception 'First subscription reservation failed'; end if;
  v_result:=public.reserve_evolution_lab_subscription_call(
    v_mission,v_job,v_call_two,repeat('b',64),80000,82,91,1,1,
    now()+interval '4 hours',now()+interval '4 days',now());
  if v_result->>'reason'<>'unsettled-attempt' then raise exception 'Single-flight did not block second call'; end if;

  v_result:=public.settle_evolution_lab_subscription_call(v_mission,v_job,v_call_one,32000);
  if v_result->>'reason'<>'settled' then raise exception 'Measured token settlement failed'; end if;
  v_result:=public.reserve_evolution_lab_subscription_call(
    v_mission,v_job,v_call_two,repeat('b',64),80000,82,91,1,1,
    now()+interval '4 hours',now()+interval '4 days',now());
  if v_result->>'reason'<>'reserved' then raise exception 'Second reservation after settlement failed'; end if;
  v_result:=public.settle_evolution_lab_subscription_call(v_mission,v_job,v_call_two,null);
  if v_result->>'reason'<>'usage-unknown-paused' then raise exception 'Unknown usage did not pause budget'; end if;
  v_result:=public.reserve_evolution_lab_subscription_call(
    v_mission,v_job,v_call_three,repeat('c',64),1000,82,91,1,1,
    now()+interval '4 hours',now()+interval '4 days',now());
  if v_result->>'reason'<>'budget-inactive' then raise exception 'Paused budget accepted a further call'; end if;

  v_result:=public.cancel_evolution_lab_subscription_budget(v_mission,v_job);
  if v_result->>'reason'<>'cancelled' then raise exception 'Budget cancellation failed'; end if;
  select * into v_budget from public.evolution_lab_subscription_budgets where mission_id=v_mission;
  if v_budget.calls_used<>2 or v_budget.spent_tokens<>32000
    or v_budget.held_tokens<>80000 or v_budget.status<>'cancelled' then
    raise exception 'Subscription token ledger counters are incorrect';
  end if;

  insert into public.missions(id,schema_version,revision,stage,status,payload,created_at,updated_at)
  values(v_overrun_mission,'mission-v1',0,'target','idle',
    jsonb_build_object('id',v_overrun_mission,'stage','target','campaign',jsonb_build_object('status','idle')),now(),now());
  insert into public.jobs(id,mission_id,schema_version,type,status,label,idempotency_key,generation,attempts,priority,created_at,updated_at)
  values(v_overrun_job,v_overrun_mission,'job-v1','campaign','queued','P3-M token overrun',
    'workflow-control:'||v_overrun_mission||':fixture',1,0,70,now(),now());
  v_result:=public.initialize_evolution_lab_subscription_budget(
    v_overrun_mission,v_overrun_job,6,300000,now()+interval '15 minutes',50,50);
  if v_result->>'reason'<>'enrolled' then raise exception 'Overrun budget enrollment failed'; end if;
  v_result:=public.reserve_evolution_lab_subscription_call(
    v_overrun_mission,v_overrun_job,v_overrun_call,repeat('d',64),50000,82,91,1,1,
    now()+interval '4 hours',now()+interval '4 days',now());
  if v_result->>'reason'<>'reserved' then raise exception 'Overrun call reservation failed'; end if;
  v_result:=public.settle_evolution_lab_subscription_call(v_overrun_mission,v_overrun_job,v_overrun_call,60000);
  if v_result->>'reason'<>'overspent' then raise exception 'Token overrun was not recorded'; end if;
  select * into v_budget from public.evolution_lab_subscription_budgets where mission_id=v_overrun_mission;
  if v_budget.status<>'overspent' or v_budget.spent_tokens<>60000 or v_budget.held_tokens<>0 then
    raise exception 'Token overrun ledger counters are incorrect';
  end if;

  if has_function_privilege('anon','public.reserve_evolution_lab_subscription_call(text,text,uuid,text,bigint,numeric,numeric,integer,integer,timestamptz,timestamptz,timestamptz)','EXECUTE')
    or has_function_privilege('authenticated','public.reserve_evolution_lab_subscription_call(text,text,uuid,text,bigint,numeric,numeric,integer,integer,timestamptz,timestamptz,timestamptz)','EXECUTE')
    or not has_function_privilege('service_role','public.reserve_evolution_lab_subscription_call(text,text,uuid,text,bigint,numeric,numeric,integer,integer,timestamptz,timestamptz,timestamptz)','EXECUTE')
    or has_table_privilege('anon','public.evolution_lab_subscription_budgets','SELECT')
    or has_table_privilege('authenticated','public.evolution_lab_subscription_calls','SELECT') then
    raise exception 'Subscription budget security boundary is unsafe';
  end if;
end;
$$;
rollback;