import { describe,expect,it } from "vitest";
import { SandboxValidationRequestSchema } from "@evolution/contracts";
import { getVercelSandboxPolicyCapabilities,safeSandboxCwd,safeSandboxRelativePath,sandboxNetworkPolicy } from "./vercel-sandbox-adapter";

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

  it("exposes the exact enforced runtime, network, quota and artifact policy",()=>{
    expect(getVercelSandboxPolicyCapabilities()).toEqual({
      codeReady:true,
      runtimeImage:"vercel/sandbox/universal:latest",
      browserRuntimeVersion:"pw-1.63.0-v5-typed-hover",
      playwrightVersion:"1.63.0",
      ephemeral:true,
      persistent:false,
      network:{
        defaultPolicy:"deny-all",
        installAllowlist:true,
        runtimeAllowlist:true,
        browserExternalRequests:"blocked",
      },
      resources:{
        minVcpus:1,
        maxVcpus:4,
        defaultVcpus:2,
        maxSandboxTimeoutMs:30*60_000,
        maxCommandTimeoutMs:15*60_000,
      },
      archive:{
        maxFiles:2500,
        maxFileBytes:20*1024*1024,
        maxExtractedBytes:100*1024*1024,
        crc32Validation:true,
        reservedPath:".evolution/",
      },
      logs:{maxCharsPerStream:20_000,truncationEnabled:true},
      artifactBinding:{sha256RequiredForCandidates:true,hashReverifiedBeforeExecution:true},
      preview:{defaultPort:4173,healthCheck:true,browserSteps:true,browserSnapshot:true},
    });
  });
});
