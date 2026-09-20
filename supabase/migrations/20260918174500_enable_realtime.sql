-- Evolution OS V1 · P0-2 Realtime
-- Enable Postgres Changes for the production projection tables.

alter table public.missions replica identity full;
alter table public.jobs replica identity full;
alter table public.events replica identity full;
alter table public.artifacts replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['missions','jobs','events','artifacts']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
