import type { ServerAiConfig } from "../server-env";

type DirectConnection = Pick<Extract<ServerAiConfig, { mode: "openai-compatible" }>, "baseUrl" | "model">;
const HOSTS = new Set(["api.minimaxi.com", "api.minimax.io", "api.minimax.cn"]);
const MODELS = new Set(["MiniMax-M2.7", "MiniMax-M2.7-highspeed"]);
export const MINIMAX_CHAT_FINAL_CHANNEL_VERSION = "minimax-chat-reasoning-split-v1";

/** Native output separation only; final content still passes the existing strict decoder and schema. */
export function minimaxChatFinalOptions(config: DirectConnection): { reasoning_split?: true } {
  if (!MODELS.has(config.model)) return {};
  let url: URL;
  try { url = new URL(config.baseUrl); } catch { return {}; }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.port || url.username || url.password
    || url.search || url.hash || url.pathname.replace(/\/+$/, "") !== "/v1") return {};
  return { reasoning_split: true };
}