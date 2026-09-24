-- Run after 20260924113000 in the SQL editor. Every fixture is rolled back.
begin;

insert into public.artifacts(id,bucket,object_path,mime_type,size_bytes,sha256,metadata)
values
  ('artifact-identity-test-bound','evolution-artifacts','artifacts/artifact-identity-test-bound/test','text/plain',3,repeat('a',64),'{}'::jsonb),
  ('artifact-identity-test-evidence','evolution-artifacts','artifacts/artifact-identity-test-evidence/test','text/plain',3,repeat('b',64),'{}'::jsonb),
  ('artifact-identity-test-scratch','evolution-artifacts','artifacts/artifact-identity-test-scratch/test','text/plain',3,repeat('c',64),'{}'::jsonb);

do $$
begin
  begin
    update public.artifacts set sha256=repeat('d',64) where id='artifact-identity-test-bound';
    raise exception 'Expected Artifact identity change to fail';
  exception when others then
    if sqlerrm <> 'ARTIFACT_IDENTITY_IMMUTABLE' then raise; end if;
  end;

  update public.artifacts set mission_id='artifact-identity-test-mission'
  where id='artifact-identity-test-bound';
  begin
    update public.artifacts set mission_id='different-mission' where id='artifact-identity-test-bound';
    raise exception 'Expected Mission binding change to fail';
  exception when others then
    if sqlerrm <> 'ARTIFACT_MISSION_BINDING_IMMUTABLE' then raise; end if;
  end;
  begin
    delete from public.artifacts where id='artifact-identity-test-bound';
    raise exception 'Expected Mission-bound Artifact deletion to fail';
  exception when others then
    if sqlerrm <> 'ARTIFACT_MISSION_BOUND' then raise; end if;
  end;

  update public.artifacts set metadata='{"jobId":"job-one","kind":"source"}'::jsonb
  where id='artifact-identity-test-scratch';
  begin
    update public.artifacts set metadata='{"jobId":"job-two","kind":"source"}'::jsonb
    where id='artifact-identity-test-scratch';
    raise exception 'Expected Job binding change to fail';
  exception when others then
    if sqlerrm <> 'ARTIFACT_JOB_BINDING_IMMUTABLE' then raise; end if;
  end;
end;
$$;

insert into public.evidence_ledger(
  id,workspace_id,mission_id,sequence,kind,source,actor,artifact_refs,content_hash,chain_hash
) values (
  'artifact-identity-test-evidence-row','artifact-identity-test-workspace',
  'artifact-identity-test-mission',1,'test','integration','test',
  '["artifact-identity-test-evidence"]'::jsonb,repeat('e',64),repeat('f',64)
);

do $$
begin
  begin
    delete from public.artifacts where id='artifact-identity-test-evidence';
    raise exception 'Expected Evidence-referenced Artifact deletion to fail';
  exception when others then
    if sqlerrm <> 'ARTIFACT_EVIDENCE_REFERENCED' then raise; end if;
  end;
  delete from public.artifacts where id='artifact-identity-test-scratch';
  if found is false then raise exception 'Scratch Artifact deletion did not happen'; end if;
end;
$$;

rollback;
