import { expect, it } from "vitest";
import { SourceArtifactSchema } from "../schemas";
import { buildRepositoryIntelligence } from "../sources/repository-intelligence";
import { moduleContext } from "./module-context";

it("retrieves indexed files absent from the digest, including dependencies, within budget", () => {
  const entries = [{ path: "src/login.ts", family: "code", content: "目标故障修复", role: "implementation" }, { path: "src/auth.ts", family: "code", content: "依赖认证模块" }];
  const intelligence = buildRepositoryIntelligence({entries,codeAnalyses:[]});
  intelligence.dependencyEdges = [{from:"src/login.ts",to:"src/auth.ts",kind:"internal",importSpec:"./auth"}];
  const source = SourceArtifactSchema.parse({id:"s",name:"app.zip",mimeType:"application/zip",role:"target",artifactKind:"codebase",size:20,inputMode:"upload",extension:"zip",createdAt:"t",textContent:"digest only",structuredContent:{entries,repositoryIntelligence:intelligence}});
  const context = moduleContext(source,"src/login.ts 目标故障",1000)!;
  expect(context.text).toContain("目标故障修复");
  expect(context.text).toContain("依赖认证模块");
  expect(context.text.length).toBeLessThanOrEqual(1000);
  expect(source.textContent).toBe("digest only");
});
