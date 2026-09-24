-- Run after 20260924120000. All fixtures and tombstones are rolled back.
begin;

insert into public.artifacts(id,bucket,object_path,mime_type,size_bytes,sha256,metadata)
values
  ('artifact-retention-test-bound','evolution-artifacts','artifacts/artifact-retention-test-bound/test','text/plain',3,repeat('a',64),'{}'::jsonb),
  ('artifact-retention-test-scratch','evolution-artifacts','artifacts/artifact-retention-test-scratch/test','text/plain',3,repeat('b',64),'{}'::jsonb);

insert into public.evidence_ledger(
  id,workspace_id,mission_id,sequence,kind,source,actor,artifact_refs,content_hash,chain_hash
) values (
  'artifact-retention-test-bound-evidence','artifact-retention-test-workspace',
  'artifact-retention-test-mission',1,'test','integration','test',
  '["artifact-retention-test-bound"]'::jsonb,repeat('c',64),repeat('d',64)
);

do $$
begin
  begin
    delete from public.artifacts where id='artifact-retention-test-bound';
    raise exception 'Expected Evidence-bound Artifact deletion to fail';
  exception when others then
    if sqlerrm <> 'ARTIFACT_EVIDENCE_REFERENCED' then raise; end if;
  end;

  delete from public.artifacts where id='artifact-retention-test-scratch';
  if not found then raise exception 'Scratch Artifact deletion did not happen'; end if;
  if not exists(select 1 from public.artifact_retention_tombstones where artifact_id='artifact-retention-test-scratch') then
    raise exception 'Scratch Artifact tombstone missing';
  end if;

  begin
    insert into public.artifacts(id,bucket,object_path,mime_type,size_bytes,sha256,metadata)
    values('artifact-retention-test-scratch','evolution-artifacts','artifacts/artifact-retention-test-scratch/reused','text/plain',3,repeat('b',64),'{}'::jsonb);
    raise exception 'Expected retired Artifact ID reuse to fail';
  exception when others then
    if sqlerrm <> 'ARTIFACT_ID_RETIRED' then raise; end if;
  end;

  begin
    insert into public.evidence_ledger(
      id,workspace_id,mission_id,sequence,kind,source,actor,artifact_refs,content_hash,chain_hash
    ) values (
      'artifact-retention-test-retired-evidence','artifact-retention-test-workspace',
      'artifact-retention-test-other-mission',1,'test','integration','test',
      '["artifact-retention-test-scratch"]'::jsonb,repeat('e',64),repeat('f',64)
    );
    raise exception 'Expected Evidence reference to retired Artifact to fail';
  exception when others then
    if sqlerrm <> 'EVIDENCE_ARTIFACT_RETIRED' then raise; end if;
  end;
end;
$$;

-- Existing Evidence can include external hashes or refs outside the Artifact Store.
insert into public.evidence_ledger(
  id,workspace_id,mission_id,sequence,kind,source,actor,artifact_refs,content_hash,chain_hash
) values (
  'artifact-retention-test-external-evidence','artifact-retention-test-workspace',
  'artifact-retention-test-external-mission',1,'test','integration','test',
  '["external-hash-not-in-artifact-store"]'::jsonb,repeat('1',64),repeat('2',64)
);

rollback;

-- Prove the production service role can drive the SECURITY DEFINER tombstone path.
begin;
set local role service_role;
insert into public.artifacts(id,bucket,object_path,mime_type,size_bytes,sha256,metadata)
values('artifact-retention-service-probe','evolution-artifacts','artifacts/artifact-retention-service-probe/test','text/plain',3,repeat('a',64),'{}'::jsonb);
delete from public.artifacts where id='artifact-retention-service-probe';
reset role;
do $$ begin
  if not exists(select 1 from public.artifact_retention_tombstones where artifact_id='artifact-retention-service-probe') then
    raise exception 'Service-role delete did not create tombstone';
  end if;
end; $$;
rollback;
