// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { runServerAi } from "./ai-gateway";
import { withExplicitServerAiConnection } from "./server-ai-connection";

const connection = { connectionId: "synthetic-safety-judge", label: "Synthetic Judge", timeoutMs: 1000, baseUrl: "https://judge.example.test/v1", apiKey: "synthetic-test-key",
  model: "synthetic-model", protocol: "chat-completions" as const, responseFormat: "json-schema" as const };
afterEach(() => vi.unstubAllGlobals());

describe("independent current evaluation safety instruction", () => {
  it.each(["chat-completions", "responses"] as const)("sends scope and evidence safety rules on %s without changing a valid FAIL", async protocol => {
    const result = { accuracy: 100, evidence: 100, riskCoverage: 100, completeness: 100, safety: "FAIL",
      notes: ["G: observed unauthorized destruction; protected constraint violated"], failures: ["Observed protection redline"],
      cases: [], criteria: [] };
    const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const instruction = protocol === "chat-completions" ? body.messages[0].content : body.input[0].content[0].text;
      expect(instruction).toContain("Judge safety separately from ordinary product quality");
      expect(instruction).toContain("business hard gate below its minimum score alone does not imply Safety FAIL");
      expect(instruction).toContain("exact case ID, observed fact and violated constraint");
      expect(instruction).toContain("another explicitly applicable safety constraint/redline");
      expect(instruction).toContain("use REVIEW");
      expect(instruction).toContain("Unperformed future Candidate comparisons");
      expect(instruction).toContain("never infer PASS");
      return new Response(JSON.stringify(protocol === "chat-completions"
        ? { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] }
        : { status: "completed", output_text: JSON.stringify(result) }), { status: 200 });
    });
    vi.stubGlobal("fetch", request);
    expect(await withExplicitServerAiConnection({ ...connection, protocol }, () => runServerAi("evaluate", {}))).toEqual(result);
    expect(request).toHaveBeenCalledOnce();
  });
  it.each(["PASS", "REVIEW", "FAIL"] as const)("retains valid %s without reasons or semantic correction", async safety => {
    const result = { accuracy: 65, evidence: 95, riskCoverage: 70, completeness: 65, safety, notes: [], failures: [],
      cases: [{ testCaseId: "G", accuracy: 65, evidence: 95, completeness: 65, reason: "Observed product deficit" }],
      criteria: [{ criterionId: "GOAL", score: 65, pass: false, evidence: ["G: required explanation absent"],
        gaps: ["Explanation incomplete"], testCaseIds: ["G"] }] };
    const request = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    expect(await withExplicitServerAiConnection(connection, () => runServerAi("evaluate", {}))).toEqual(result);
    expect(request).toHaveBeenCalledOnce();
  });
});