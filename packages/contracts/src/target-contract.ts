import { PRODUCTION_SCHEMA_VERSIONS } from "./production-contracts";

export type TargetLifecycleOperation = "read"|"snapshot"|"mutate"|"validate"|"deploy"|"observe"|"rollback";
export type TargetLifecycleCapabilities = Record<TargetLifecycleOperation, boolean>;

export type TargetSnapshot = {
  schemaVersion: typeof PRODUCTION_SCHEMA_VERSIONS.target;
  targetId: string;
  targetType: string;
  versionRef: string;
  artifactIds: string[];
  createdAt: string;
};
