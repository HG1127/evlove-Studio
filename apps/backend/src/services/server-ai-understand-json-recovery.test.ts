// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { runServerAi } from "./ai-gateway";
import { withExplicitServerAiConnection } from "./server-ai-connection";

const connection = { connectionId: "understand-fixture", label: "Fixture",
  apiKey: "understand-test-key-private", baseUrl: "https://model.example.test/v1",
  model: "chosen-model", protocol: "chat-completions" as const, responseFormat: "json-object" as const };
const payload = { project: { id: "mission-new", goal: "完善原文件中的培训 SOP",
  sourceArtifacts: [{ id: "source-original", textContent: "ORIGINAL-START-" + "完整材料".repeat(2000) + "-ORIGINAL-END" }],
  acceptanceRubric: [{ id: "USER-WORKFLOW-CLOSURE", minScore: 92 }] }, answered: [] };
const result = { intentRestatement: "保留原文件保护项并完善培训 SOP 的操作和验收内容",
  implicitRequirements: ["步骤可执行"], assumptions: [], clarifications: [],
  acceptanceFocus: ["原文件中的培训内容"], confidence: 0.9 };
const rejected = '{"intentRestatement":"private rejected' + String.fromCharCode(10) + 'invalid JSON","confidence":0.9}';
function chat(text: string, finish: string | null = "stop") {
  return new Response(JSON.stringify({ choices: [{ message: { content: text },
    ...(finish ? { finish_reason: finish } : {}) }] }), { status: 200 });
}
afterEach(() => vi.unstubAllGlobals());

describe("completed material understanding JSON recovery", () => {
  it("uses one same-connection correction with complete original and rejected final data", async () => {
    const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init: init!, body: JSON.parse(String(init?.body)) });
      return chat(requests.length === 1 ? rejected : JSON.stringify(result));
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await withExplicitServerAiConnection(connection, () => runServerAi("understand", payload))).toEqual(result);
    expect(requests).toHaveLength(2);
    const bodies = requests.map(request => request.body as { model: string; response_format: unknown;
      messages: Array<{ role: string; content: string }> });
    expect(requests.every(request => request.url === connection.baseUrl + "/chat/completions")).toBe(true);
    expect(requests[0]!.init.headers).toEqual(requests[1]!.init.headers);
    expect(requests[0]!.init.signal).toBe(requests[1]!.init.signal);
    expect(bodies[0]!.model).toBe(bodies[1]!.model);
    expect(bodies[0]!.response_format).toEqual(bodies[1]!.response_format);
    expect(bodies[0]!.messages[1]!.content).toBe(JSON.stringify(payload));
    expect(bodies[1]!.messages[1]!.content).toBe(JSON.stringify(payload));
    expect(JSON.parse(bodies[1]!.messages[2]!.content)).toEqual({
      schemaVersion: "untrusted-rejected-output-v1", failureKind: "unescaped-control", rejectedFinalText: rejected });
  });

  it("also keeps a selected Responses connection for completed JSON correction", async () => {
    const bodies: Array<{ input: Array<{ content: Array<{ text: string }> }> }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(connection.baseUrl + "/responses");
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ status: "completed",
        output_text: bodies.length === 1 ? rejected : JSON.stringify(result) }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await withExplicitServerAiConnection({ ...connection, protocol: "responses" },
      () => runServerAi("understand", payload))).toEqual(result);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.input[1]!.content[0]!.text).toBe(JSON.stringify(payload));
    expect(JSON.parse(bodies[1]!.input[2]!.content[0]!.text).rejectedFinalText).toBe(rejected);
  });

  it("does not send correction when the initial result is already valid", async () => {
    const fetchMock = vi.fn(async () => chat(JSON.stringify(result)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await withExplicitServerAiConnection(connection, () => runServerAi("understand", payload))).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retains failure after one unsuccessful correction without exposing private context", async () => {
    const fetchMock = vi.fn(async () => chat(rejected));
    vi.stubGlobal("fetch", fetchMock);
    const error = await withExplicitServerAiConnection(connection, () => runServerAi("understand", payload))
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "AI_OUTPUT_INVALID_JSON" });
    expect(String(error)).not.toContain("private rejected");
    expect(String(error)).not.toContain(connection.apiKey);
    expect(String(error)).not.toContain("ORIGINAL-START");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["length", null])("does not correct a nonfinal reply: %s", async (finish) => {
    const fetchMock = vi.fn(async () => chat(rejected, finish));
    vi.stubGlobal("fetch", fetchMock);
    await expect(withExplicitServerAiConnection(connection, () => runServerAi("understand", payload))).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects credential-bearing rejected output before a correction request", async () => {
    const fetchMock = vi.fn(async () => chat('{"private":"' + connection.apiKey + '" invalid}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(withExplicitServerAiConnection(connection, () => runServerAi("understand", payload)))
      .rejects.toMatchObject({ code: "AI_OUTPUT_CORRECTION_SECRET_PRESENT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});