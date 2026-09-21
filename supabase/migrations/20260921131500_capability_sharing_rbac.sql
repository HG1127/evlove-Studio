-- Evolution OS · Organization Capability Sharing / RBAC
-- Storage remains service_role-only. This migration adds durable sharing metadata and
-- server-side semantic search filtering; trusted actor authorization stays in the API layer.

alter table public.organization_capabilities
  add column if not exists visibility text not null default 'workspace',
  add column if not exists owner_actor_id text,
  add column if not exists allowed_roles text[] not null default '{}'::text[];

alter table public.organization_capabilities
  drop constraint if exists organization_capabilities_visibility_check;
alter table public.organization_capabilities
  add constraint organization_capabilities_visibility_check
  check (visibility in ('workspace','private','restricted'));

create index if not exists organization_capabilities_access_idx
  on public.organization_capabilities(workspace_id, visibility, owner_actor_id, archived);

create index if not exists organization_capabilities_allowed_roles_gin_idx
  on public.organization_capabilities using gin (allowed_roles);

drop function if exists public.match_organization_capabilities(
  text,extensions.vector,integer,boolean,text[]
);

create or replace function public.match_organization_capabilities(
  p_workspace_id text,
  p_query_embedding extensions.vector(1536),
  p_match_count integer default 100,
  p_reusable_only boolean default false,
  p_statuses text[] default null,
  p_actor_id text default null,
  p_actor_role text default 'service'
)
returns table (
  id text,
  semantic_score double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    oc.id,
    1 - (oc.embedding_vector <=> p_query_embedding) as semantic_score
  from public.organization_capabilities oc
  where oc.workspace_id = p_workspace_id
    and oc.archived = false
    and oc.embedding_vector is not null
    and (not p_reusable_only or oc.reusable = true)
    and (p_statuses is null or oc.lesson_status = any(p_statuses))
    and (
      p_actor_role in ('admin','service')
      or oc.visibility = 'workspace'
      or (p_actor_id is not null and oc.owner_actor_id = p_actor_id)
      or (oc.visibility = 'restricted' and p_actor_role = any(oc.allowed_roles))
    )
  order by oc.embedding_vector <=> p_query_embedding
  limit greatest(1, least(coalesce(p_match_count, 100), 500));
$$;

revoke all on function public.match_organization_capabilities(
  text,extensions.vector,integer,boolean,text[],text,text
) from public, anon, authenticated;
grant execute on function public.match_organization_capabilities(
  text,extensions.vector,integer,boolean,text[],text,text
) to service_role;

comment on column public.organization_capabilities.visibility is
  'workspace: all trusted actors in the workspace; private: owner/admin/service; restricted: owner/admin/service plus allowed_roles.';
comment on column public.organization_capabilities.owner_actor_id is
  'Trusted Evolution actor that owns access-policy changes. Null means server-managed workspace default.';
comment on column public.organization_capabilities.allowed_roles is
  'Additional Evolution roles allowed to read restricted capabilities.';
comment on function public.match_organization_capabilities(
  text,extensions.vector,integer,boolean,text[],text,text
) is 'Server-only HNSW search with workspace + actor sharing/RBAC filtering.';
