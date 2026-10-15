// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { runServerAi, serverAiScoringRouteFingerprint, DIRECT_AI_SCHEMA_RECOVERY_VERSION } from "./ai-gateway";
import { COMPATIBLE_RESPONSES_OUTPUT_VERSION, COMPATIBLE_CHAT_OUTPUT_VERSION, STRUCTURED_AI_FINAL_OUTPUT_VERSION } from "@evolution/adapters";
import { SERVER_SEMANTIC_CONTEXT_VERSION } from "@evolution/harness";
import { HTML_PROTECTION_SETTLEMENT_POLICY } from "@evolution/core";
import { INDEPENDENT_EVALUATION_SAFETY_INSTRUCTION_VERSION } from "./independent-evaluation-safety";
import { minimaxChatFinalOptions, MINIMAX_CHAT_FINAL_CHANNEL_VERSION } from "./minimax-chat-final-channel";
import { withExplicitServerAiConnection } from "./server-ai-connection";

const connection = { connectionId: "minimax-final-fixture", label: "Fixture", apiKey: "fictional-minimax-key",
  baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7-highspeed",
  protocol: "chat-completions" as const, responseFormat: "json-object" as const };
const payload = { project: { goal: "Synthetic structured response", sourceArtifacts: [{ id: "synthetic", textContent: "fixture" }] } };
const result = { intentRestatement: "Synthetic final <think>literal source text</think>", implicitRequirements: [],
  assumptions: [], clarifications: [], acceptanceFocus: [], confidence: 0.9 };
const reasoning = "private synthetic reasoning, never a final result";
function chat(content: string | null, finish = "stop") {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content, reasoning_content: reasoning } }] }));
}
function intercept(reply: (body: Record<string, unknown>, index: number) => Response) {
  const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); requests.push({ url: String(url), init: init!, body });
    return reply(body, requests.length);
  });
  vi.stubGlobal("fetch", fetchMock); return { requests, fetchMock };
}
afterEach(() => vi.unstubAllGlobals());

describe("MiniMax native final-content channel", () => {
  it.each(["api.minimaxi.com", "api.minimax.io", "api.minimax.cn"].flatMap(host =>
    ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"].map(model => ({ host, model }))))(
    "requests native reasoning separation on $host / $model", async ({ host, model }) => {
      const { requests } = intercept(() => chat(JSON.stringify(result)));
      const selected = { ...connection, baseUrl: `https://${host}/v1`, model };
      expect(await withExplicitServerAiConnection(selected, () => runServerAi("understand", payload))).toEqual(result);
      expect(requests).toHaveLength(1); expect(requests[0]!.url).toBe(selected.baseUrl + "/chat/completions");
      expect(requests[0]!.body.reasoning_split).toBe(true); expect(requests[0]!.body.model).toBe(model);
      expect(requests[0]!.body.response_format).toEqual({ type: "json_object" });
      expect((requests[0]!.body.messages as Array<{ content: string }>)[1]!.content).toBe(JSON.stringify(payload));
      expect(requests[0]!.body).not.toHaveProperty("thinking"); expect(requests[0]!.body).not.toHaveProperty("temperature");
    });

  it.each([
    { baseUrl: "https://custom.example.test/v1" }, { baseUrl: "https://api.minimaxi.com.evil.test/v1" },
    { baseUrl: "https://api.minimaxi.com:8443/v1" }, { baseUrl: "https://api.minimaxi.com/proxy/v1" },
    { model: "other-model" }, { baseUrl: "http://api.minimaxi.com/v1" },
  ])("preserves generic OpenAI-compatible requests: %j", async change => {
    const { requests } = intercept(() => chat(JSON.stringify(result)));
    expect(await withExplicitServerAiConnection({ ...connection, ...change }, () => runServerAi("understand", payload))).toEqual(result);
    expect(requests[0]!.body).not.toHaveProperty("reasoning_split");
  });

  it("keeps native separation on the one permitted correction with unchanged input and deadline", async () => {
    const rejected = '{"intentRestatement":"invalid ' + String.fromCharCode(10) + 'json"}';
    const { requests } = intercept((_body, index) => chat(index === 1 ? rejected : JSON.stringify(result)));
    expect(await withExplicitServerAiConnection(connection, () => runServerAi("understand", payload))).toEqual(result);
    expect(requests).toHaveLength(2); expect(requests.every(r => r.body.reasoning_split === true)).toBe(true);
    expect(requests[0]!.url).toBe(requests[1]!.url); expect(requests[0]!.init.signal).toBe(requests[1]!.init.signal);
    const messages = requests.map(r => r.body.messages as Array<{ content: string }>);
    expect(messages[0]![1]!.content).toBe(messages[1]![1]!.content);
    expect(JSON.parse(messages[1]![2]!.content).rejectedFinalText).toBe(rejected);
  });

  it("does not add a Chat-only option to an explicitly selected Responses route", async () => {
    const { requests } = intercept(() => new Response(JSON.stringify({ status: "completed", output_text: JSON.stringify(result) })));
    expect(await withExplicitServerAiConnection({ ...connection, protocol: "responses" }, () => runServerAi("understand", payload))).toEqual(result);
    expect(requests[0]!.url).toBe(connection.baseUrl + "/responses"); expect(requests[0]!.body).not.toHaveProperty("reasoning_split");
  });

  it("keeps invalid completed JSON failed after one correction", async () => {
    const { fetchMock } = intercept(() => chat('{"bad":'));
    await expect(withExplicitServerAiConnection(connection, () => runServerAi("understand", payload)))
      .rejects.toMatchObject({ code: "AI_OUTPUT_INVALID_JSON" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never uses separated reasoning as a substitute for missing final content", async () => {
    const { fetchMock } = intercept(() => chat(null));
    const error = await withExplicitServerAiConnection(connection, () => runServerAi("understand", payload)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain(reasoning); expect(fetchMock).toHaveBeenCalledOnce();
  });
});
function expectedFingerprint(selected: typeof connection | Omit<typeof connection, "protocol"> & { protocol: "responses" }, nativeVersion?: string) {
  return createHash("sha256").update(JSON.stringify({
    route: ["openai-compatible", selected.baseUrl, selected.model, selected.protocol, selected.responseFormat],
    protectionSettlementPolicy: HTML_PROTECTION_SETTLEMENT_POLICY,
    semanticContextVersion: SERVER_SEMANTIC_CONTEXT_VERSION,
    evaluationSafetyInstructionVersion: INDEPENDENT_EVALUATION_SAFETY_INSTRUCTION_VERSION,
    responsesOutputVersion: selected.protocol === "responses" ? COMPATIBLE_RESPONSES_OUTPUT_VERSION : undefined,
    chatOutputVersion: selected.protocol === "chat-completions" ? COMPATIBLE_CHAT_OUTPUT_VERSION : undefined,
    directSchemaInstructionVersion: undefined,
    directSchemaRecoveryVersion: DIRECT_AI_SCHEMA_RECOVERY_VERSION,
    minimaxFinalChannelVersion: nativeVersion,
    finalOutputVersion: STRUCTURED_AI_FINAL_OUTPUT_VERSION,
  })).digest("hex");
}

describe("MiniMax final-channel identity", () => {
  it("versions the affected scoring route so old measurements cannot satisfy the new request policy", async () => {
    const fingerprint = await withExplicitServerAiConnection(connection, serverAiScoringRouteFingerprint);
    expect(fingerprint).toBe(expectedFingerprint(connection, MINIMAX_CHAT_FINAL_CHANNEL_VERSION));
    expect(fingerprint).not.toBe(expectedFingerprint(connection));
  });
  it("preserves the exact existing fingerprint for custom providers and explicit Responses", async () => {
    const custom = { ...connection, baseUrl: "https://custom.example.test/v1" };
    const responses = { ...connection, protocol: "responses" as const };
    expect(await withExplicitServerAiConnection(custom, serverAiScoringRouteFingerprint)).toBe(expectedFingerprint(custom));
    expect(await withExplicitServerAiConnection(responses, serverAiScoringRouteFingerprint)).toBe(expectedFingerprint(responses));
  });
  it.each(["https://user:password@api.minimaxi.com/v1", "https://api.minimaxi.com/v1?proxy=1",
    "https://api.minimaxi.com/v1#fragment", "not-a-url"])("does not infer native options for altered endpoints: %s", baseUrl => {
    const selected = { ...connection, baseUrl }, before = structuredClone(selected);
    expect(minimaxChatFinalOptions(selected)).toEqual({}); expect(selected).toEqual(before);
  });
});