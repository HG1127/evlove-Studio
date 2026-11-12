import {mergeConfig} from "vitest/config";
import p2c from "./vitest.p2c.config";
// P3 includes the unified one-save BYOK → encrypted server Vault bridge.

export default mergeConfig(p2c,{test:{include:[
  "apps/backend/src/isolated-lab-runtime.test.ts",
  "src/features/evolve/ai/server-connection-sync.test.ts",  "packages/contracts/src/backend-request-bounds.test.ts",  "apps/backend/src/services/server-ai-connection.test.ts",
  "apps/backend/src/services/server-ai-connection-composition.test.ts",
  "src/features/evolve/ai/server-connection-client.test.ts",
  "packages/harness/src/artifact-write-lineage.test.ts",
  "packages/harness/src/server-visible-repair.test.ts",
  "packages/harness/src/server-hidden-repair-v2.test.ts",
  "apps/backend/src/services/server-artifact-multigeneration.test.ts",
  "packages/core/src/artifact-mutation-governance.test.ts",
  "packages/core/src/artifact-repair-memory.test.ts",
  "packages/harness/src/artifact-write-preflight.test.ts",
  "apps/backend/src/services/server-ai-repair-contract.test.ts",
  "apps/backend/src/services/server-artifact-repair.test.ts",
  "apps/backend/src/services/server-artifact-write-governance.test.ts",
  "apps/backend/src/services/server-experiment.test.ts",
  "apps/backend/src/services/server-ai-build-contract.test.ts",
  "apps/backend/src/services/server-artifact-renderer.test.ts",
  "apps/backend/src/services/ai-gateway.test.ts",
]}});