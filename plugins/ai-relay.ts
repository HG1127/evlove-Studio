// 同源 AI 中继：部分供应商 / 中转服务不允许浏览器跨域直连（CORS 预检被拒 403），
// 导致「同步模型 / 测试连接 / 调用」失败。前端在直连失败后会把请求改发到
// /api/ai-relay（目标地址放在 x-target-url 头），由 dev server 用 Node fetch 代发，
// 绕开浏览器 CORS 限制。见 src/features/evolve/ai/providers/byok.ts 的 providerFetch。
import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

// 转发时剥掉的请求头：hop-by-hop、浏览器指纹/凭据（避免把本站 cookie 发给第三方）、
// accept-encoding（Node fetch 自行解压，透传会导致响应体编码对不上）
const STRIP_REQUEST_HEADERS = new Set([
  "host", "connection", "keep-alive", "content-length", "transfer-encoding",
  "upgrade", "proxy-authorization", "te", "trailer",
  "accept-encoding", "cookie", "origin", "referer",
  "x-target-url", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-dest", "sec-fetch-user",
]);

const STRIP_RESPONSE_HEADERS = new Set(["content-length", "content-encoding", "transfer-encoding", "connection", "set-cookie"]);

export function aiRelayPlugin(): Plugin {
  return {
    name: "ai-relay",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/ai-relay", async (req: IncomingMessage, res: ServerResponse) => {
        const target = Array.isArray(req.headers["x-target-url"]) ? req.headers["x-target-url"][0] : req.headers["x-target-url"];
        if (!target || !/^https?:\/\//i.test(target)) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "缺少或非法的 x-target-url 请求头（必须是 http/https 绝对地址）" }));
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value !== "string") continue;
          if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
          headers[key] = value;
        }
        const controller = new AbortController();
        res.on("close", () => controller.abort());
        try {
          const method = req.method ?? "GET";
          const upstream = await fetch(target, {
            method,
            headers,
            body: chunks.length && method !== "GET" && method !== "HEAD" ? Buffer.concat(chunks) : undefined,
            signal: controller.signal,
          });
          res.statusCode = upstream.status;
          upstream.headers.forEach((value, key) => {
            if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
            res.setHeader(key, value);
          });
          if (upstream.body) {
            const reader = upstream.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(Buffer.from(value));
            }
          }
          res.end();
        } catch (error) {
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json");
          }
          res.end(JSON.stringify({ error: `中继转发失败：${error instanceof Error ? error.message : String(error)}` }));
        }
      });
    },
  };
}
