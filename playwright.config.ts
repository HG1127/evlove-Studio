import { defineConfig, devices } from "@playwright/test";

// 适配 Vite: 原配置对着 `pnpm dev`(Next, 3000 端口);现在对着 vite dev server(8000, 见 vite.config.ts)。
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:8000", trace: "on-first-retry" },
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:8000", reuseExistingServer: !process.env.CI },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
