-- Reopening the exact Mission needs the same complete-row read budget as paging.
create function public.read_evolution_mission_envelope(p_mission_id text)
returns setof public.missions
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '45s'
as $$
  select mission.* from public.missions as mission
  where mission.id = p_mission_id
  limit 1;
$$;

alter function public.read_evolution_mission_envelope(text) owner to postgres;
revoke all on function public.read_evolution_mission_envelope(text)
  from public, anon, authenticated;
grant execute on function public.read_evolution_mission_envelope(text) to service_role;
comment on function public.read_evolution_mission_envelope(text) is
  'Backend-only exact complete Mission lookup; unchanged payload and revision, at most one row, 45s statement budget.';
notify pgrst, 'reload schema';
