-- Minimal Supabase platform DDL for an EMPTY, DISPOSABLE vanilla PostgreSQL test database.
-- Public application tables and RPCs are created by the real migrations, without substitutes.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create publication supabase_realtime;
create schema storage;
create schema extensions;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
create table storage.objects(id uuid primary key,bucket_id text);
create extension if not exists pgcrypto with schema extensions;
