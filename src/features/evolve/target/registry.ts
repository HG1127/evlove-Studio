import { serverEnv } from "../runtime/env";
import { getRunnerGatewayConfig, isRunnerGatewayReady } from "../runtime/target-runner-config";
import type { EvolveProject } from "../schemas";
import { artifactTargetAdapter } from "./artifact-adapter";
import { httpTargetAdapter } from "./http-adapter";
import { mockTargetAdapter } from "./mock-adapter";
import type { TargetAdapter } from "./types";

export function getTargetAdapter(project?: EvolveProject): TargetAdapter {
  const requested = project?.targetConnection.adapter ?? serverEnv.EVOLVE_TARGET_ADAPTER ?? "mock";
  if (requested === "http") return httpTargetAdapter;
  if (requested === "artifact") return artifactTargetAdapter;
  return mockTargetAdapter;
}

export function getTargetStatus() {
  const gatewayReady = isRunnerGatewayReady();
  const requested = serverEnv.EVOLVE_TARGET_ADAPTER || (gatewayReady ? "http" : "mock");
  const httpRequested = requested === "http";
  return {
    adapter: requested,
    name: httpRequested ? httpTargetAdapter.name : requested === "artifact" ? artifactTargetAdapter.name : mockTargetAdapter.name,
    live: httpRequested,
    configured: httpRequested ? Boolean(serverEnv.EVOLVE_TARGET_RUN_URL || getRunnerGatewayConfig().runUrl.trim()) : true,
    releaseConfigured: httpRequested ? Boolean(serverEnv.EVOLVE_TARGET_RELEASE_URL || getRunnerGatewayConfig().releaseUrl.trim()) : true,
    availableAdapters: ["artifact", "mock", "http"],
  };
}
