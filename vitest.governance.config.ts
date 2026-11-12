import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@evolution/contracts": path.resolve(__dirname, "./packages/contracts/src/index.ts") } },
  test: { environment: "node", include: ["packages/core/src/artifact-mutation-governance.test.ts"] },
});