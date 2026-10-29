// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";

const migrationsDir=path.resolve(process.cwd(),"supabase/migrations");
const migrationFiles=fs.readdirSync(migrationsDir)
  .filter((name)=>/^\d+.*\.sql$/.test(name))
  .sort();
const migrationText=(name:string)=>fs.readFileSync(path.join(migrationsDir,name),"utf8").toLowerCase();
const allSql=migrationFiles.map(migrationText).join("\n");
const tailName=migrationFiles.at(-1)!;
const tailSql=migrationText(tailName);
const artifactTailSql=migrationText("20260924153000_artifact_blob_cleanup_security_invariants.sql");

function createdPublicTables(){
  return [...allSql.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)/g)]
    .map((match)=>match[1]!)
    .filter((name,index,all)=>all.indexOf(name)===index)
    .sort();
}

describe("Supabase production security invariants",()=>{
  it("keeps the final migration as an explicit security-invariants tail",()=>{
    expect(tailName).toMatch(/security_invariants\.sql$/);
    expect(tailSql).toContain("final production security invariants");
    expect(tailSql).toContain("alter default privileges in schema public");
    expect(tailSql).toContain("revoke execute on functions from public, anon, authenticated");
  });

  it("revokes global PUBLIC function defaults and keeps cancellation-fenced CAS service-only",()=>{
    expect(tailSql).toContain("alter default privileges revoke execute on functions from public;");
    const signature="public.compare_and_swap_control_mission(text,bigint,text,text,text,jsonb,timestamptz,timestamptz,text,integer,jsonb)";
    expect(allSql).toContain("create or replace function public.compare_and_swap_control_mission(");
    expect(tailSql).toContain(`revoke execute on function ${signature} from public, anon, authenticated;`);
    expect(tailSql).toContain(`grant execute on function ${signature} to service_role;`);
    expect(tailSql).not.toContain(`grant execute on function ${signature} to public`);
    expect(tailSql).not.toContain(`grant execute on function ${signature} to anon`);
    expect(tailSql).not.toContain(`grant execute on function ${signature} to authenticated`);
  });

  it("guards HTML Campaign starts atomically with a Mission-level lock and service-only RPC",()=>{
    expect(tailSql).toContain("create or replace function public.create_evolution_html_campaign_control(");
    expect(tailSql).toContain("pg_advisory_xact_lock(hashtextextended('html-campaign-start:'||v_mission,0))");
    expect(tailSql).toContain("and status in ('queued','running','waiting')");
    expect(tailSql).toContain("v_active_count=1");
    expect(tailSql).toContain("public.create_evolution_job_idempotent(p_job)");
    expect(tailSql).toContain("return query select false,'mission-active',to_jsonb(v_active)");
    expect(tailSql).toContain("revoke execute on function public.create_evolution_html_campaign_control(jsonb,boolean) from public, anon, authenticated;");
    expect(tailSql).toContain("grant execute on function public.create_evolution_html_campaign_control(jsonb,boolean) to service_role;");
  });
  it("re-hardens every Evolution public table created by migrations",()=>{
    const tables=createdPublicTables();
    expect(tables.length).toBeGreaterThan(0);
    for(const table of tables){
      expect(tailSql).toContain(`alter table public.${table} enable row level security;`);
      expect(tailSql).toContain(`revoke all privileges on table public.${table} from public, anon, authenticated;`);
      expect(tailSql).toContain(`revoke all privileges on table public.${table} from service_role;`);
    }
  });

  it("enforces the Evolution Event ledger as append-only at the database boundary",()=>{
    expect(tailSql).toContain("create or replace function public.prevent_evolution_event_mutation()");
    expect(tailSql).toContain("create trigger evolution_events_immutable_trigger");
    expect(tailSql).toContain("before update or delete on public.events");
    expect(tailSql).toContain("revoke all privileges on table public.events from service_role;");
    expect(tailSql).toContain("grant select, insert on table public.events to service_role;");
    expect(tailSql).not.toContain("grant select, insert, update, delete on table public.events to service_role;");
    expect(tailSql).toContain("revoke execute on function public.prevent_evolution_event_mutation() from public, anon, authenticated;");
  });

  it("serializes Mission compare-and-swap writes and revision-guarded deletes",()=>{
    expect(allSql).toContain("create or replace function public.compare_and_swap_mission(");
    expect(allSql).toContain("create or replace function public.delete_mission_if_revision(");
    expect(allSql).toContain("pg_advisory_xact_lock(hashtextextended('mission:' || p_id, 0))");
    expect(allSql).toContain("v_current.revision <> p_expected_revision");
    expect(tailSql).toContain("grant execute on function public.compare_and_swap_mission(");
    expect(tailSql).toContain("grant execute on function public.delete_mission_if_revision(text,bigint)");
  });

  it("enforces monotonic Job generations, terminal states and generation-bound cancel",()=>{
    expect(allSql).toContain("create or replace function public.put_evolution_job_monotonic(p_job jsonb)");
    expect(allSql).toContain("create or replace function public.cancel_evolution_job_generation(");
    expect(allSql).toContain("pg_advisory_xact_lock(hashtextextended('job:' || v_id, 0))");
    expect(allSql).toContain("v_generation < v_current.generation");
    expect(allSql).toContain("terminal-immutable");
    expect(allSql).toContain("terminal-idempotent");
    expect(allSql).toContain("state-regression");
    expect(allSql).toContain("v_current.generation <> p_expected_generation");
    expect(tailSql).toContain("grant execute on function public.put_evolution_job_monotonic(jsonb) to service_role;");
    expect(tailSql).toContain("grant execute on function public.cancel_evolution_job_generation(text,integer,timestamptz) to service_role;");
  });

  it("binds Workflow run ids to exact Job generations without mutating Job state",()=>{
    expect(allSql).toContain("create or replace function public.bind_evolution_job_workflow_run(");
    expect(allSql).toContain("v_current.generation <> p_expected_generation");
    expect(allSql).toContain("jsonb_build_object('runid',p_run_id)");
    expect(tailSql).toContain("grant execute on function public.bind_evolution_job_workflow_run(text,integer,text,text,timestamptz) to service_role;");
  });

  it("commits Job transitions and Mission checkpoints with Events in one transaction",()=>{
    expect(allSql).toContain("create or replace function public.create_evolution_job_idempotent(");
    expect(allSql).toContain("alter table public.jobs add column if not exists creation_fingerprint text;");
    expect(allSql).toContain("v_current.creation_fingerprint is distinct from v_fingerprint");
    expect(allSql).toContain("create or replace function public.transition_evolution_job_with_event(");
    expect(allSql).toContain("create or replace function public.put_evolution_job_with_event(");
    expect(allSql).toContain("if not p_job ? 'outputref' and v_current.output_ref is not null then");
    expect(allSql).toContain("create or replace function public.cancel_evolution_job_generation_with_event(");
    expect(allSql).toContain("create or replace function public.compare_and_swap_mission_with_event(");
    expect(allSql).toContain("'priorupdatedat'");
    expect(allSql).toContain("insert into public.events(");
    expect(tailSql).toContain("grant execute on function public.transition_evolution_job_with_event(text,integer,jsonb,jsonb) to service_role;");
    expect(tailSql).toContain("grant execute on function public.put_evolution_job_with_event(jsonb,jsonb) to service_role;");
    expect(tailSql).toContain("grant execute on function public.cancel_evolution_job_generation_with_event(text,integer,timestamptz) to service_role;");
    expect(tailSql).toContain("grant execute on function public.compare_and_swap_mission_with_event(text,bigint,text,text,text,jsonb,timestamptz,timestamptz,jsonb) to service_role;");
  });

  it("removes PUBLIC execution from every externally callable SECURITY DEFINER RPC",()=>{
    const requiredRpcRevokes=[
      "public.bind_evolution_job_workflow_run(",
      "public.put_evolution_job_monotonic(",
      "public.cancel_evolution_job_generation(",
      "public.compare_and_swap_mission(",
      "public.delete_mission_if_revision(",
      "public.append_evidence_ledger(",
      "public.evidence_ledger_health()",
      "public.match_organization_capabilities(",
    ];
    for(const rpc of requiredRpcRevokes){
      const at=tailSql.indexOf(`revoke execute on function ${rpc}`);
      expect(at).toBeGreaterThanOrEqual(0);
      const statement=tailSql.slice(at,tailSql.indexOf(";",at)+1);
      expect(statement).toContain("from public, anon, authenticated");
    }
  });

  it("keeps Artifact Storage private and removes legacy anonymous policies",()=>{
    expect(tailSql).toContain("set public=false");
    for(const policy of [
      "evolution_artifacts_anon_select",
      "evolution_artifacts_anon_insert",
      "evolution_artifacts_anon_update",
      "evolution_artifacts_anon_delete",
    ])expect(tailSql).toContain(`drop policy if exists ${policy} on storage.objects;`);
    expect(tailSql).toContain("revoke all privileges on table storage.objects from public, anon, authenticated;");
  });

  it("freezes Artifact identity and blocks deletion of Mission or Evidence-bound metadata",()=>{
    expect(artifactTailSql).toContain("create or replace function public.enforce_evolution_artifact_identity()");
    expect(artifactTailSql).toContain("create trigger evolution_artifact_identity_trigger");
    expect(artifactTailSql).toContain("before insert or update or delete on public.artifacts");
    expect(artifactTailSql).toContain("artifact_identity_immutable");
    expect(artifactTailSql).toContain("artifact_mission_bound");
    expect(artifactTailSql).toContain("artifact_evidence_referenced");
    expect(tailSql).toContain("revoke execute on function public.enforce_evolution_artifact_identity() from public, anon, authenticated;");
  });

  it("serializes Artifact deletion with Evidence appends and retires deleted identities",()=>{
    expect(allSql).toContain("create table if not exists public.artifact_retention_tombstones");
    expect(artifactTailSql).toContain("pg_advisory_xact_lock(hashtextextended('artifact-retention:' || old.id, 0))");
    expect(allSql).toContain("pg_advisory_xact_lock(hashtextextended('artifact-retention:' || v_ref, 0))");
    expect(allSql).toContain("create trigger evolution_evidence_artifact_retention_trigger");
    expect(allSql).toContain("before insert on public.evidence_ledger");
    expect(artifactTailSql).toContain("artifact_id_retired");
    expect(allSql).toContain("evidence_artifact_retired");
    expect(tailSql).toContain("revoke execute on function public.lock_evolution_evidence_artifact_refs() from public, anon, authenticated;");
  });

  it("retains Artifact tombstones while allowing only service-side blob cleanup",()=>{
    expect(artifactTailSql).toContain("add column if not exists blob_deleted_at timestamptz");
    expect(artifactTailSql).toContain("artifact_retention_pending_blob_cleanup_idx");
    expect(artifactTailSql).toContain("'artifact-path:' || new.bucket || '/' || new.object_path");
    expect(artifactTailSql).toContain("'artifact-path:' || old.bucket || '/' || old.object_path");
    expect(artifactTailSql).toContain("artifact_path_retired");
    expect(tailSql).toContain("grant select, update (blob_deleted_at) on table public.artifact_retention_tombstones to service_role;");
    expect(tailSql).not.toContain("grant select, insert,update,delete on table public.artifact_retention_tombstones to service_role;");
  });
});
