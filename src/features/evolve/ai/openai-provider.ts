import { serverEnv } from "../runtime/env";
import type { ZodType } from "zod";

export type StructuredSchema = {
  name: string;
  schema: Record<string, unknown>;
};

export type OpenAIMedia = {
  fileIds?: string[];
  imageDataUrls?: string[];
};

type OpenAIResponse = {
  id?: string;
  status?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string } | null;
};

function extractText(response: OpenAIResponse): string {
  if (typeof response.output_text === "string" && response.output_text.length > 0) return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI response did not contain output_text");
}

export async function uploadOpenAIUserFile(file: File): Promise<string> {
  const apiKey = serverEnv.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const body = new FormData();
  body.set("purpose", "user_data");
  body.set("file", file, file.name);
  const response = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    signal: AbortSignal.timeout(Number(serverEnv.EVOLVE_AI_TIMEOUT_MS || "90000")),
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  const json = await response.json() as { id?: string; error?: { message?: string } };
  if (!response.ok || !json.id) throw new Error(json.error?.message || `OpenAI file upload failed: ${response.status}`);
  return json.id;
}

export async function callOpenAIStructured<T>(args: {
  system: string;
  user: string;
  schema: StructuredSchema;
  parser: ZodType<T>;
  media?: OpenAIMedia;
  timeoutMs?: number;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  promptCacheKey?: string;
  maxOutputTokens?: number;
}): Promise<T> {
  const apiKey = serverEnv.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = serverEnv.OPENAI_MODEL || "gpt-5.6-terra";
  const reasoningEffort = args.reasoningEffort || (serverEnv.OPENAI_REASONING_EFFORT as typeof args.reasoningEffort) || "medium";

  const userContent: Array<Record<string, unknown>> = [
    ...(args.media?.fileIds ?? []).map((fileId) => ({ type: "input_file", file_id: fileId })),
    ...(args.media?.imageDataUrls ?? []).map((imageUrl) => ({ type: "input_image", image_url: imageUrl, detail: "auto" })),
    { type: "input_text", text: args.user },
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(args.timeoutMs ?? Number(serverEnv.EVOLVE_AI_TIMEOUT_MS || "90000")),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      ...(args.promptCacheKey ? { prompt_cache_key: args.promptCacheKey } : {}),
      input: [
        { role: "system", content: [{ type: "input_text", text: args.system }] },
        { role: "user", content: userContent },
      ],
      reasoning: { effort: reasoningEffort },
      max_output_tokens: args.maxOutputTokens ?? 12000,
      text: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name: args.schema.name,
          strict: true,
          schema: args.schema.schema,
        },
      },
    }),
  });

  const json = (await response.json()) as OpenAIResponse;
  if (!response.ok) throw new Error(json.error?.message || `OpenAI request failed: ${response.status}`);
  if (json.status && json.status !== "completed") throw new Error(`OpenAI response status: ${json.status}`);

  const text = extractText(json);
  return args.parser.parse(JSON.parse(text));
}
