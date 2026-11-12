import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: {
    "@evolution/contracts": path.resolve(__dirname, "./packages/contracts/src/index.ts"),
    "@evolution/core": path.resolve(__dirname, "./packages/core/src/index.ts"),
    "@evolution/harness": path.resolve(__dirname, "./packages/harness/src/index.ts"),
    "@evolution/adapters/sandbox": path.resolve(__dirname, "./packages/adapters/src/sandbox.ts"),
    "@evolution/adapters/html-native-profile": path.resolve(__dirname, "./packages/adapters/src/native-html/profile.ts"),
    "@evolution/adapters/html-native-local": path.resolve(__dirname, "./packages/adapters/src/html-native-local.ts"),
    "@evolution/adapters/outcome-telemetry": path.resolve(__dirname, "./packages/adapters/src/outcome-telemetry.ts"),
    "@evolution/adapters": path.resolve(__dirname, "./packages/adapters/src/index.ts"),
    "@evolution/testkit": path.resolve(__dirname, "./packages/testkit/src/index.ts"),
  }},
  test: { environment: "node", include: [
    "packages/core/src/artifact-mutation-governance.test.ts",
    "packages/core/src/artifact-repair-memory.test.ts",
    "apps/backend/src/services/server-ai-repair-contract.test.ts",
    "apps/backend/src/services/server-artifact-repair.test.ts"
  ]},
});
