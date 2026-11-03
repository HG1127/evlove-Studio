-- Complete Mission state can exceed PostgREST's inherited 8s query budget.
-- Keep this exception local to a backend-only, bounded read; no row is mutated.
create function public.read_evolution_mission_envelope_page(
  p_after_id text default null,
  p_page_limit integer default 2
)
returns setof public.missions
language sql
stable
security invoker
set search_path = ''
set statement_timeout = '45s'
as $$
  select mission.*
  from public.missions as mission
  where p_after_id is null or mission.id > p_after_id
  order by mission.id asc
  limit least(greatest(coalesce(p_page_limit, 2), 1), 2);
$$;

alter function public.read_evolution_mission_envelope_page(text, integer) owner to postgres;

revoke all on function public.read_evolution_mission_envelope_page(text, integer)
  from public, anon, authenticated;
grant execute on function public.read_evolution_mission_envelope_page(text, integer)
  to service_role;

comment on function public.read_evolution_mission_envelope_page(text, integer) is
  'Backend-only complete Mission pagination; unchanged payload and revision, at most two rows, 45s statement budget.';

notify pgrst, 'reload schema';
