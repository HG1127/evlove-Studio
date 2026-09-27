import { afterEach, describe, expect, it } from "vitest";
import { OPERATION_PROFILES } from "./performance";
import { EvaluateAiResultSchema } from "./schemas";
import { getAiProviderStatus, outputTokenBudgetForOperation, reasoningEffortForOperation, resolveFallbackAiProvider, routedOperationDeadlineMs, selectDiverseAiRoutes, withProjectAiProfile } from "./service";
import { saveProviderConnections, type ProviderConnection } from "./providers/registry";

afterEach(() => localStorage.clear());

describe("browser AI fallback truthfulness",()=>{
  it("fails closed in Production when auto mode has no live provider",()=>{
    expect(resolveFallbackAiProvider({requested:"auto",hasOpenAI:false,production:true})).toBe("unavailable");
  });

  it("keeps Demo explicit and preserves local development convenience",()=>{
    expect(resolveFallbackAiProvider({requested:"demo",hasOpenAI:false,production:true})).toBe("demo");
    expect(resolveFallbackAiProvider({requested:"auto",hasOpenAI:false,production:false})).toBe("demo");
    expect(resolveFallbackAiProvider({requested:"auto",hasOpenAI:true,production:true})).toBe("openai");
  });
});

describe("real AI route time budgets", () => {
  it("does not reserve an artifact-sized output window for problem analysis", () => {
    expect(outputTokenBudgetForOperation("problem-analysis")).toBe(6000);
    expect(outputTokenBudgetForOperation("build-candidate")).toBe(24000);
  });

  it("gives both plan routes their full call budget plus a bounded JSON correction", () => {
    const profile = OPERATION_PROFILES.plan;
    const deadline = routedOperationDeadlineMs("plan", 2);

    // A first slow model must not leave the configured fallback with only a few seconds.
    expect(deadline).toBeGreaterThan(profile.timeoutMs * 2);
    expect(deadline).toBeLessThanOrEqual(300_000);
  });

  it("gives build-candidate one bounded schema-repair attempt before abandoning a real route", () => {
    const profile = OPERATION_PROFILES["build-candidate"];
    expect(profile.schemaRetries).toBe(1);
    expect(routedOperationDeadlineMs("build-candidate", 2)).toBeGreaterThan(profile.timeoutMs * 2);
    expect(routedOperationDeadlineMs("build-candidate", 2)).toBeLessThanOrEqual(300_000);
  });

  it("does not expand the budget past the configured route count", () => {
    expect(routedOperationDeadlineMs("plan", 9)).toBe(routedOperationDeadlineMs("plan", 2));
  });

  it("uses a tested cross-provider fallback before another model on a limited account", () => {
    const routes = [
      { id: "a-primary", connection: { id: "agens", lastTestStatus: "ok" as const } },
      { id: "a-fallback", connection: { id: "agens", lastTestStatus: "ok" as const } },
      { id: "b-tested", connection: { id: "router", lastTestStatus: "ok" as const } },
    ];
    expect(selectDiverseAiRoutes(routes, 2).map((route) => route.id)).toEqual(["a-primary", "b-tested"]);
  });

  it("uses an alternative with a previously tested model even if its current default-model check failed", () => {
    const routes = [
      { id: "a-primary", connection: { id: "agens", lastTestStatus: "ok" as const } },
      { id: "a-fallback", connection: { id: "agens", lastTestStatus: "ok" as const } },
      { id: "b-tested", connection: { id: "router", lastTestStatus: "error" as const, testedModels: ["working-model"] } },
    ];
    expect(selectDiverseAiRoutes(routes, 2).map((route) => route.id)).toEqual(["a-primary", "b-tested"]);
  });
});

describe("adaptive reasoning effort", () => {
  it("uses medium reasoning for small documents and keeps deep reasoning for code", () => {
    expect(reasoningEffortForOperation("plan", { project:{ sourceArtifacts:[{ artifactKind:"document", mimeType:"text/plain", textContent:"short" }] } })).toBe("medium");
    expect(reasoningEffortForOperation("plan", { project:{ sourceArtifacts:[{ artifactKind:"codebase", repositoryIntelligence:{ dependencyEdges:[] } }] } })).toBe("high");
    expect(reasoningEffortForOperation("evaluate-population", { project:{ sourceArtifacts:[{ artifactKind:"document" }] } })).toBe("low");
  });
});

describe("project-scoped route propagation", () => {
  it("uses the current project next-queue override instead of the global/default model", () => {
    const connection: ProviderConnection = {
      id: "minimax-project",
      providerId: "custom",
      label: "自定义中转",
      enabled: true,
      apiKey: "test-key",
      baseUrl: "https://relay.example/v1",
      defaultModel: "MiniMax-M3",
      models: ["MiniMax-M3", "MiniMax-M2.7-highspeed"],
      testedModels: ["MiniMax-M3", "MiniMax-M2.7-highspeed"],
      lastTestStatus: "ok",
      createdAt: "t",
      updatedAt: "t",
    };
    saveProviderConnections([connection]);
    const projectAiProfile = {
      mode: "project" as const,
      primary: { connectionId: connection.id, model: "MiniMax-M3", label: "默认" },
      operationRoutes: {
        "next-queue": { connectionId: connection.id, model: "MiniMax-M2.7-highspeed", label: "当前节点" },
      },
    };
    const payload = withProjectAiProfile({ project: { goal: "生成下一轮建议" } }, projectAiProfile);
    const status = getAiProviderStatus("next-queue", payload);
    expect(status.model).toBe("MiniMax-M2.7-highspeed");
    expect(status.connectionId).toBe(connection.id);
  });
});

describe("evaluation output contract", () => {
  it("accepts numeric strings and lowercase safety when criterion/case judgements are present", () => {
    expect(EvaluateAiResultSchema.parse({ accuracy:"92", evidence:"88", riskCoverage:"80", completeness:"90", safety:"pass", cases:[], criteria:[] })).toMatchObject({ accuracy:92, evidence:88, safety:"PASS", notes:[], failures:[], cases:[], criteria:[] });
  });

  it("rejects a structurally incomplete evaluation so the provider layer can repair/fallback instead of creating a permanent unverified loop", () => {
    expect(() => EvaluateAiResultSchema.parse({ accuracy:92, evidence:88, riskCoverage:80, completeness:90, safety:"PASS" })).toThrow();
  });
});
