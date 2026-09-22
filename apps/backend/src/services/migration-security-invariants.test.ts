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

  it("removes PUBLIC execution from every externally callable SECURITY DEFINER RPC",()=>{
    const requiredRpcRevokes=[
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
});
