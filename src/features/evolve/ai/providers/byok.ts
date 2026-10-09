// BYOK（Bring Your Own Key）供应商接入层：用户自备全球主流 AI 供应商的 API Key，
// 浏览器直连各家官方接口；密钥仅保存在本浏览器 localStorage，只发给所选供应商。
// 全部 13 个 AI 环节沿用 service.ts 的 system + JSON Schema + zod 校验管线。
// JSON 输出可靠性策略：schema 同时写进提示词与 response_format；校验失败自动带错误重试一次。
import {callCompatibleResponses,type CompatibleResponsesFormat} from "@evolution/adapters";
import type { ZodType } from "zod";
import { ZodError } from "zod";

export type ByokKind = "openai" | "anthropic" | "gemini";

export type ByokProviderPreset = {
  id: string;
  name: string;
  kind: ByokKind;
  defaultBaseUrl: string;
  consoleUrl: string;
  defaultModel: string;
  vision: boolean;
  cors: "yes" | "mixed" | "no";
  /** 部分网关只讲 Responses 协议（opencode zen）：测试与调用优先走 /responses。 */
  responsesFirst?: boolean;
  note: string;
};

export const BYOK_PROVIDERS: ByokProviderPreset[] = [
  { id: "anthropic", name: "Anthropic (Claude)", kind: "anthropic", defaultBaseUrl: "https://api.anthropic.com", consoleUrl: "https://console.anthropic.com/settings/keys", defaultModel: "claude-sonnet-5", vision: true, cors: "yes", note: "官方支持网页直连。" },
  { id: "openrouter", name: "OpenRouter（全球模型聚合）", kind: "openai", defaultBaseUrl: "https://openrouter.ai/api/v1", consoleUrl: "https://openrouter.ai/settings/keys", defaultModel: "openrouter/auto", vision: true, cors: "yes", note: "一个 Key 调用全球数百个模型，支持网页直连。注意：模型名填 auto 会随机路由、速度不可控，追求速度请填具体模型（如 deepseek/deepseek-chat）。" },
  { id: "opencode", name: "OpenCode Zen（官方聚合）", kind: "openai", defaultBaseUrl: "https://opencode.ai/zen/v1", consoleUrl: "https://opencode.ai/zen", defaultModel: "muse-spark-1.3-contributor-free", vision: false, cors: "mixed", responsesFirst: true, note: "OpenCode Zen 不开放标准 GET /models；点「同步模型」会加载 Studio 内置的官方模型目录，再用「测试并筛选模型」确认当前 Key 可用项。muse-spark-1.3-contributor-free 需走 Responses 协议，系统已自动适配。" },
  { id: "gemini", name: "Google Gemini", kind: "gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com", consoleUrl: "https://aistudio.google.com/apikey", defaultModel: "gemini-3.7-flash", vision: true, cors: "yes", note: "官方支持网页直连。" },
  { id: "openai", name: "OpenAI", kind: "openai", defaultBaseUrl: "https://api.openai.com/v1", consoleUrl: "https://platform.openai.com/api-keys", defaultModel: "gpt-5.6-terra", vision: true, cors: "no", note: "官方接口通常不允许网页直连；如需 OpenAI 模型，推荐走 OpenRouter，或在下方「中转地址」填一个 OpenAI 格式的可跨域中转。" },
  { id: "deepseek", name: "DeepSeek 深度求索", kind: "openai", defaultBaseUrl: "https://api.deepseek.com", consoleUrl: "https://platform.deepseek.com/api_keys", defaultModel: "deepseek-v4-pro", vision: false, cors: "mixed", note: "以服务端调用为主，网页直连可能受跨域限制，请用「测试连接」验证。" },
  { id: "moonshot", name: "Kimi (Moonshot)", kind: "openai", defaultBaseUrl: "https://api.moonshot.cn/v1", consoleUrl: "https://platform.moonshot.cn/console/api-keys", defaultModel: "kimi-latest", vision: false, cors: "mixed", note: "网页直连可能受跨域限制，请用「测试连接」验证。" },
  { id: "dashscope", name: "通义千问 (阿里云百炼)", kind: "openai", defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", consoleUrl: "https://bailian.console.aliyun.com/?apiKey=1", defaultModel: "qwen-plus", vision: true, cors: "mixed", note: "兼容模式接口；网页直连可能受跨域限制。" },
  { id: "zai", name: "智谱 GLM (Z.ai)", kind: "openai", defaultBaseUrl: "https://api.z.ai/api/paas/v4", consoleUrl: "https://z.ai/manage-apikey/apikey-list", defaultModel: "glm-4.7", vision: true, cors: "mixed", note: "网页直连可能受跨域限制，请用「测试连接」验证。" },
  { id: "xai", name: "xAI (Grok)", kind: "openai", defaultBaseUrl: "https://api.x.ai/v1", consoleUrl: "https://console.x.ai", defaultModel: "grok-4.6", vision: true, cors: "mixed", note: "网页直连可能受跨域限制，请用「测试连接」验证。" },
  { id: "mistral", name: "Mistral AI", kind: "openai", defaultBaseUrl: "https://api.mistral.ai/v1", consoleUrl: "https://console.mistral.ai/api-keys", defaultModel: "mistral-large-latest", vision: true, cors: "yes", note: "官方支持网页直连。" },
  { id: "custom", name: "自定义中转（OpenAI 格式）", kind: "openai", defaultBaseUrl: "", consoleUrl: "", defaultModel: "", vision: false, cors: "yes", note: "任何兼容 OpenAI /chat/completions 的服务都可以：填中转地址 + Key + 模型名即可。" },
];

export type ByokConfig = {
  enabled: boolean;
  providerId: string;
  apiKey: string;
  baseUrl?: string;
  model: string;
};

const STORAGE_KEY = "evolve-studio-byok-v1";

// OpenCode Zen 的模型目录在产品文档 / TUI 中提供，但公开 OpenAI 兼容网关不实现
// GET /models。把官方明确列出的可调用 ID 作为本地目录，避免用户每次同步都得到 404；
// 目录只用于待测候选，实际可用性仍必须由连接测试决定。
export const OPENCODE_ZEN_CATALOG = [
  "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.5-pro",
  "muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.3-contributor-free",
  "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp",
  "minimax-m3", "minimax-m2.7", "minimax-m2.5", "glm-5.3-flash",
];

export function getPreset(id: string): ByokProviderPreset {
  return BYOK_PROVIDERS.find((preset) => preset.id === id) ?? BYOK_PROVIDERS[0]!;
}

export function getByokConfig(): ByokConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ByokConfig>;
    if (typeof parsed?.providerId !== "string" || typeof parsed?.apiKey !== "string") return null;
    return { enabled: Boolean(parsed.enabled), providerId: parsed.providerId, apiKey: parsed.apiKey, baseUrl: parsed.baseUrl, model: parsed.model ?? "" };
  } catch {
    return null;
  }
}

export function saveByokConfig(config: ByokConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearByokConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

export type ResolvedByok = { preset: ByokProviderPreset; config: ByokConfig; baseUrl: string };

// 用户常把「完整调用地址」（…/chat/completions）直接粘进中转地址，而各接口会自行拼接路径，
// 不剥掉后缀就会变成 /chat/completions/chat/completions 这种叠路径，同步 / 测试永远打不中。
export function normalizeBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(chat\/completions|completions|responses|models|v1\/messages|v1beta\/models)$/i, "");
}

export function resolveByok(): ResolvedByok | null {
  const config = getByokConfig();
  if (!config?.enabled || !config.apiKey) return null;
  const preset = getPreset(config.providerId);
  const baseUrl = normalizeBaseUrl(config.baseUrl?.trim() || preset.defaultBaseUrl);
  if (!baseUrl) return null;
  return { preset, config, baseUrl };
}

function errorMessage(status: number, json: unknown): string {
  const record = json as { error?: { message?: string }; message?: string };
  const detail = record?.error?.message || record?.message;
  // 有些聚合服务用 403 表示「预扣费失败 / 余额不足」，而不是 Key 无效。先识别账单
  // 原因，避免用户反复更换正确的 Key 却始终无法恢复调用。
  if (detail && /余额不足|预扣费|insufficient\s*(?:balance|credit|fund)|(?:balance|credit|fund).*insufficient|billing.*(?:failed|insufficient)/i.test(detail)) {
    return `账户可用余额不足，供应商无法预扣本次调用费用（${status}）。${detail}`;
  }
  if (status === 401 || status === 403) return `密钥无效或没有权限（${status}），请检查 API Key。${detail ? ` ${detail}` : ""}`;
  if (status === 429) return `请求被限流或额度不足（429）。${detail ?? ""}`.trim();
  if (detail) return detail;
  return `请求失败（HTTP ${status}）`;
}

function extractJsonBody(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) return body.slice(start, end + 1);
  if (start >= 0) return body.slice(start); // 被截断的输出：只剩开头
  throw new Error("模型没有返回有效 JSON");
}

// 一些 OpenAI-compatible 模型会把 JSON 成员分隔符误写成分号（尤其大对象尾部）。
// 只在字符串之外、且分号明显处在 JSON 分隔位置时修复：下一个 token 是新成员/数组项时改为逗号，
// 下一个 token 已是 ] / } 时直接删除。绝不改字符串内容，修复后还必须通过原生 JSON.parse。
function repairCommonJsonPunctuation(source: string): string | null {
  let output = "";
  let inString = false;
  let escaped = false;
  let changed = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ";") {
      let cursor = index + 1;
      while (cursor < source.length && /\s/.test(source[cursor]!)) cursor += 1;
      const next = source[cursor];
      if (next === "}" || next === "]" || next === undefined) {
        changed = true;
        continue;
      }
      if (next === '"' || next === "{" || next === "[") {
        output += ",";
        changed = true;
        continue;
      }
    }
    output += char;
  }
  if (!changed) return null;
  try {
    JSON.parse(output);
    return output;
  } catch {
    return null;
  }
}

// 输出被 max_tokens 截断时的补救：按括号栈闭合字符串 / 对象 / 数组后再解析。
function repairTruncatedJson(source: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of source) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") stack.push(char);
  }
  if (!stack.length && !inString && !escaped) return null;
  let repaired = escaped ? source.slice(0, -1) : source;
  if (inString) repaired += '"';
  repaired = repaired.replace(/(,|:\s*)$/, "");
  for (let index = stack.length - 1; index >= 0; index -= 1) repaired += stack[index] === "{" ? "}" : "]";
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

function parseJsonBody(text: string): unknown {
  const body = extractJsonBody(text);
  try {
    return JSON.parse(body);
  } catch (firstError) {
    const punctuationRepaired = repairCommonJsonPunctuation(body);
    if (punctuationRepaired) return JSON.parse(punctuationRepaired);
    const truncated = repairTruncatedJson(body);
    if (truncated) {
      const truncatedPunctuationRepaired = repairCommonJsonPunctuation(truncated);
      return JSON.parse(truncatedPunctuationRepaired ?? truncated);
    }
    throw firstError;
  }
}

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("不支持的图片编码");
  return { mimeType: match[1]!, data: match[2]! };
}

// 把「调用超时」和「用户打断」合并成一个信号：暂停一按，在途请求立刻以 AbortError 退出，
// 而不是傻等几十秒超时——打断即时生效的关键。
const callSignal = (args: { timeoutMs?: number; signal?: AbortSignal }): AbortSignal => {
  const timer = AbortSignal.timeout(args.timeoutMs ?? 120_000);
  return args.signal ? AbortSignal.any([timer, args.signal]) : timer;
};

// 先按直连请求；若供应商拒绝浏览器跨域（预检被拦导致 fetch 抛 TypeError），
// 自动改走本地同源转发（开发服务器中转，见 plugins/ai-relay.ts），不改变请求语义。
async function providerFetch(url: string, init: RequestInit, preferRelay = false): Promise<Response> {
  const relay = () => { const headers = new Headers(init.headers); headers.set("x-target-url", url); return fetch("/api/ai-relay", { ...init, headers }); };
  // Known non-CORS providers (notably official OpenAI) should not waste a browser request
  // that can only fail before trying the in-process Vite relay. Mixed/yes providers still
  // attempt direct fetch first to avoid an unnecessary middleware hop.
  if (preferRelay) return relay();
  try { return await fetch(url, init); }
  catch (error) { if (!(error instanceof TypeError)) throw error; return relay(); }
}

const JSON_INSTRUCTION = "Return ONLY one valid JSON object. No markdown fences, no commentary, no explanation.";

// 网关有两类返回结构：/chat/completions 的 choices[].message.content，
// 与 /responses 的 output_text / output[].content[].text。
// 有的服务（如 opencode zen）在 chat 路径上也回 Responses 结构——兼容提取，避免误判「回复为空」。
type ChatLikeJson = {
  error?: { message?: string };
  message?: string;
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  choices?: Array<{
    message?: { content?: string | Array<{ type?: string; text?: string }>; reasoning_content?: string };
    text?: string;
    finish_reason?: string | null;
  }>;
  usage?: { completion_tokens?: number; output_tokens?: number };
};

function extractChatText(json: ChatLikeJson | null | undefined): string {
  if (!json) return "";
  const content = json.choices?.[0]?.message?.content;
  const fromChoices = typeof content === "string"
    ? content.trim()
    : Array.isArray(content)
      ? content.filter((part) => part.type === "text" || part.type === "output_text" || !part.type).map((part) => part.text ?? "").join("").trim()
      : "";
  if (fromChoices) return fromChoices;
  if (json.choices?.[0]?.text?.trim()) return json.choices[0]!.text!.trim();
  if (json.output_text?.trim()) return json.output_text.trim();
  for (const item of json.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text?.trim()) return content.text.trim();
    }
  }
  return "";
}

function emptyChatReplyReason(json: ChatLikeJson): string {
  if (json.error?.message) return `模型返回错误：${json.error.message}`;
  const choice = json.choices?.[0];
  const finish = choice?.finish_reason;
  const outputTokens = json.usage?.completion_tokens ?? json.usage?.output_tokens;
  if (finish === "length") return `响应中没有最终 content（finish_reason=length${outputTokens === undefined ? "" : `，已用输出 tokens=${outputTokens}`}；可能耗尽输出预算）。请缩小构造范围或切换模型。`;
  if (choice?.message?.reasoning_content?.trim()) return "响应只有推理内容，没有最终 content；模型未完成结构化结果。请缩小构造范围或切换模型。";
  return `响应中没有 content 文本${finish ? `（finish_reason=${finish}）` : ""}；请检查模型与中转的返回格式。`;
}

// 部分网关（opencode zen 等）只讲 Responses 协议：供应商标记或用户粘的地址以 /responses 结尾时，以此为协议偏好信号。
function prefersResponsesProtocol(preset: ByokProviderPreset, baseUrl: string | undefined): boolean {
  return preset.responsesFirst === true || /\/responses$/i.test(baseUrl?.trim() ?? "");
}

function schemaBlock(schema: Record<string, unknown>): string {
  return `\n\nYour reply MUST be a single JSON object that validates against this JSON Schema (every required key present, exact key names):\n${JSON.stringify(schema)}`;
}

type StructuredCall = {
  resolved: ResolvedByok;
  system: string;
  user: string;
  schema: { name: string; schema: Record<string, unknown> };
  imageDataUrls: string[];
  correction?: string;
  timeoutMs?: number;
  promptCacheKey?: string;
  maxOutputTokens?: number;
  /** 外部打断信号（暂停/取消）：与超时信号合并后挂到 fetch 上。 */
  signal?: AbortSignal;
};

// ===== OpenAI 官方（Responses API）=====
// GPT-5.6 系列官方通过 Responses API 使用。BYOK 浏览器模式仍可能受到 OpenAI CORS 限制；
// 生产环境可通过自定义后端默认连接直接调用；无需依赖 AI Gateway。
// Compatibility shim: Responses HTTP mechanics live in @evolution/adapters.
async function callOfficialOpenAIResponsesText(args: StructuredCall): Promise<string> {
  const {resolved}=args;
  const note=args.correction
    ?"\n\nYour previous reply failed validation with: "+args.correction+". Reply again with ONLY a corrected JSON object."
    :"";
  const formats:CompatibleResponsesFormat[]=["json-schema","json-object","prompt-json"];
  const cacheKey=JSON.stringify(["responses",resolved.preset.id,resolved.baseUrl,resolved.config.model]);
  const cached=readFormatCache()[cacheKey];
  const result=await callCompatibleResponses({
    baseUrl:resolved.baseUrl,apiKey:resolved.config.apiKey,model:resolved.config.model,
    system:args.system,user:args.user+note,schema:args.schema,imageDataUrls:args.imageDataUrls,
    maxOutputTokens:args.maxOutputTokens??24000,promptCacheKey:args.promptCacheKey,
    verbosity:resolved.preset.id==="openai"?"medium":undefined,
    signal:callSignal(args),preferredFormat:typeof cached==="number"?formats[cached]:undefined,
    request:(url,init)=>providerFetch(url,init,resolved.preset.cors==="no"),errorMessage,
  });
  writeFormatCache(cacheKey,formats.indexOf(result.format));
  return result.text;
}

// ===== OpenAI 兼容（/chat/completions）=====
// JSON 输出按「strict json_schema → json_object → 纯提示词」三级降级，兼容各家差异。

async function openaiKindText(args: StructuredCall & { responseFormat?: unknown }): Promise<string> {
  const { resolved, imageDataUrls } = args;
  const note = args.correction
    ? `\n\nYour previous reply failed validation with: ${args.correction}. Reply again with ONLY a corrected JSON object.`
    : "";
  // schema 已随 system 下发，user 不再重复一份（降低每题输入体积；提示词降级模式同样生效）
  const promptUser = `${args.user}${note}`;
  const content: unknown = imageDataUrls.length
    ? [{ type: "text", text: promptUser }, ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } }))]
    : promptUser;
  const response = await providerFetch(`${resolved.baseUrl}/chat/completions`, {
    method: "POST", signal: callSignal(args),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolved.config.apiKey}` },
    body: JSON.stringify({
      model: resolved.config.model,
      // 节点各自决定输出预算；小 JSON 不应为大型 Artifact 预留同样的 24k tokens。
      max_tokens: args.maxOutputTokens ?? 24000,
      messages: [
        { role: "system", content: `${args.system}\n\n${JSON_INSTRUCTION}${schemaBlock(args.schema.schema)}` },
        { role: "user", content },
      ],
      ...(args.responseFormat ? { response_format: args.responseFormat } : {}),
    }),
  });
  const json = await response.json().catch(() => ({})) as ChatLikeJson;
  if (!response.ok) throw Object.assign(new Error(errorMessage(response.status, json)), { httpStatus: response.status });
  const text = extractChatText(json);
  if (!text) throw new Error(emptyChatReplyReason(json));
  return text;
}

// 记住每个「供应商+模型」第一次成功的 JSON 输出模式（localStorage），
// 之后所有请求直接用它——否则每题都要先吃 1~2 次 400 探测，Baseline 会被拖慢数倍。
const FORMAT_CACHE_KEY = "evolve-studio-byok-format-v1";

function readFormatCache(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FORMAT_CACHE_KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function writeFormatCache(key: string, index: number) {
  try {
    localStorage.setItem(FORMAT_CACHE_KEY, JSON.stringify({ ...readFormatCache(), [key]: index }));
  } catch {
    // 存储不可用时仅失去加速，不影响正确性
  }
}

async function callOpenaiKindText(args: StructuredCall): Promise<string> {
  // 粘的地址以 /responses 结尾、或供应商标记只讲 Responses 协议：优先走 Responses 路径
  if (prefersResponsesProtocol(args.resolved.preset, args.resolved.config.baseUrl)) {
    try {
      return await callOfficialOpenAIResponsesText(args);
    } catch (error) {
      const status = (error as { httpStatus?: number }).httpStatus ?? 0;
      // Only a missing protocol endpoint may switch to Chat; format negotiation stays within Responses.
      if (status !== 404 && status !== 405) throw error;
    }
  }
  const formats: unknown[] = [
    { type: "json_schema", json_schema: { name: args.schema.name, schema: args.schema.schema, strict: true } },
    { type: "json_object" },
    undefined,
  ];
  const cacheKey = `${args.resolved.preset.id}:${args.resolved.config.model}`;
  const cached = readFormatCache()[cacheKey];
  const order = [0, 1, 2];
  if (typeof cached === "number" && cached >= 0 && cached <= 2) {
    order.splice(order.indexOf(cached), 1);
    order.unshift(cached);
  }
  let lastError = new Error("OpenAI 兼容接口请求失败");
  for (const index of order) {
    try {
      const text = await openaiKindText({ ...args, responseFormat: formats[index] });
      writeFormatCache(cacheKey, index);
      return text;
    } catch (error) {
      const status = (error as { httpStatus?: number }).httpStatus ?? 0;
      // 中转只开了 /responses（opencode zen 等）：换 Responses 协议重试
      if (status === 404 || status === 405) return callOfficialOpenAIResponsesText(args);
      // 400 视为「不支持该结构化输出模式」→ 降级重试；其余错误直接上抛
      if (status !== 400) throw error;
      lastError = error instanceof Error ? error : lastError;
    }
  }
  throw lastError;
}

// ===== Anthropic（/v1/messages）=====

async function callAnthropicKindText(args: StructuredCall): Promise<string> {
  const { resolved, imageDataUrls } = args;
  const note = args.correction
    ? `\n\nYour previous reply failed validation with: ${args.correction}. Reply again with ONLY a corrected JSON object.`
    : "";
  const userText = `${args.user}${schemaBlock(args.schema.schema)}${note}`;
  const content: unknown = imageDataUrls.length && resolved.preset.vision
    ? [...imageDataUrls.map((url) => { const { mimeType, data } = parseDataUrl(url); return { type: "image", source: { type: "base64", media_type: mimeType, data } }; }), { type: "text", text: userText }]
    : userText;
  const response = await providerFetch(`${resolved.baseUrl}/v1/messages`, {
    method: "POST", signal: callSignal(args),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": resolved.config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: resolved.config.model,
      max_tokens: args.maxOutputTokens ?? 16000,
      system: `${args.system}\n\n${JSON_INSTRUCTION}${schemaBlock(args.schema.schema)}`,
      messages: [{ role: "user", content }],
    }),
  });
  const json = await response.json().catch(() => ({})) as { error?: { message?: string }; content?: Array<{ type?: string; text?: string }> };
  if (!response.ok) throw new Error(errorMessage(response.status, json));
  const text = (json.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
  if (!text) throw new Error("响应中没有 text 内容");
  return text;
}

// ===== Google Gemini（:generateContent）=====

async function callGeminiKindText(args: StructuredCall): Promise<string> {
  const { resolved, imageDataUrls } = args;
  const note = args.correction
    ? `\n\nYour previous reply failed validation with: ${args.correction}. Reply again with ONLY a corrected JSON object.`
    : "";
  const parts: unknown[] = [];
  if (imageDataUrls.length && resolved.preset.vision) {
    for (const url of imageDataUrls) { const { mimeType, data } = parseDataUrl(url); parts.push({ inline_data: { mime_type: mimeType, data } }); }
  }
  parts.push({ text: `${args.user}${schemaBlock(args.schema.schema)}${note}` });
  const response = await providerFetch(`${resolved.baseUrl}/v1beta/models/${encodeURIComponent(resolved.config.model)}:generateContent`, {
    method: "POST", signal: callSignal(args),
    headers: { "Content-Type": "application/json", "x-goog-api-key": resolved.config.apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: `${args.system}\n\n${JSON_INSTRUCTION}${schemaBlock(args.schema.schema)}` }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  const json = await response.json().catch(() => ({})) as { error?: { message?: string }; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  if (!response.ok) throw new Error(errorMessage(response.status, json));
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  if (!text) throw new Error("响应中没有文本内容（可能被安全过滤拦截）");
  return text;
}

function zodIssueSummary(error: unknown): string {
  if (error instanceof ZodError) {
    const paths = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    return `字段校验失败 → ${paths}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function callByokStructured<T>(args: {
  resolved: ResolvedByok; system: string; user: string;
  schema: { name: string; schema: Record<string, unknown> }; parser: ZodType<T>; imageDataUrls?: string[];
  timeoutMs?: number; schemaRetries?: number; schemaRetryTimeoutMs?: number; promptCacheKey?: string; maxOutputTokens?: number; signal?: AbortSignal;
}): Promise<T> {
  const imageDataUrls = args.resolved.preset.vision ? (args.imageDataUrls ?? []) : [];
  const kindText = async (correction?: string): Promise<string> => {
    // 格式修正只应处理已返回的短 JSON，不应再占用一次完整的深度推理时限；这样备用模型
    // 仍能拿到完整预算，而不是被一次格式修正吞掉整轮时间。
    const timeoutMs = correction ? (args.schemaRetryTimeoutMs ?? args.timeoutMs) : args.timeoutMs;
    const callArgs: StructuredCall = { resolved: args.resolved, system: args.system, user: args.user, schema: args.schema, imageDataUrls, correction, timeoutMs, promptCacheKey: args.promptCacheKey, maxOutputTokens: args.maxOutputTokens, signal: args.signal };
    if (args.resolved.preset.kind === "anthropic") return callAnthropicKindText(callArgs);
    if (args.resolved.preset.kind === "gemini") return callGeminiKindText(callArgs);
    if (args.resolved.preset.id === "openai") return callOfficialOpenAIResponsesText(callArgs);
    return callOpenaiKindText(callArgs);
  };

  // Transport/auth/quota failures are not JSON errors and must never trigger schema repair.
  const firstText = await kindText();
  let firstError: unknown;
  try {
    return args.parser.parse(parseJsonBody(firstText));
  } catch (error) {
    // 用户打断：不做格式修正重试，直接上抛给调用方按「暂停」处理。
    if (args.signal?.aborted) throw error;
    firstError = error;
  }
  const retries = Math.max(0, args.schemaRetries ?? 1);
  if (retries === 0) throw new Error(`所选模型未能按约定格式返回。${zodIssueSummary(firstError)}`, { cause: firstError });
  let lastError = firstError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const correctedText = await kindText(zodIssueSummary(lastError));
    try {
      return args.parser.parse(parseJsonBody(correctedText));
    } catch (error) {
      if (args.signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw new Error(`所选模型未能按约定格式返回（已自动修正 ${retries} 次）。${zodIssueSummary(lastError)}。建议改用指令遵循更强的模型，或降低本次输出体积。`, { cause: lastError });
}

// ===== 模型列表 & 连接测试 =====

// 只保留对话类模型：剔除嵌入 / 语音 / 图像 / 重排等无法用于进化流程的条目。
const NON_CHAT_PATTERN = /(embed|tts|whisper|rerank|speech|audio|transcri|dall|moderation|realtime|ocr|vision-preview$|-image|-audio|\/tts)/i;

function chatOnly(ids: string[]): string[] {
  return ids.filter((id) => !NON_CHAT_PATTERN.test(id)).sort((a, b) => a.localeCompare(b));
}

// 各家供应商 / 中转的模型清单返回结构并不统一：最标准的是 {data:[{id}]}，但也有裸数组、
// {models:[...]}、{result:[...]}、以 model / name 而非 id 命名字段的，
// 甚至 {models:{"模型ID":{...}}} 这种以键为模型名的对象映射——宽容提取，避免误判「获取不到」。
function findModelList(json: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object" || depth > 4) return null;
  const record = json as Record<string, unknown>;
  // 常见兼容结构：data/models/result/items/list，以及 data.items、result.data 等多层包装。
  for (const key of ["data", "models", "result", "items", "list"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    const nested = findModelList(value, depth + 1);
    if (nested) return nested;
    // 模型映射只接受像模型 ID 的键，避免把 error/message 等普通对象误当成模型。
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length && entries.every(([id, item]) => /[-./:\d]/.test(id) && item && typeof item === "object")) return entries.map(([id]) => id);
    }
  }
  return null;
}

async function readModelListResponse(response: Response): Promise<{ json: unknown; contentType: string; preview: string }> {
  const contentType = response.headers?.get?.("content-type") ?? "";
  const text = await response.text();
  const preview = text.replace(/\s+/g, " ").trim().slice(0, 160);
  if (!text.trim()) return { json: null, contentType, preview: "" };
  try {
    let json: unknown = JSON.parse(text);
    // 个别中转把 JSON 再序列化成字符串返回。
    if (typeof json === "string" && /^[{[]/.test(json.trim())) json = JSON.parse(json);
    return { json, contentType, preview };
  } catch {
    return { json: null, contentType, preview };
  }
}

function extractModelEntries(json: unknown): Array<{ id: string; modality?: string }> {
  const list = findModelList(json) ?? [];
  return list
    .map((item) => {
      if (typeof item === "string") return { id: item };
      const entry = item as { id?: unknown; model?: unknown; name?: unknown; architecture?: { modality?: string | null } };
      return { id: String(entry?.id ?? entry?.model ?? entry?.name ?? ""), modality: entry?.architecture?.modality ?? undefined };
    })
    .map((entry) => ({ ...entry, id: entry.id.replace(/^models\//, "").trim() }))
    .filter((entry) => entry.id);
}

export async function listByokModels(resolved: ResolvedByok): Promise<string[]> {
  const { preset, baseUrl, config } = resolved;
  try {
    if (preset.id === "opencode") return [...OPENCODE_ZEN_CATALOG];
    if (preset.kind === "anthropic") {
      const response = await providerFetch(`${baseUrl}/v1/models?limit=1000`, { signal: AbortSignal.timeout(20_000), headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } });
      const json = await response.json().catch(() => ({})) as { data?: Array<{ id: string }> };
      if (!response.ok) throw new Error(errorMessage(response.status, json));
      return chatOnly((json.data ?? []).map((m) => m.id));
    }
    if (preset.kind === "gemini") {
      const response = await providerFetch(`${baseUrl}/v1beta/models?pageSize=200`, { signal: AbortSignal.timeout(20_000), headers: { "x-goog-api-key": config.apiKey } });
      const json = await response.json().catch(() => ({})) as { models?: Array<{ name: string }> };
      if (!response.ok) throw new Error(errorMessage(response.status, json));
      return chatOnly((json.models ?? []).map((m) => m.name.replace(/^models\//, "")));
    }
    const endpoint = `${baseUrl}/models`;
    const response = await providerFetch(endpoint, { signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" } }, preset.cors === "no");
    const { json, contentType, preview } = await readModelListResponse(response);
    if (!response.ok) {
      // 对话接口（/chat/completions）与清单接口（/models）相互独立：不少中转只开前者，
      // 测试能通但清单 404——这时明确给出「手动填模型 ID」的出路，而不是笼统报「请求失败」。
      if (response.status === 404 || response.status === 405) {
        throw new Error(`该服务没有开放模型清单接口（GET /models 返回 ${response.status}），但对话接口可能仍可用：在「模型名称」里直接输入模型 ID 保存即可使用，再用「测试」验证。`);
      }
      throw new Error(errorMessage(response.status, json));
    }
    // 200 但正文不是 JSON / 找不到任何模型数组：说明该服务不支持清单同步，
    // 明确说出来，而不是含糊地报「返回为空」让用户以为出了 bug。
    if (json === null) {
      const kind = /text\/html/i.test(contentType) || /^</.test(preview) ? "HTML 网关页" : preview ? "非 JSON 内容" : "空响应";
      throw new Error(`GET ${new URL(endpoint).pathname} 返回 200，但正文是${kind}，通常是上游网关临时异常或该接口未开放。对话接口与模型清单接口相互独立，已保存和测通的模型仍可使用。`);
    }
    if (!findModelList(json)) {
      const error = json as { error?: { message?: unknown } | string; message?: unknown; msg?: unknown };
      const upstreamMessage = typeof error.error === "string" ? error.error : error.error?.message ?? error.message ?? error.msg;
      if (typeof upstreamMessage === "string" && upstreamMessage.trim()) {
        throw new Error(`模型清单接口返回业务错误：${upstreamMessage.trim()}。这不代表当前模型一定不可调用，可继续使用“测试”检查对话接口。`);
      }
      const keys = json && typeof json === "object" ? Object.keys(json as Record<string, unknown>).slice(0, 8).join("、") : typeof json;
      throw new Error(`GET ${new URL(endpoint).pathname} 返回 JSON，但没有模型数组（顶层字段：${keys || "无"}）。该服务的清单格式暂不兼容；已保存和测通的模型仍可使用。`);
    }
    const entries = extractModelEntries(json);
    // OpenRouter 等聚合服务带箭头式 modality（如 text->text）：能按「输出含 text」收窄就收窄；
    // 写法不标准或收窄后为空时保留全量、交给 chatOnly 按名字过滤，避免误同步成 0 个。
    const arrow = entries.filter((entry) => (entry.modality ?? "").includes("->"));
    const textOut = arrow.filter((entry) => (entry.modality ?? "").includes("->text"));
    const ids = (arrow.length && textOut.length ? textOut : entries).map((entry) => entry.id);
    const filtered = chatOnly(ids);
    // 对话过滤把全部条目都剔掉（命名完全不标准）时保留原列表：有得选好过误报「为空」。
    return filtered.length ? filtered : ids;
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`无法连接模型列表接口（网络受限或跨域被拦）。你可以在「模型名称」框里手动填写模型 ID 后直接保存使用。${preset.note}`, { cause: error });
    throw error;
  }
}

// 部分中转会返回 HTTP 200 但把错误写进body（error / message 字段）、或回空回复：
// 连接测试若不识别这两种情况，跑不通的模型就会被误记成「测通」，在模型列表里挂 ✓。
function assertChatReply(json: unknown, text: string): string {
  const record = json as { error?: { message?: string }; message?: string } | null;
  const detail = record?.error?.message || (typeof record?.message === "string" ? record.message : "");
  if (detail) throw new Error(`服务返回成功状态但正文报错：${detail}`);
  if (!text) throw new Error("服务返回成功状态但回复内容为空：该模型在此服务上可能实际不可用，请核对模型名是否为精确的模型 ID（而非展示名），或更换模型");
  return text;
}

// 测试连接不依赖 JSON Schema，用最通用的方式发一条消息
async function probeConnectionReply(resolved: ResolvedByok): Promise<string> {
  const { preset, baseUrl, config } = resolved;
  const system = "You are a connection test.";
  try {
    if (preset.kind === "anthropic") {
      const response = await providerFetch(`${baseUrl}/v1/messages`, {
        method: "POST", signal: AbortSignal.timeout(60_000),
        headers: { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: config.model, max_tokens: 64, system, messages: [{ role: "user", content: "Reply with exactly: ok" }] }),
      });
      const json = await response.json().catch(() => null) as { error?: { message?: string }; content?: Array<{ text?: string }> } | null;
      if (!response.ok) throw new Error(errorMessage(response.status, json));
      return assertChatReply(json, (json?.content ?? []).map((block) => block.text ?? "").join("").trim());
    }
    if (preset.kind === "gemini") {
      const response = await providerFetch(`${baseUrl}/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(60_000),
        headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
        body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: "Reply with exactly: ok" }] }] }),
      });
      const json = await response.json().catch(() => null) as { error?: { message?: string }; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null;
      if (!response.ok) throw new Error(errorMessage(response.status, json));
      return assertChatReply(json, (json?.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("").trim());
    }
    const chatBody = JSON.stringify({ model: config.model, messages: [{ role: "system", content: system }, { role: "user", content: "Reply with exactly: ok" }] });
    const responsesBody = JSON.stringify({ model: config.model, store: false, input: [{ role: "user", content: "Reply with exactly: ok" }] });
    const probe = (path: "chat/completions" | "responses") => providerFetch(`${baseUrl}/${path}`, {
      method: "POST", signal: AbortSignal.timeout(60_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: path === "responses" ? responsesBody : chatBody,
    }, preset.cors === "no");
    // 地址以 /responses 结尾的服务优先用 Responses 协议探测；首选路径 404/405 时换另一种协议再探一次，
    // 兼容「只开了其中一种协议」的网关（opencode zen 只开 /responses）。
    const useResponsesFirst = prefersResponsesProtocol(preset, config.baseUrl);
    let response = await probe(useResponsesFirst ? "responses" : "chat/completions");
    let json = await response.json().catch(() => null) as ChatLikeJson | null;
    if (!response.ok && (response.status === 404 || response.status === 405)) {
      response = await probe(useResponsesFirst ? "chat/completions" : "responses");
      json = await response.json().catch(() => null) as ChatLikeJson | null;
    }
    if (!response.ok) throw new Error(errorMessage(response.status, json));
    return assertChatReply(json, extractChatText(json));
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`无法连接 ${preset.name}（网络受限或该供应商不允许网页直连）。${preset.note}`, { cause: error });
    throw error;
  }
}

export type ByokTestResult = { text: string; latencyMs: number };

// 连接测试同时测延迟：从发出探针到拿到完整回复的墙钟时间。
// 延迟进连接档案后参与路由排序——同等可用时优先走低延迟模型，失败自动切换也先切到测过延迟的快模型。
export async function testByokConnection(resolved: ResolvedByok): Promise<ByokTestResult> {
  const started = performance.now();
  const text = await probeConnectionReply(resolved);
  return { text, latencyMs: Math.max(1, Math.round(performance.now() - started)) };
}
