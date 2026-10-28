// 覆盖模型名合理性过滤、中转地址纠错与连接读取清理：
// 误敲片段（「g」「gp」）不能进模型列表 / 测通记录，粘了接口尾巴的地址要能自动纠正。
import { afterEach, describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "./byok";
import { noteRouteFailure, resetModelHealth } from "./model-health";
import {
  isPlausibleModelId,
  listProviderConnections,
  resolveOperationConnections,
  resolveProjectOperationConnections,
  saveProviderConnections,
  type ProviderConnection,
} from "./registry";

function makeConnection(over: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: "conn-1",
    providerId: "custom",
    label: "中继",
    enabled: true,
    apiKey: "k",
    baseUrl: "https://relay.example/v1",
    defaultModel: "glm-4.7",
    models: ["glm-4.7"],
    createdAt: "t",
    updatedAt: "t",
    ...over,
  };
}

afterEach(() => {
  localStorage.clear();
  resetModelHealth();
});

describe("isPlausibleModelId", () => {
  it("rejects typing fragments", () => {
    for (const fragment of ["", "  ", "g", "gp", "G", "GP", "gpt", "GPT"]) {
      expect(isPlausibleModelId(fragment)).toBe(false);
    }
  });
  it("accepts real model ids including digit short names", () => {
    for (const id of ["o3", "gpt-4o", "glm-4.7", "openrouter/auto", "muse-spark-1.3-contributor-free"]) {
      expect(isPlausibleModelId(id)).toBe(true);
    }
  });
});

describe("normalizeBaseUrl", () => {
  it("strips pasted endpoint tails", () => {
    expect(normalizeBaseUrl("https://x.ai/v1/chat/completions")).toBe("https://x.ai/v1");
    expect(normalizeBaseUrl("https://opencode.ai/zen/v1/responses")).toBe("https://opencode.ai/zen/v1");
    expect(normalizeBaseUrl("https://x.ai/v1/models/")).toBe("https://x.ai/v1");
  });
  it("keeps root addresses usable", () => {
    expect(normalizeBaseUrl("https://x.ai/v1")).toBe("https://x.ai/v1");
    expect(normalizeBaseUrl("https://x.ai/")).toBe("https://x.ai");
  });
});

describe("connection read sanitization", () => {
  it("drops fragment tested models and models on read", () => {
    saveProviderConnections([makeConnection({ testedModels: ["g", "gp", "glm-4.7"], models: ["g", "glm-4.7"] })]);
    const conn = listProviderConnections()[0];
    expect(conn?.testedModels).toEqual(["glm-4.7"]);
    expect(conn?.models).toContain("glm-4.7");
    expect(conn?.models).not.toContain("g");
  });

  it("falls back from a fragment default model to tested-pass on read", () => {
    saveProviderConnections([makeConnection({ defaultModel: "g", testedModels: ["glm-4.7-air"], models: ["glm-4.7"] })]);
    expect(listProviderConnections()[0]?.defaultModel).toBe("glm-4.7-air");
  });

  it("puts tested-pass models in the same-connection fallback chain", () => {
    saveProviderConnections([makeConnection({ testedModels: ["glm-4.7-air", "glm-4.7"] })]);
    const chain = resolveOperationConnections("plan").map((item) => item.model);
    expect(chain[0]).toBe("glm-4.7");
    expect(chain.slice(0, 3)).toContain("glm-4.7-air");
  });
});

describe("project node model overrides", () => {
  it("keeps paired scoring on the explicitly selected judge instead of the generator",()=>{
    saveProviderConnections([makeConnection({id:"primary",defaultModel:"glm-4.7",testedModels:["glm-4.7"]}),makeConnection({id:"judge",defaultModel:"glm-4-flash",testedModels:["glm-4-flash"]})]);
    const profile={mode:"project" as const,primary:{connectionId:"primary",model:"glm-4.7",label:"生成"},judge:{connectionId:"judge",model:"glm-4-flash",label:"评审"}};
    expect(resolveProjectOperationConnections("evaluate-paired",profile)[0]?.model).toBe("glm-4-flash");
    expect(resolveProjectOperationConnections("plan",profile)[0]?.model).toBe("glm-4.7");
  });
  it("only overrides the selected operation and leaves other nodes on their route", () => {
    saveProviderConnections([
      makeConnection({ id: "primary", defaultModel: "glm-4.7", testedModels: ["glm-4.7"] }),
      makeConnection({ id: "diagnosis", defaultModel: "glm-4.7-air", testedModels: ["glm-4.7-air"] }),
    ]);
    const profile = {
      mode: "project" as const,
      primary: { connectionId: "primary", model: "glm-4.7", label: "主模型" },
      operationRoutes: { diagnose: { connectionId: "diagnosis", model: "glm-4.7-air", label: "诊断模型" } },
    };
    expect(resolveProjectOperationConnections("diagnose", profile)[0]?.model).toBe("glm-4.7-air");
    expect(resolveProjectOperationConnections("plan", profile)[0]?.model).toBe("glm-4.7");
  });
  it("always attempts the explicitly selected node model before healthy fallbacks", () => {
    saveProviderConnections([makeConnection({ id: "judge", defaultModel: "glm-4-flash", testedModels: ["glm-4-flash", "agnes-3.0-flash"], modelLatency: { "agnes-3.0-flash": 1000, "glm-4-flash": 5000 } })]);
    noteRouteFailure("judge", "glm-4-flash"); noteRouteFailure("judge", "glm-4-flash");
    const profile = { mode: "project" as const, judge: { connectionId: "judge", model: "glm-4-flash", label: "独立评审" } };
    expect(resolveProjectOperationConnections("evaluate", profile)[0]?.model).toBe("glm-4-flash");
  });
});
