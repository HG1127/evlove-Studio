import { describe,expect,it } from "vitest";
import { SandboxValidationRequestSchema } from "@evolution/contracts";
import { safeSandboxCwd,safeSandboxRelativePath,sandboxNetworkPolicy } from "./vercel-sandbox-adapter";

describe("vercel sandbox adapter boundaries",()=>{
  it("blocks path escape and normalizes safe paths",()=>{
    expect(safeSandboxRelativePath("src/app.ts")).toBe("src/app.ts");
    expect(()=>safeSandboxRelativePath("../secret")).toThrow();
    expect(()=>safeSandboxCwd("/etc")).toThrow();
    expect(safeSandboxCwd("packages/app")).toBe("/vercel/sandbox/packages/app");
  });

  it("defaults to deny-all when no network domains are explicitly allowed",()=>{
    expect(sandboxNetworkPolicy([])).toBe("deny-all");
    expect(sandboxNetworkPolicy(["registry.npmjs.org","registry.npmjs.org"])).toEqual({allow:["registry.npmjs.org"]});
  });

  it("validates structured command requests without shell strings",()=>{
    const parsed=SandboxValidationRequestSchema.parse({
      files:[{path:"package.json",content:"{}"}],
      commands:[{id:"build",phase:"build",command:"npm",args:["run","build"]}],
    });
    expect(parsed.commands[0]?.command).toBe("npm");
    expect(parsed.timeoutMs).toBe(600000);
  });
});
