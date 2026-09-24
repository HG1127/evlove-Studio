-- Run after 20260924153000. Every test row is rolled back.
begin;

insert into public.artifacts(id,bucket,object_path,mime_type,size_bytes,sha256,metadata)
values('artifact-blob-cleanup-probe','evolution-artifacts','artifacts/artifact-blob-cleanup-probe/blob',
  'text/plain',3,repeat('a',64),'{}'::jsonb);
delete from public.artifacts where id='artifact-blob-cleanup-probe';

do $$
begin
  if not exists(select 1 from public.artifact_retention_tombstones
    where artifact_id='artifact-blob-cleanup-probe' and blob_deleted_at is null) then
    raise exception 'Pending Artifact blob cleanup tombstone missing';
  end if;
  begin
    insert into public.artifacts(id,bucket,object_path,mime_type,size_bytes,sha256,metadata)
    values('artifact-blob-cleanup-new-id','evolution-artifacts','artifacts/artifact-blob-cleanup-probe/blob',
      'text/plain',3,repeat('b',64),'{}'::jsonb);
    raise exception 'Expected retired Artifact path to be rejected';
  exception when others then
    if sqlerrm <> 'ARTIFACT_PATH_RETIRED' then raise; end if;
  end;
end;
$$;

set local role service_role;
select artifact_id from public.artifact_retention_tombstones
  where artifact_id='artifact-blob-cleanup-probe';
update public.artifact_retention_tombstones set blob_deleted_at=now()
  where artifact_id='artifact-blob-cleanup-probe' and blob_deleted_at is null;
do $$
begin
  if not exists(select 1 from public.artifact_retention_tombstones
    where artifact_id='artifact-blob-cleanup-probe' and blob_deleted_at is not null) then
    raise exception 'Service role could not record blob cleanup';
  end if;
end;
$$;
reset role;

do $$
begin
  if has_column_privilege('service_role','public.artifact_retention_tombstones','artifact_id','UPDATE')
    or has_column_privilege('service_role','public.artifact_retention_tombstones','object_path','UPDATE') then
    raise exception 'Service role can mutate retired Artifact identity';
  end if;
  if has_table_privilege('anon','public.artifact_retention_tombstones','SELECT')
    or has_table_privilege('authenticated','public.artifact_retention_tombstones','SELECT') then
    raise exception 'Tombstones are exposed to browser roles';
  end if;
end;
$$;

rollback;
