// 覆盖 BYOK 结构化输出的「校验失败 → 自动带错误重试一次」行为。
// fetch 为桩：第一次返回不符合 schema 的 JSON，第二次返回修正后的 JSON。
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callByokStructured, listByokModels, OPENCODE_ZEN_CATALOG, testByokConnection, type ResolvedByok } from "./byok";

const resolved: ResolvedByok = {
  preset: { id: "test", name: "Test Provider", kind: "openai", defaultBaseUrl: "https://example.test/v1", consoleUrl: "", defaultModel: "m", vision: false, cors: "yes", note: "" },
  config: { enabled: true, providerId: "test", apiKey: "k", model: "m" },
  baseUrl: "https://example.test/v1",
};

const parser = z.object({ answer: z.string(), updatedCommand: z.string().default("") });

function stubResponses(texts: string[]) {
  let index = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    const content = texts[Math.min(index, texts.length - 1)];
    index += 1;
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("byok structured output recovery", () => {
  it("retries once with the validation error and succeeds", async () => {
    stubResponses(['{"wrong": 1}', '{"answer": "已按格式修正", "updatedCommand": "进化该文档专业性"}']);
    const result = await callByokStructured({ resolved, system: "s", user: "u", schema: { name: "command", schema: { type: "object" } }, parser });
    expect(result.answer).toBe("已按格式修正");
    expect(result.updatedCommand).toBe("进化该文档专业性");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("handles markdown-fenced json", async () => {
    stubResponses(['```json\n{"answer": "ok"}\n```']);
    const result = await callByokStructured({ resolved, system: "s", user: "u", schema: { name: "t", schema: { type: "object" } }, parser });
    expect(result.answer).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("remembers the first working response format and skips probing on later calls", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
    });
    const seenFormats: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { response_format?: { type?: string } };
      seenFormats.push(body.response_format?.type ?? "none");
      if (body.response_format?.type === "json_schema") {
        return { ok: false, status: 400, json: async () => ({ error: { message: "json_schema not supported" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"answer": "ok"}' } }] }) };
    }));
    const call = () => callByokStructured({ resolved, system: "s", user: "u", schema: { name: "t", schema: { type: "object" } }, parser });
    await call();
    expect(seenFormats).toEqual(["json_schema", "json_object"]);
    await call();
    // 第二次调用应直接命中缓存的 json_object，不再探测 strict
    expect(seenFormats).toEqual(["json_schema", "json_object", "json_object"]);
  });

  it("recovers from JSON truncated mid-object", async () => {
    stubResponses(['{"answer": "被 max_tokens 截断的回答"']);
    const result = await callByokStructured({ resolved, system: "s", user: "u", schema: { name: "t", schema: { type: "object" } }, parser });
    expect(result.answer).toBe("被 max_tokens 截断的回答");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("repairs semicolon separators outside JSON strings without another model call", async () => {
    stubResponses(['{"answer":"ok";"updatedCommand":"继续进化"}']);
    const result = await callByokStructured({ resolved, system: "s", user: "u", schema: { name: "t", schema: { type: "object" } }, parser, schemaRetries: 0 });
    expect(result).toEqual({ answer: "ok", updatedCommand: "继续进化" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws a readable error after a second failure", async () => {
    stubResponses(['{"wrong": 1}', '{"also_wrong": 2}']);
    await expect(callByokStructured({ resolved, system: "s", user: "u", schema: { name: "t", schema: { type: "object" } }, parser }))
      .rejects.toThrow(/未能按约定格式返回/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

// 「测通」判定：200 但正文带错误 / 回空内容都必须判失败，Responses 结构的 output_text 要能识别。
describe("testByokConnection verdict", () => {
  const stubJson = (body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));

  it("fails on 200 with an error body", async () => {
    stubJson({ error: { message: "model not found" } });
    await expect(testByokConnection(resolved)).rejects.toThrow(/model not found/);
  });

  it("fails on 200 with empty reply content", async () => {
    stubJson({ choices: [{ message: { content: "" } }] });
    await expect(testByokConnection(resolved)).rejects.toThrow(/回复内容为空/);
  });

  it("accepts responses-style output_text and measures latency", async () => {
    stubJson({ output_text: "ok" });
    const result = await testByokConnection(resolved);
    expect(result.text).toBe("ok");
    expect(result.latencyMs).toBeGreaterThanOrEqual(1);
  });
});

// 模型清单解析：各家结构差异都要能读出来；读不出时要给明确说法而不是含糊报空。
describe("listByokModels tolerant parsing", () => {
  const stubJson = (body: unknown, status = 200, contentType = "application/json") =>
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status < 400, status, headers: new Headers({ "content-type": contentType }), text: async () => JSON.stringify(body) })));

  it("reads bare arrays, models key and object maps", async () => {
    stubJson(["a-model", "b-model"]);
    await expect(listByokModels(resolved)).resolves.toEqual(["a-model", "b-model"]);
    stubJson({ models: [{ name: "c-model" }] });
    await expect(listByokModels(resolved)).resolves.toEqual(["c-model"]);
    stubJson({ data: { "d-model": { owned_by: "x" } } });
    await expect(listByokModels(resolved)).resolves.toEqual(["d-model"]);
  });

  it("uses the official local catalog for OpenCode Zen because its gateway has no GET /models", async () => {
    const opencode: ResolvedByok = {
      ...resolved,
      preset: { ...resolved.preset, id: "opencode", responsesFirst: true },
    };
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    await expect(listByokModels(opencode)).resolves.toEqual(OPENCODE_ZEN_CATALOG);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("reads nested lists and double-encoded JSON from compatible gateways", async () => {
    stubJson({ result: { data: { items: [{ model: "nested-model" }] } } });
    await expect(listByokModels(resolved)).resolves.toEqual(["nested-model"]);
    stubJson(JSON.stringify({ data: [{ id: "encoded-model" }] }));
    await expect(listByokModels(resolved)).resolves.toEqual(["encoded-model"]);
  });

  it("reports unreadable 200 bodies clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "text/html" }), text: async () => "<html>gateway</html>" })));
    await expect(listByokModels(resolved)).rejects.toThrow(/HTML 网关页/);
  });

  it("guides manual model entry when the list endpoint is missing", async () => {
    stubJson({ error: { message: "not found" } }, 404);
    await expect(listByokModels(resolved)).rejects.toThrow(/没有开放模型清单接口/);
  });

  it("reports JSON object keys when no supported model list exists", async () => {
    stubJson({ success: true, payload: { catalog: [] } });
    await expect(listByokModels(resolved)).rejects.toThrow(/顶层字段：success、payload/);
  });

  it("surfaces a gateway business error returned with HTTP 200", async () => {
    stubJson({ code: 503, message: "catalog temporarily unavailable" });
    await expect(listByokModels(resolved)).rejects.toThrow(/catalog temporarily unavailable/);
  });
});

it("quota failures do not trigger JSON correction", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ok:false,status:403,json:async()=>({error:{message:"Insufficient user quota"}})})));
  await expect(callByokStructured({resolved,system:"s",user:"u",schema:{name:"t",schema:{type:"object"}},parser})).rejects.toThrow(/quota/);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("transport failure during correction is preserved", async () => {
  const mocked = vi.fn().mockResolvedValueOnce({ok:true,status:200,json:async()=>({choices:[{message:{content:'{"wrong":1}'}}]})}).mockResolvedValue({ok:false,status:403,json:async()=>({error:{message:"Insufficient user quota"}})});
  vi.stubGlobal("fetch",mocked);
  await expect(callByokStructured({resolved,system:"s",user:"u",schema:{name:"t",schema:{type:"object"}},parser})).rejects.toThrow(/quota/);
  expect(fetch).toHaveBeenCalledTimes(2);
});
