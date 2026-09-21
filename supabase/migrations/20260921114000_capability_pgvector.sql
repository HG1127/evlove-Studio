-- Evolution OS · Organization Capability pgvector / HNSW search
-- Fixed 1536 dimensions match the default OpenAI small embedding profile.
-- Other embedding dimensions remain stored in JSON and safely fall back to lexical ranking.

create extension if not exists vector with schema extensions;

alter table public.organization_capabilities
  add column if not exists embedding_vector extensions.vector(1536);

create index if not exists organization_capabilities_embedding_hnsw_idx
  on public.organization_capabilities
  using hnsw (embedding_vector extensions.vector_cosine_ops)
  where embedding_vector is not null and archived = false;

create or replace function public.match_organization_capabilities(
  p_workspace_id text,
  p_query_embedding extensions.vector(1536),
  p_match_count integer default 100,
  p_reusable_only boolean default false,
  p_statuses text[] default null
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
  order by oc.embedding_vector <=> p_query_embedding
  limit greatest(1, least(coalesce(p_match_count, 100), 500));
$$;

revoke all on function public.match_organization_capabilities(text,extensions.vector,integer,boolean,text[]) from public, anon, authenticated;
grant execute on function public.match_organization_capabilities(text,extensions.vector,integer,boolean,text[]) to service_role;

comment on column public.organization_capabilities.embedding_vector is
  'pgvector(1536) representation used by HNSW nearest-neighbor search; JSON embedding remains for audit/backward compatibility.';
comment on function public.match_organization_capabilities(text,extensions.vector,integer,boolean,text[]) is
  'Server-only nearest-neighbor lookup for organization capability records.';
