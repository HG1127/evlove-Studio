-- Serialize Workflow Mission commits with cancellation of their exact control Job.
-- The existing Mission revision CAS and optional event transaction remain intact.
create or replace function public.compare_and_swap_control_mission(
  p_id text, p_expected_revision bigint, p_schema_version text,
  p_stage text, p_status text, p_payload jsonb,
  p_created_at timestamptz, p_updated_at timestamptz,
  p_control_job_id text, p_control_generation integer, p_event jsonb default null
)
returns table(applied boolean,current_revision bigint,mission jsonb,control_active boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('job:' || p_control_job_id, 0));
  select * into v_job from public.jobs where id=p_control_job_id for update;
  if not found or v_job.mission_id is distinct from p_id
    or v_job.type is distinct from 'campaign'
    or v_job.generation is distinct from p_control_generation
    or p_control_generation is distinct from 1
    or v_job.idempotency_key not like 'workflow-control:%'
    or v_job.status not in ('queued','running','waiting') then
    return query select false,null::bigint,null::jsonb,false;
    return;
  end if;
  if p_event is null then
    return query select r.applied,r.current_revision,r.mission,true
      from public.compare_and_swap_mission(p_id,p_expected_revision,p_schema_version,
        p_stage,p_status,p_payload,p_created_at,p_updated_at) r;
  else
    return query select r.applied,r.current_revision,r.mission,true
      from public.compare_and_swap_mission_with_event(p_id,p_expected_revision,p_schema_version,
        p_stage,p_status,p_payload,p_created_at,p_updated_at,p_event) r;
  end if;
end;
$$;
revoke execute on function public.compare_and_swap_control_mission(text,bigint,text,text,text,jsonb,timestamptz,timestamptz,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.compare_and_swap_control_mission(text,bigint,text,text,text,jsonb,timestamptz,timestamptz,text,integer,jsonb) to service_role;
