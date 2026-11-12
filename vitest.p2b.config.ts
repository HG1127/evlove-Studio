import { mergeConfig } from "vitest/config";
import p1 from "./vitest.p1.config";
export default mergeConfig(p1,{test:{include:[
  "packages/core/src/artifact-mutation-governance.test.ts",
  "packages/core/src/artifact-repair-memory.test.ts",
  "packages/harness/src/artifact-write-preflight.test.ts",
  "apps/backend/src/services/server-ai-repair-contract.test.ts",
  "apps/backend/src/services/server-artifact-repair.test.ts",
  "apps/backend/src/services/server-artifact-write-governance.test.ts",
  "apps/backend/src/services/server-experiment.test.ts",
]}});
