-- P3-P: Lab-only forward migration, staged but NOT applied without release authorization.
-- Keep the 2-argument delete RPC for the already deployed Preview. All Mission
-- DELETEs, including legacy calls, are fenced by the BEFORE DELETE trigger.
-- Historical orphan Jobs are untouched and can be terminalized.
create or replace function public.enforce_evolution_job_mission_parent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_parent text;
begin
  if new.mission_id is null then
    if TG_OP='UPDATE' and old.mission_id is not null
      and new.status in ('queued','running','waiting') then
      raise exception using errcode='23503',message='ACTIVE_JOB_MISSION_DETACH_FORBIDDEN';
    end if;
    return new;
  end if;
  -- An orphaned Job may transition to a terminal status; it may not be revived.
  if TG_OP='UPDATE' and new.mission_id is not distinct from old.mission_id
    and new.status not in ('queued','running','waiting') then
    return new;
  end if;
  -- KEY SHARE conflicts with the Mission row's DELETE/FOR UPDATE lock.
  select id into v_parent from public.missions where id=new.mission_id for key share;
  if not found then
    raise exception using errcode='23503',message='JOB_MISSION_NOT_FOUND',
      detail='An active or newly created Mission-bound Job requires a parent Mission';
  end if;
  return new;
end;
$$;
drop trigger if exists evolution_job_mission_parent_trigger on public.jobs;
create trigger evolution_job_mission_parent_trigger
before insert or update of mission_id,status on public.jobs
for each row execute function public.enforce_evolution_job_mission_parent();

create or replace function public.audit_and_guard_mission_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_active_count bigint;
  v_actor_id text;
  v_actor_role text;
  v_deleted_at timestamptz := clock_timestamp();
begin
  select count(*) into v_active_count from public.jobs
  where mission_id=old.id and status in ('queued','running','waiting');
  if v_active_count>0 then
    raise exception using errcode='P0001',message='MISSION_HAS_ACTIVE_JOBS',
      detail='Mission deletion is blocked while active Jobs reference it';
  end if;
  v_actor_id:=coalesce(nullif(current_setting('app.evolution_actor_id',true),''),'unattributed-service-role');
  v_actor_role:=coalesce(nullif(current_setting('app.evolution_actor_role',true),''),'service');
  -- This is an append-only Event audit, NOT a signed Evidence Ledger mirror.
  -- Existing old-preview callers receive the explicitly unattributed fallback.
  insert into public.events(id,mission_id,schema_version,type,source,payload,at)
  values (
    'mission-deleted:'||gen_random_uuid()::text,old.id,'event-v1','MissionDeleted',
    'backend-mission-delete',
    jsonb_build_object('actorId',v_actor_id,'actorRole',v_actor_role,
      'deletedRevision',old.revision,'deletedAt',v_deleted_at),
    v_deleted_at
  );
  return old;
end;
$$;
drop trigger if exists evolution_mission_delete_audit_trigger on public.missions;
create trigger evolution_mission_delete_audit_trigger
before delete on public.missions
for each row execute function public.audit_and_guard_mission_delete();

-- Do NOT drop public.delete_mission_if_revision(text,bigint).
-- The old 2-argument version remains callable by the previous Lab Preview,
-- subject to the same database trigger fencing, with unattributed audit.
create or replace function public.delete_mission_if_revision(
  p_id text,p_expected_revision bigint,p_actor_id text,p_actor_role text
)
returns table(applied boolean,current_revision bigint,blocked_reason text,active_job_count bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_current public.missions%rowtype;
  v_active_count bigint;
  v_prior_actor_id text := current_setting('app.evolution_actor_id',true);
  v_prior_actor_role text := current_setting('app.evolution_actor_role',true);
begin
  if p_expected_revision<0 then raise exception 'expected Mission revision must be non-negative'; end if;
  if nullif(btrim(p_actor_id),'') is null or p_actor_role not in ('admin','operator','service') then
    raise exception 'Mission deletion requires authenticated actor context';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mission:'||p_id,0));
  select * into v_current from public.missions where id=p_id for update;
  if not found then return query select true,null::bigint,null::text,0::bigint; return; end if;
  if v_current.revision<>p_expected_revision then
    return query select false,v_current.revision,'revision-conflict'::text,0::bigint; return;
  end if;
  select count(*) into v_active_count from public.jobs
  where mission_id=p_id and status in ('queued','running','waiting');
  if v_active_count>0 then
    return query select false,v_current.revision,'active-jobs'::text,v_active_count; return;
  end if;
  perform set_config('app.evolution_actor_id',p_actor_id,true);
  perform set_config('app.evolution_actor_role',p_actor_role,true);
  delete from public.missions where id=p_id;
  -- Restore the previous transaction-local context. Otherwise a later legacy
  -- two-argument delete within the same transaction can inherit the actor.
  perform set_config('app.evolution_actor_id',coalesce(v_prior_actor_id,''),true);
  perform set_config('app.evolution_actor_role',coalesce(v_prior_actor_role,''),true);
  return query select true,v_current.revision,null::text,0::bigint;
end;
$$;

revoke execute on function public.enforce_evolution_job_mission_parent() from public,anon,authenticated;
revoke execute on function public.audit_and_guard_mission_delete() from public,anon,authenticated;
revoke execute on function public.delete_mission_if_revision(text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.delete_mission_if_revision(text,bigint,text,text) to service_role;
