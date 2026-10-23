import { defineConfig, devices } from "@playwright/test";

// Default UI tests use isolated local/demo mode: no remote writes or paid AI calls.
// EVOLUTION_E2E_MODE=server explicitly enables integration against a server.
const serverMode = process.env.EVOLUTION_E2E_MODE === "server";
const port = Number(process.env.EVOLUTION_E2E_PORT ?? "8137");
const baseURL = "http://127.0.0.1:" + port;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL, trace: "on-first-retry" },
  webServer: {
    command: "pnpm dev --port " + port,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: serverMode ? process.env : {
      ...process.env,
      VITE_EVOLUTION_API_URL: "",
      VITE_EVOLVE_AI_PROVIDER: "demo",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
