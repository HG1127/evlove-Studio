// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";

/**
 * Post-consolidation forward migrations must harden their new Lab tables
 * independently; never substitute them for the production security checkpoint.
 */
describe("additive Lab migration table security",()=>{
  const migrationDir=path.resolve(process.cwd(),"supabase/migrations");
  const files=fs.readdirSync(migrationDir).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
  const sql=(file:string)=>fs.readFileSync(path.join(migrationDir,file),"utf8").toLowerCase();
  const productionTail=files.filter(file=>{
    const content=sql(file);
    return content.includes("-- final production security invariants.")
      &&content.includes("create or replace function public.create_evolution_html_campaign_control(");
  }).at(-1);

  it("enforces RLS and a client privilege revoke for every later public table",()=>{
    expect(productionTail).toBeDefined();
    const later=files.filter(file=>file>productionTail!);
    const tables=later.flatMap(file=>[...sql(file).matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)/g)]
      .map(match=>({name:match[1]!,file})));
    expect(tables.length).toBeGreaterThan(0);
    // A later additive migration must not re-open any table or RPC to clients.
    // Strip SQL line comments so documentation text cannot masquerade as GRANT.
    for(const file of later){
      const statements=sql(file).replace(/--[^\n]*/g,"");
      expect(statements).not.toMatch(/\bgrant\s+[^;]*\s+to\s+(?:public|anon|authenticated)\b/);
    }
    for(const {name,file} of tables){
      const creationSql=sql(file);
      expect(creationSql).toContain("alter table public."+name+" enable row level security;");
      const revokePublic=new RegExp("revoke\\s+all(?:\\s+privileges)?\\s+on\\s+(?:table\\s+)?public\\."+name+"\\s+from\\s+public,\\s*anon,\\s*authenticated;");
      expect(creationSql).toMatch(revokePublic);
      const laterSql=later.filter(item=>item>=file).map(sql).join("\n");
      const untrustedGrant=new RegExp("grant\\s+[^;]+\\s+on\\s+(?:table\\s+)?public\\."+name+"\\s+to\\s+(?:public|anon|authenticated)\\b");
      expect(laterSql).not.toMatch(untrustedGrant);
    }
  });
});
