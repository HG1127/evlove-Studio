import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@evolution/contracts": path.resolve(__dirname, "./packages/contracts/src/index.ts"),
      "@evolution/core": path.resolve(__dirname, "./packages/core/src/index.ts"),
      "@evolution/harness": path.resolve(__dirname, "./packages/harness/src/index.ts"),
      "@evolution/adapters/sandbox": path.resolve(__dirname, "./packages/adapters/src/vercel-sandbox-adapter.ts"),
      "@evolution/adapters": path.resolve(__dirname, "./packages/adapters/src/index.ts"),
      "@evolution/ui": path.resolve(__dirname, "./packages/ui/src/index.ts"),
      "@evolution/testkit": path.resolve(__dirname, "./packages/testkit/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    // jsdom 默认 about:blank 属 opaque origin，window.localStorage 不可用；
    // 给一个真实 origin，注册表 / BYOK 等读 localStorage 的模块才能在测试里跑。
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "packages/**/*.test.ts", "packages/**/*.test.tsx"],
  },
});
