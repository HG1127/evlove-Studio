import { describe, expect, it } from "vitest";
import { BACKEND_REQUIREMENTS, EVOLUTION_PHASES, backendRequirementState, deriveEngineReadiness } from "./system-readiness";

describe("system readiness catalog", () => {
  it("covers all 23 workflow nodes exactly once", () => {
    const ids = EVOLUTION_PHASES.flatMap((phase) => {
      const [start, end] = phase.range;
      return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    });
    expect(ids).toEqual(Array.from({ length: 23 }, (_, index) => index + 1));
  });

  it("keeps critical backend gaps explicit", () => {
    const p0 = BACKEND_REQUIREMENTS.filter((item) => item.priority === "P0").map((item) => item.id);
    expect(p0).toEqual(expect.arrayContaining(["control-plane", "git-target", "sandbox", "release"]));
  });

  it("does not report release/build ready without real runner capabilities", () => {
    const engines = deriveEngineReadiness({ runner: { htmlBrowser: true, screenshots: true, e2e: true, build: false, release: false }, visualJudgeLive: true });
    expect(engines.find((item) => item.id === "experiment")?.state).toBe("partial");
    expect(engines.find((item) => item.id === "release")?.state).toBe("backend");
  });

  it("reports the durable control plane and parser as server-ready only with real server signals", () => {
    const signals = {
      visualJudgeLive:false,
      server:{controlPlane:true,dataPlane:true,sourceParse:true,artifactStore:true},
    };
    const controlPlane=BACKEND_REQUIREMENTS.find((item)=>item.id==="control-plane")!;
    expect(backendRequirementState(controlPlane,signals)).toBe("ready");
    const engines=deriveEngineReadiness(signals);
    expect(engines.find((item)=>item.id==="artifact")?.state).toBe("ready");
    expect(engines.find((item)=>item.id==="mission")?.state).toBe("ready");
  });

  it("reports Server Artifact Renderer only from a live server renderer signal",()=>{
    const missing=deriveEngineReadiness({visualJudgeLive:false,server:{artifactRenderer:false}});
    expect(missing.find((item)=>item.id==="artifact-engineering")?.state).toBe("partial");
    const ready=deriveEngineReadiness({visualJudgeLive:false,server:{artifactRenderer:true}});
    expect(ready.find((item)=>item.id==="artifact-engineering")).toMatchObject({
      state:"ready",
      stateLabel:"Server Renderer 已连接",
    });
  });

  it("reports Git Target ready only when the server capability is fully configured",()=>{
    const gitTarget=BACKEND_REQUIREMENTS.find((item)=>item.id==="git-target")!;
    expect(backendRequirementState(gitTarget,{visualJudgeLive:false,server:{git:false}})).toBe("missing");
    expect(backendRequirementState(gitTarget,{visualJudgeLive:false,server:{git:true}})).toBe("ready");
    const engines=deriveEngineReadiness({visualJudgeLive:false,server:{git:true}});
    expect(engines.find((item)=>item.id==="candidate")?.state).toBe("partial");
  });

  it("reports Organization Capability Service ready only with a live Registry",()=>{
    const requirement=BACKEND_REQUIREMENTS.find((item)=>item.id==="capability-service")!;
    expect(backendRequirementState(requirement,{visualJudgeLive:false,server:{capabilityService:false}})).toBe("missing");
    expect(backendRequirementState(requirement,{visualJudgeLive:false,server:{capabilityService:true}})).toBe("ready");
    const base=deriveEngineReadiness({visualJudgeLive:false,server:{capabilityService:true}});
    expect(base.find((item)=>item.id==="learning")?.stateLabel).toBe("组织级 Registry 已连接");
    expect(base.find((item)=>item.id==="learning")?.gap).toContain("Embedding");
    const semantic=deriveEngineReadiness({visualJudgeLive:false,server:{capabilityService:true,capabilitySemantic:true}});
    expect(semantic.find((item)=>item.id==="learning")?.stateLabel).toBe("组织级语义 Registry 已连接");
    expect(semantic.find((item)=>item.id==="learning")?.gap).toContain("Sharing/RBAC");
    const shared=deriveEngineReadiness({visualJudgeLive:false,server:{capabilityService:true,capabilitySemantic:true,capabilitySharing:true}});
    expect(shared.find((item)=>item.id==="learning")?.stateLabel).toBe("组织级语义 Registry + Sharing/RBAC");
    expect(shared.find((item)=>item.id==="learning")?.gap).toContain("跨 workspace federation");
  });

  it("reports Immutable Evidence Ledger ready only when its database and signing health are live",()=>{
    const requirement=BACKEND_REQUIREMENTS.find((item)=>item.id==="evidence-ledger")!;
    expect(backendRequirementState(requirement,{visualJudgeLive:false,server:{evidenceLedger:false}})).toBe("missing");
    expect(backendRequirementState(requirement,{visualJudgeLive:false,server:{evidenceLedger:true}})).toBe("ready");
    const engines=deriveEngineReadiness({visualJudgeLive:false,server:{evidenceLedger:true}});
    expect(engines.find((item)=>item.id==="evidence")?.stateLabel).toBe("不可变账本已连接");
  });

  it("reports production governance ready only when trusted server RBAC is production-safe",()=>{
    const requirement=BACKEND_REQUIREMENTS.find((item)=>item.id==="vault-rbac")!;
    expect(backendRequirementState(requirement,{visualJudgeLive:false,server:{security:false}})).toBe("missing");
    expect(backendRequirementState(requirement,{visualJudgeLive:false,server:{security:true}})).toBe("ready");
    const engines=deriveEngineReadiness({visualJudgeLive:false,server:{security:true}});
    expect(engines.find((item)=>item.id==="governance")?.stateLabel).toBe("Server RBAC 已强制");
    const full=deriveEngineReadiness({visualJudgeLive:false,server:{security:true,vault:true,approvalStore:true}});
    expect(full.find((item)=>item.id==="governance")?.stateLabel).toBe("RBAC + Encrypted Vault + Durable Approval");
    expect(full.find((item)=>item.id==="governance")?.gap).toContain("外部 KMS");
  });

  it("reports External Connector SDK ready only when a full lifecycle connector is configured",()=>{
    const requirement=BACKEND_REQUIREMENTS.find((item)=>item.id==="connectors")!;
    expect(backendRequirementState(requirement,{visualJudgeLive:false,server:{connectors:false}})).toBe("missing");
    expect(backendRequirementState(requirement,{visualJudgeLive:false,server:{connectors:true}})).toBe("ready");
  });

  it("reports Outcome Science only from its own warehouse/analysis health signal",()=>{
    const requirement=BACKEND_REQUIREMENTS.find((item)=>item.id==="outcome-science")!;
    expect(backendRequirementState(requirement,{visualJudgeLive:false,server:{release:true,outcome:false}})).toBe("missing");
    expect(backendRequirementState(requirement,{visualJudgeLive:false,server:{outcome:true}})).toBe("ready");
  });
});
