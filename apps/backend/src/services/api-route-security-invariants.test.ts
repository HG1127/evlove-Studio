// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import {describe,expect,it} from "vitest";

const routeRoot=path.resolve(process.cwd(),"apps/backend/server/api/evolution");
const middlewarePath=path.resolve(process.cwd(),"apps/backend/server/middleware/evolution-security.ts");

function routeFiles(dir:string,prefix=""):Array<{relative:string;source:string}>{
  const out:Array<{relative:string;source:string}>=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const relative=prefix?prefix+"/"+entry.name:entry.name;
    const absolute=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...routeFiles(absolute,relative));
    else if(/\.(get|post|put|patch|delete)\.ts$/.test(entry.name)){
      out.push({relative:relative.replaceAll("\\","/"),source:fs.readFileSync(absolute,"utf8")});
    }
  }
  return out.sort((a,b)=>a.relative.localeCompare(b.relative));
}

const routes=routeFiles(routeRoot);
const publicRoutes=new Set(["public-readiness.get.ts","build-info.get.ts"]);
const webhookRoutes=new Set(["git-webhook.post.ts","connector-webhook/[id].post.ts"]);
const readOnlyPosts=new Set(["evidence-ledger-export-verify.post.ts","target-observe.post.ts"]);
const dynamicPermissionRoutes=new Set(["connector-action.post.ts","git-action.post.ts"]);

function declaredPermission(route:{relative:string;source:string}){
  const literal=route.source.match(/require(?:Governed)?EvolutionPermission\(event,"([^"]+)"\)/)?.[1];
  if(literal)return literal;
  if(!dynamicPermissionRoutes.has(route.relative))return undefined;
  if(route.relative==="connector-action.post.ts"
    &&route.source.includes("requireGovernedEvolutionPermission(event,connectorOperationPermission(input.operation))")
  )return "dynamic";
  if(route.relative==="git-action.post.ts"
    &&route.source.includes("requireGovernedEvolutionPermission(event,gitActionPermission(input.action))")
  )return "dynamic";
  return undefined;
}

describe("Evolution API route security invariants",()=>{
  it("keeps the middleware bypass allowlist exact and narrow",()=>{
    const middleware=fs.readFileSync(middlewarePath,"utf8");
    expect(middleware).toContain('path==="/api/evolution/public-readiness"');
    expect(middleware).toContain('path==="/api/evolution/build-info"');
    expect(middleware).toContain('path==="/api/evolution/git-webhook"');
    expect(middleware).toContain('/^\\/api\\/evolution\\/connector-webhook\\/[^/]+$/');
    expect(middleware).not.toContain('endsWith("/public-readiness")');
    expect(middleware).not.toContain('includes("/connector-webhook/")');
  });

  it("allows only the bounded passive public endpoints; all other non-webhook routes declare authorization",()=>{
    for(const publicRoute of publicRoutes)expect(routes.some((route)=>route.relative===publicRoute),publicRoute).toBe(true);
    for(const route of routes){
      if(publicRoutes.has(route.relative)){
        expect(declaredPermission(route)).toBeUndefined();
        continue;
      }
      if(webhookRoutes.has(route.relative))continue;
      expect(declaredPermission(route),route.relative).toBeTruthy();
    }
  });

  it("requires ai.execute before the capabilities route performs an active Server AI probe",()=>{
    const route=routes.find((item)=>item.relative==="capabilities.get.ts");
    expect(route).toBeTruthy();
    expect(route!.source).toContain('if(probeAi)await requireGovernedEvolutionPermission(event,"ai.execute")');
  });

  it("requires cryptographic signature verification on every RBAC-bypassed webhook",()=>{
    for(const relative of webhookRoutes){
      const route=routes.find((item)=>item.relative===relative);
      expect(route,relative).toBeTruthy();
      expect(route!.source).toContain("createHmac");
      expect(route!.source).toContain("timingSafeEqual");
      expect(route!.source).toMatch(/signature/i);
      expect(declaredPermission(route!)).toBeUndefined();
    }
  });

  it("does not authorize state-changing routes with reader-only permission",()=>{
    for(const route of routes){
      if(publicRoutes.has(route.relative)||webhookRoutes.has(route.relative)||readOnlyPosts.has(route.relative))continue;
      const method=route.relative.match(/\.(get|post|put|patch|delete)\.ts$/)?.[1];
      if(method==="get")continue;
      expect(declaredPermission(route),route.relative).toBeTruthy();
      expect(declaredPermission(route),route.relative).not.toBe("data.read");
    }
  });
});
