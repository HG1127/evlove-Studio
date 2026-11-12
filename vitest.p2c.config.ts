import {mergeConfig} from "vitest/config";
import p2b from "./vitest.p2b.config";
export default mergeConfig(p2b,{test:{include:[
  "packages/contracts/src/backend-request-bounds.test.ts",
  "packages/harness/src/artifact-write-lineage.test.ts",
  "packages/harness/src/server-visible-repair.test.ts",
  "packages/harness/src/server-hidden-repair-v2.test.ts",
  "apps/backend/src/services/server-artifact-multigeneration.test.ts",
]}});
